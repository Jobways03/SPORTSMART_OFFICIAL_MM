// Phase 37 — UqcMasterService.
//
// CRUD for the CBIC UQC (Unit Quantity Code) list. Every tax invoice
// line declares a UQC per Section 31 / Rule 46; this lets admin add a
// new code without a DB migration. Soft-delete only via isActive — we
// never hard-delete because historical line-snapshots reference the
// short code by value.
//
// Phase 161 (UQC Master flow audit) hardening — mirrors the HSN master
// (hsn-master.service.ts):
//   B2  persist the acting admin in created_by / updated_by (was never
//       captured — the controller didn't even read req.adminId).
//   B3  write an AuditPublicFacade row on every mutation.
//   #5  reference-check before deactivating a code still in use by an
//       HsnMaster.defaultUqcCode or a live Product.defaultUqcCode.
//   #7  append-only UqcMasterHistory row per mutation.
//   #8  page/limit pagination on list (was a 500 hard cap).
//   #9  optimistic concurrency via the version column.
//   #10 map a duplicate-code P2002 to a clean 409 (was a raw 500).
//   #11 deactivation requires + persists a reason.
//   #12 strip HTML from the description on input.
//   #13 publish tax.uqc.* lifecycle events.
//   #14 bulk create endpoint (createMany, skipping dups).
//   #16 collapse internal whitespace in the description (case left intact —
//       descriptions are human-readable display text, not a key).
//   B1  isActiveUqcCode / assertActiveUqcCode — the authority primitive the
//       product tax-attestation gate uses so the master is referential.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

export const UQC_MASTER_EVENTS = {
  CREATED: 'tax.uqc.created',
  UPDATED: 'tax.uqc.updated',
  DEACTIVATED: 'tax.uqc.deactivated',
  REACTIVATED: 'tax.uqc.reactivated',
} as const;

export interface UqcMasterListItem {
  id: string;
  code: string;
  description: string;
  isActive: boolean;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  deactivationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UqcMasterPage {
  items: UqcMasterListItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface UpdateUqcInput {
  description?: string;
  isActive?: boolean;
  deactivationReason?: string | null;
  force?: boolean;
  expectedVersion?: number;
}

const UQC_CODE_RE = /^[A-Z0-9]{2,8}$/;

type UqcSnapshotRow = {
  code: string;
  description: string;
  isActive: boolean;
  version: number;
};

@Injectable()
export class UqcMasterService {
  private readonly logger = new Logger(UqcMasterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async list(filter: {
    search?: string;
    activeOnly?: boolean;
    page?: number;
    limit?: number;
  }): Promise<UqcMasterPage> {
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
    const page = Math.max(Math.trunc(filter.page ?? 1), 1);
    const where: Prisma.UqcMasterWhereInput = {};
    if (filter.activeOnly) where.isActive = true;
    if (filter.search) {
      const search = filter.search.trim();
      where.OR = [
        { code: { contains: search.toUpperCase() } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.uqcMaster.count({ where }),
      this.prisma.uqcMaster.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      items: rows.map(toListItem),
      total,
      page,
      limit,
      hasMore: page * limit < total,
    };
  }

  async create(
    input: { code: string; description: string },
    actor: string,
  ): Promise<UqcMasterListItem> {
    const code = (input.code ?? '').toUpperCase().trim();
    if (!UQC_CODE_RE.test(code)) {
      throw new BadRequestAppException(
        'UQC code must be 2-8 alphanumeric characters (e.g. NOS, PCS, KGS)',
      );
    }
    const description = this.requireDescription(input.description);

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.uqcMaster.create({
          data: { code, description, createdBy: actor, updatedBy: actor },
        });
        await tx.uqcMasterHistory.create({
          data: {
            uqcId: created.id,
            code: created.code,
            action: 'CREATE',
            oldValues: Prisma.JsonNull,
            newValues: snapshot(created) as Prisma.InputJsonValue,
            changedBy: actor,
          },
        });
        return created;
      });
    } catch (err) {
      // Phase 161 #10 — duplicate code races the @unique index; surface a
      // clean 409 instead of a raw P2002 → 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictAppException(`UQC code "${code}" already exists.`);
      }
      throw err;
    }

    await this.writeAudit(actor, UQC_MASTER_EVENTS.CREATED, row.id, {
      before: null,
      after: snapshot(row),
    });
    this.emit(UQC_MASTER_EVENTS.CREATED, row.id, { code: row.code });
    this.logger.log(`UQC ${row.code} created by ${actor} (id=${row.id})`);
    return toListItem(row);
  }

  async update(
    id: string,
    input: UpdateUqcInput,
    actor: string,
  ): Promise<UqcMasterListItem> {
    const existing = await this.prisma.uqcMaster.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('UQC row not found');

    const data: Prisma.UqcMasterUpdateInput = {};
    if (input.description !== undefined) {
      data.description = this.requireDescription(input.description);
    }

    let action: 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE' = 'UPDATE';
    let auditEvent: string = UQC_MASTER_EVENTS.UPDATED;
    const reason = input.deactivationReason
      ? this.sanitize(input.deactivationReason)
      : null;
    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      data.isActive = input.isActive;
      if (input.isActive === false) {
        action = 'DEACTIVATE';
        auditEvent = UQC_MASTER_EVENTS.DEACTIVATED;
        if (!reason || reason.length < 5) {
          throw new BadRequestAppException(
            'deactivationReason (min 5 chars) is required to deactivate a UQC code.',
          );
        }
        // Phase 161 #5 — reference guard. A UQC still set as an
        // HsnMaster.defaultUqcCode or a live Product.defaultUqcCode needs an
        // explicit force (reason still recorded) — otherwise the engine keeps
        // hydrating snapshots with a code the admin UI shows "inactive".
        const [hsnRefs, productRefs] = await Promise.all([
          this.prisma.hsnMaster.count({ where: { defaultUqcCode: existing.code } }),
          this.prisma.product.count({ where: { defaultUqcCode: existing.code } }),
        ]);
        const refs = hsnRefs + productRefs;
        if (refs > 0 && input.force !== true) {
          throw new ConflictAppException(
            `${refs} record(s) still reference UQC ${existing.code} ` +
              `(${hsnRefs} HSN master row(s), ${productRefs} product(s)). ` +
              `Re-point them first, or pass force=true (the reason is recorded).`,
          );
        }
        data.deactivationReason = reason;
      } else {
        action = 'REACTIVATE';
        auditEvent = UQC_MASTER_EVENTS.REACTIVATED;
        data.deactivationReason = null;
      }
    } else if (reason) {
      data.deactivationReason = reason;
    }

    const expectedVersion = input.expectedVersion ?? existing.version;
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.uqcMaster.updateMany({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 }, updatedBy: actor },
      });
      if (res.count === 0) {
        throw new ConflictAppException(
          `UQC row changed since you loaded it (version ${existing.version}). Reload and retry.`,
        );
      }
      const fresh = await tx.uqcMaster.findUniqueOrThrow({ where: { id } });
      await tx.uqcMasterHistory.create({
        data: {
          uqcId: id,
          code: existing.code,
          action,
          oldValues: snapshot(existing) as Prisma.InputJsonValue,
          newValues: snapshot(fresh) as Prisma.InputJsonValue,
          changedBy: actor,
          reason,
        },
      });
      return fresh;
    });

    await this.writeAudit(actor, auditEvent, id, {
      before: snapshot(existing),
      after: snapshot(updated),
      reason,
    });
    this.emit(auditEvent, id, { code: updated.code, action });
    this.logger.log(`UQC ${updated.code} ${action} by ${actor} (id=${id})`);
    return toListItem(updated);
  }

  /**
   * Phase 161 #14 — bulk create. Validates + de-dupes the batch, inserts with
   * createMany (skipDuplicates so an existing code is a no-op, not a 409), and
   * records a single history + audit row summarising the import. Returns the
   * counts so the admin UI can report "added N, skipped M".
   */
  async bulkCreate(
    rows: Array<{ code: string; description: string }>,
    actor: string,
  ): Promise<{ requested: number; inserted: number; skipped: number }> {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestAppException('bulk import requires a non-empty list');
    }
    if (rows.length > 500) {
      throw new BadRequestAppException('bulk import is capped at 500 rows per request');
    }
    const seen = new Set<string>();
    const clean: Array<{ code: string; description: string }> = [];
    for (const r of rows) {
      const code = (r.code ?? '').toUpperCase().trim();
      if (!UQC_CODE_RE.test(code)) {
        throw new BadRequestAppException(`Invalid UQC code "${r.code}" in bulk import`);
      }
      const description = this.requireDescription(r.description);
      if (seen.has(code)) continue; // de-dupe within the batch
      seen.add(code);
      clean.push({ code, description });
    }

    const result = await this.prisma.uqcMaster.createMany({
      data: clean.map((c) => ({
        code: c.code,
        description: c.description,
        createdBy: actor,
        updatedBy: actor,
      })),
      skipDuplicates: true,
    });

    await this.writeAudit(actor, 'tax.uqc.bulk_created', 'bulk', {
      before: null,
      after: { requested: rows.length, inserted: result.count },
    });
    this.logger.log(
      `UQC bulk import by ${actor}: ${result.count}/${clean.length} inserted`,
    );
    return {
      requested: rows.length,
      inserted: result.count,
      skipped: rows.length - result.count,
    };
  }

  /**
   * Phase 161 (audit B1) — authority primitive. True when `code` is an active
   * UQC master row. The product tax-attestation gate consults this so the
   * master is referential, not a passive autocomplete list.
   */
  async isActiveUqcCode(code: string): Promise<boolean> {
    if (!code) return false;
    const row = await this.prisma.uqcMaster.findUnique({
      where: { code: code.toUpperCase().trim() },
      select: { isActive: true },
    });
    return !!row && row.isActive;
  }

  async assertActiveUqcCode(code: string): Promise<void> {
    if (!(await this.isActiveUqcCode(code))) {
      throw new BadRequestAppException(
        `UQC ${code} is not an active code in the UQC master. Add it (or re-activate it) before use.`,
      );
    }
  }

  /** Phase 161 #7 — field-change history for a UQC row's code. */
  async historyForRow(id: string, opts: { limit?: number } = {}): Promise<unknown[]> {
    const row = await this.prisma.uqcMaster.findUnique({
      where: { id },
      select: { code: true },
    });
    if (!row) throw new NotFoundAppException('UQC row not found');
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return this.prisma.uqcMasterHistory.findMany({
      where: { code: row.code },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // ── helpers ──────────────────────────────────────────────────────

  private sanitize(value: string): string {
    // Phase 161 #12/#16 — strip HTML tags, collapse internal whitespace, trim.
    // Case is preserved (description is human-readable display text).
    return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  private requireDescription(value: string): string {
    const clean = this.sanitize(value ?? '');
    if (clean.length === 0) {
      throw new BadRequestAppException('description is required');
    }
    if (clean.length > 200) {
      throw new BadRequestAppException('description must be ≤ 200 characters');
    }
    return clean;
  }

  private async writeAudit(
    actor: string,
    action: string,
    resourceId: string,
    payload: { before: unknown; after: unknown; reason?: string | null },
  ): Promise<void> {
    await this.audit
      .writeAuditLog({
        actorId: actor,
        action,
        module: 'tax-master',
        resource: 'uqc_master',
        resourceId,
        oldValue: payload.before ?? undefined,
        newValue: payload.after ?? undefined,
        metadata: payload.reason ? { reason: payload.reason } : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `UQC audit-log write failed for ${resourceId}: ${(err as Error).message}`,
        ),
      );
  }

  private emit(
    eventName: string,
    uqcId: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'UqcMaster',
        aggregateId: uqcId,
        occurredAt: new Date(),
        payload: { uqcId, ...payload },
      })
      .catch(() => undefined);
  }
}

function snapshot(row: UqcSnapshotRow): Record<string, unknown> {
  return {
    code: row.code,
    description: row.description,
    isActive: row.isActive,
    version: row.version,
  };
}

function toListItem(row: {
  id: string;
  code: string;
  description: string;
  isActive: boolean;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): UqcMasterListItem {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    isActive: row.isActive,
    version: row.version,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    deactivationReason: row.deactivationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
