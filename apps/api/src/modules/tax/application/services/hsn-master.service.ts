// Phase 37 — HsnMasterService.
//
// CRUD for the CBIC HSN code master. Versioned by (hsnCode,
// effectiveFrom): rate changes mid-year add a new row rather than
// rewrite the old one, preserving the snapshot semantics that
// OrderTaxLineSnapshot relies on.
//
// Write paths automatically deactivate the prior active row for the
// same code by setting its effectiveTo = the new row's effectiveFrom
// — minus one millisecond is overkill; we leave them touching so the
// audit log shows the exact handover instant.
//
// Phase 161 (HSN Master flow audit) hardening:
//   B2  persist the acting admin in created_by / updated_by (was discarded).
//   B3  write an AuditPublicFacade row on every mutation.
//   #5  reference-check before deactivating a code in use by live products.
//   #7  validate defaultUqcCode against the UQC master (was free text).
//   #8  append-only HsnMasterHistory row per mutation (in-place edits had
//       no trail; effectiveFrom/effectiveTo only versions the RATE).
//   #9  cursor-free page/limit pagination on list (was a 500 hard cap).
//   #10 effectiveTo is NO LONGER admin-mutable via update() — only the
//       dedicated closeWindow() touches it (versioning contract: rate
//       changes create new rows; windows are system/ops controlled).
//   #11 deactivation requires + persists a reason.
//   #12 optimistic concurrency via the version column.
//   #14 strip HTML from free-text fields on input.
//   #15 publish tax.hsn.* lifecycle events.
//   #16 HSN-code search anchors with startsWith (codes are prefix-hierarchical).
//   B1  isActiveHsnCode / assertActiveHsnCode — the authority primitive the
//       product tax-attestation gate uses so the master is referential, not
//       a passive autocomplete list.
//
// CA actions: see docs/tax/HSN_RATE_POLICY.md §7.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type SupplyTaxability } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

export const HSN_MASTER_EVENTS = {
  CREATED: 'tax.hsn.created',
  UPDATED: 'tax.hsn.updated',
  DEACTIVATED: 'tax.hsn.deactivated',
  REACTIVATED: 'tax.hsn.reactivated',
  WINDOW_CLOSED: 'tax.hsn.window_closed',
} as const;

export interface HsnMasterListItem {
  id: string;
  hsnCode: string;
  description: string;
  defaultGstRateBps: number;
  supplyTaxability: SupplyTaxability;
  defaultUqcCode: string | null;
  categoryHint: string | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  deactivationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HsnMasterPage {
  items: HsnMasterListItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface CreateHsnInput {
  hsnCode: string;
  description: string;
  defaultGstRateBps: number;
  supplyTaxability?: SupplyTaxability;
  defaultUqcCode?: string | null;
  categoryHint?: string | null;
  // ISO date string. When omitted, defaults to "now".
  effectiveFrom?: string;
}

export interface UpdateHsnInput {
  description?: string;
  defaultUqcCode?: string | null;
  categoryHint?: string | null;
  isActive?: boolean;
  // Phase 161 #11 — mandatory when isActive flips to false.
  deactivationReason?: string | null;
  // Phase 161 #5 — required to deactivate a code still referenced by live
  // products (otherwise the service returns 409 with the reference count).
  force?: boolean;
  // Phase 161 #12 — optimistic-concurrency token the admin reviewed.
  expectedVersion?: number;
}

const HSN_CODE_RE = /^[0-9]{4,8}$/;
const MAX_RATE_BPS = 4000;
const SUPPLY_TAXABILITY_VALUES: readonly SupplyTaxability[] = [
  'TAXABLE',
  'NIL_RATED',
  'EXEMPT',
  'NON_GST',
  'ZERO_RATED',
  'OUT_OF_SCOPE',
];

// Fields whose in-place change we snapshot into HsnMasterHistory (#8).
type HsnSnapshotRow = {
  description: string;
  defaultGstRateBps: number;
  supplyTaxability: SupplyTaxability;
  defaultUqcCode: string | null;
  categoryHint: string | null;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  version: number;
};

@Injectable()
export class HsnMasterService {
  private readonly logger = new Logger(HsnMasterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    // @Optional so unit tests / partial-DI environments that omit the bus
    // still construct (mirrors EWayBillService). Events are fire-and-forget.
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async list(filter: {
    search?: string;
    activeOnly?: boolean;
    page?: number;
    limit?: number;
  }): Promise<HsnMasterPage> {
    // Phase 161 #9 — bounded pagination. Default 50, hard ceiling 200 so a
    // single request can never pull the full ~25k-row CBIC catalogue.
    const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 200);
    const page = Math.max(Math.trunc(filter.page ?? 1), 1);
    const where: Prisma.HsnMasterWhereInput = {};
    if (filter.activeOnly) where.isActive = true;
    if (filter.search) {
      const search = filter.search.trim();
      where.OR = [
        // Phase 161 #16 — HSN codes are prefix-hierarchical (chapter →
        // heading → sub-heading → tariff item); anchor the code match so
        // "85" surfaces chapter-85 codes, not "...85..." substrings.
        { hsnCode: { startsWith: search } },
        { description: { contains: search, mode: 'insensitive' } },
        { categoryHint: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.hsnMaster.count({ where }),
      this.prisma.hsnMaster.findMany({
        where,
        orderBy: [{ hsnCode: 'asc' }, { effectiveFrom: 'desc' }],
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

  async create(input: CreateHsnInput, actor: string): Promise<HsnMasterListItem> {
    this.validateCode(input.hsnCode);
    this.validateRate(input.defaultGstRateBps);
    this.validateSupplyTaxability(input.supplyTaxability);
    const description = this.requireText(input.description, 'description', 300);
    const categoryHint = this.cleanOptional(input.categoryHint, 'categoryHint', 120);
    const defaultUqcCode = await this.resolveUqc(input.defaultUqcCode);
    const effectiveFrom = input.effectiveFrom
      ? new Date(input.effectiveFrom)
      : new Date();
    if (isNaN(effectiveFrom.getTime())) {
      throw new BadRequestAppException('effectiveFrom is not a valid date');
    }

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        // Close out any currently-active open-ended row for the same code:
        // set effectiveTo = new effectiveFrom. Only the open window needs
        // closing; older closed windows are untouched history.
        await tx.hsnMaster.updateMany({
          where: { hsnCode: input.hsnCode, isActive: true, effectiveTo: null },
          data: { effectiveTo: effectiveFrom, updatedBy: actor },
        });

        const created = await tx.hsnMaster.create({
          data: {
            hsnCode: input.hsnCode,
            description,
            defaultGstRateBps: input.defaultGstRateBps,
            supplyTaxability: input.supplyTaxability ?? 'TAXABLE',
            defaultUqcCode,
            categoryHint,
            effectiveFrom,
            isActive: true,
            createdBy: actor,
            updatedBy: actor,
          },
        });
        await tx.hsnMasterHistory.create({
          data: {
            hsnMasterId: created.id,
            hsnCode: created.hsnCode,
            action: 'CREATE',
            oldValues: Prisma.JsonNull,
            newValues: snapshot(created) as Prisma.InputJsonValue,
            changedBy: actor,
          },
        });
        return created;
      });
    } catch (err) {
      // Phase 161 (audit §9) — same (hsnCode, effectiveFrom) twice races the
      // unique index; surface a clean 409 instead of a raw P2002 → 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictAppException(
          `An HSN row for ${input.hsnCode} effective ${effectiveFrom.toISOString()} already exists.`,
        );
      }
      throw err;
    }

    await this.writeAudit(actor, 'tax.hsn.created', row.id, {
      before: null,
      after: snapshot(row),
    });
    this.emit(HSN_MASTER_EVENTS.CREATED, row.id, {
      hsnCode: row.hsnCode,
      defaultGstRateBps: row.defaultGstRateBps,
    });
    this.logger.log(`HSN ${row.hsnCode} created by ${actor} (id=${row.id})`);
    return toListItem(row);
  }

  async update(
    id: string,
    input: UpdateHsnInput,
    actor: string,
  ): Promise<HsnMasterListItem> {
    const existing = await this.prisma.hsnMaster.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('HSN row not found');

    const data: Prisma.HsnMasterUpdateInput = {};
    if (input.description !== undefined) {
      data.description = this.requireText(input.description, 'description', 300);
    }
    if (input.categoryHint !== undefined) {
      data.categoryHint = this.cleanOptional(input.categoryHint, 'categoryHint', 120);
    }
    if (input.defaultUqcCode !== undefined) {
      data.defaultUqcCode = await this.resolveUqc(input.defaultUqcCode);
    }

    // Phase 161 #5 / #11 — deactivation guard. Deactivating a code in active
    // use by live products needs an explicit `force` + a reason; otherwise
    // the engine would keep selecting it for new calculations while the admin
    // UI shows it "inactive" — a silent catalog/master divergence.
    let action: 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE' = 'UPDATE';
    let auditEvent: string = HSN_MASTER_EVENTS.UPDATED;
    const reason = input.deactivationReason
      ? this.sanitize(input.deactivationReason)
      : null;
    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      data.isActive = input.isActive;
      if (input.isActive === false) {
        action = 'DEACTIVATE';
        auditEvent = HSN_MASTER_EVENTS.DEACTIVATED;
        if (!reason || reason.length < 5) {
          throw new BadRequestAppException(
            'deactivationReason (min 5 chars) is required to deactivate an HSN code.',
          );
        }
        const refCount = await this.prisma.product.count({
          where: { hsnCode: existing.hsnCode },
        });
        if (refCount > 0 && input.force !== true) {
          throw new ConflictAppException(
            `${refCount} product(s) still reference HSN ${existing.hsnCode}. ` +
              `Re-point them first, or pass force=true to deactivate anyway (the reason is recorded).`,
          );
        }
        data.deactivationReason = reason;
      } else {
        // Reactivation — clear the prior deactivation reason.
        action = 'REACTIVATE';
        auditEvent = HSN_MASTER_EVENTS.REACTIVATED;
        data.deactivationReason = null;
      }
    } else if (reason) {
      // Reason supplied without an isActive flip — record it but don't
      // change activation state.
      data.deactivationReason = reason;
    }

    // Phase 161 #10 — effectiveTo is intentionally NOT accepted here. The
    // versioning contract is "rate changes create new rows"; an admin
    // rewriting a window retroactively shifts report period boundaries.
    // Use closeWindow() for the rare deliberate window adjustment.

    // Phase 161 #12 — optimistic concurrency. When the caller passes the
    // version they reviewed we lock on it; otherwise we lock on the freshly
    // read version (still rejects a concurrent writer that landed between
    // our read and the update).
    const expectedVersion = input.expectedVersion ?? existing.version;

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.hsnMaster.updateMany({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 }, updatedBy: actor },
      });
      if (res.count === 0) {
        throw new ConflictAppException(
          `HSN row changed since you loaded it (version ${existing.version}). Reload and retry.`,
        );
      }
      const fresh = await tx.hsnMaster.findUniqueOrThrow({ where: { id } });
      await tx.hsnMasterHistory.create({
        data: {
          hsnMasterId: id,
          hsnCode: existing.hsnCode,
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
    this.emit(auditEvent, id, { hsnCode: updated.hsnCode, action });
    this.logger.log(`HSN ${updated.hsnCode} ${action} by ${actor} (id=${id})`);
    return toListItem(updated);
  }

  /**
   * Phase 161 #10 — the ONLY path that adjusts effectiveTo. Closes (or
   * re-opens, with null) an effective window deliberately, audited + version-
   * bumped + history-logged. Kept off the general update() so a routine edit
   * can't silently retroactively shift a reporting period.
   */
  async closeWindow(
    id: string,
    input: { effectiveTo: string | null; reason?: string | null; expectedVersion?: number },
    actor: string,
  ): Promise<HsnMasterListItem> {
    const existing = await this.prisma.hsnMaster.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('HSN row not found');
    let effectiveTo: Date | null = null;
    if (input.effectiveTo !== null && input.effectiveTo !== undefined) {
      effectiveTo = new Date(input.effectiveTo);
      if (isNaN(effectiveTo.getTime())) {
        throw new BadRequestAppException('effectiveTo is not a valid date');
      }
      if (effectiveTo.getTime() < existing.effectiveFrom.getTime()) {
        throw new BadRequestAppException(
          'effectiveTo cannot be before effectiveFrom.',
        );
      }
    }
    const reason = input.reason ? this.sanitize(input.reason) : null;
    const expectedVersion = input.expectedVersion ?? existing.version;

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.hsnMaster.updateMany({
        where: { id, version: expectedVersion },
        data: { effectiveTo, version: { increment: 1 }, updatedBy: actor },
      });
      if (res.count === 0) {
        throw new ConflictAppException(
          `HSN row changed since you loaded it (version ${existing.version}). Reload and retry.`,
        );
      }
      const fresh = await tx.hsnMaster.findUniqueOrThrow({ where: { id } });
      await tx.hsnMasterHistory.create({
        data: {
          hsnMasterId: id,
          hsnCode: existing.hsnCode,
          action: 'CLOSE_WINDOW',
          oldValues: snapshot(existing) as Prisma.InputJsonValue,
          newValues: snapshot(fresh) as Prisma.InputJsonValue,
          changedBy: actor,
          reason,
        },
      });
      return fresh;
    });

    await this.writeAudit(actor, HSN_MASTER_EVENTS.WINDOW_CLOSED, id, {
      before: snapshot(existing),
      after: snapshot(updated),
      reason,
    });
    this.emit(HSN_MASTER_EVENTS.WINDOW_CLOSED, id, { hsnCode: updated.hsnCode });
    return toListItem(updated);
  }

  /**
   * Phase 161 (audit B1) — authority primitive. Returns true when `code`
   * resolves to a row that is active AND whose effective window includes
   * `at` (default now). The product tax-attestation gate consults this so
   * the master is referential, not a passive autocomplete list.
   */
  async isActiveHsnCode(code: string, at: Date = new Date()): Promise<boolean> {
    if (!code) return false;
    const row = await this.prisma.hsnMaster.findFirst({
      where: {
        hsnCode: code,
        isActive: true,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      select: { id: true },
    });
    return !!row;
  }

  async assertActiveHsnCode(code: string, at: Date = new Date()): Promise<void> {
    if (!(await this.isActiveHsnCode(code, at))) {
      throw new BadRequestAppException(
        `HSN ${code} is not an active code in the HSN master. Add it (or re-activate it) before use.`,
      );
    }
  }

  /**
   * Phase 161 #8 — field-change history for the HSN CODE that the given row
   * belongs to (so all effective-period rows of the same code share one
   * timeline — "when did 851713's description change" is answerable).
   */
  async historyForRow(
    id: string,
    opts: { limit?: number } = {},
  ): Promise<unknown[]> {
    const row = await this.prisma.hsnMaster.findUnique({
      where: { id },
      select: { hsnCode: true },
    });
    if (!row) throw new NotFoundAppException('HSN row not found');
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return this.prisma.hsnMasterHistory.findMany({
      where: { hsnCode: row.hsnCode },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // ── validation + sanitisation helpers ────────────────────────────

  private validateCode(code: string) {
    if (!HSN_CODE_RE.test(code)) {
      throw new BadRequestAppException(
        'HSN code must be 4-8 digits per CBIC harmonised system',
      );
    }
  }

  private validateRate(bps: number) {
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_RATE_BPS) {
      throw new BadRequestAppException(
        `defaultGstRateBps must be an integer between 0 and ${MAX_RATE_BPS}`,
      );
    }
  }

  private validateSupplyTaxability(value?: SupplyTaxability) {
    if (value !== undefined && !SUPPLY_TAXABILITY_VALUES.includes(value)) {
      throw new BadRequestAppException(
        `supplyTaxability must be one of: ${SUPPLY_TAXABILITY_VALUES.join(', ')}`,
      );
    }
  }

  /**
   * Phase 161 #7 — resolve + validate the UQC against the master. Free-text
   * UQC made cross-system normalisation impossible. null/empty clears it;
   * a non-empty value must exist as an ACTIVE uqc_master row.
   */
  private async resolveUqc(
    raw: string | null | undefined,
  ): Promise<string | null> {
    if (raw === null || raw === undefined) return null;
    const code = raw.trim().toUpperCase();
    if (code === '') return null;
    const row = await this.prisma.uqcMaster.findUnique({
      where: { code },
      select: { isActive: true },
    });
    if (!row || !row.isActive) {
      throw new BadRequestAppException(
        `defaultUqcCode "${code}" is not an active code in the UQC master.`,
      );
    }
    return code;
  }

  /**
   * Phase 161 #14 — strip HTML tags + trim. Defence-in-depth against stored
   * XSS reaching the admin UI / invoice PDFs even though the HTML invoice
   * template escapes on output.
   */
  private sanitize(value: string): string {
    return value.replace(/<[^>]*>/g, '').trim();
  }

  private requireText(value: string, field: string, max: number): string {
    const clean = this.sanitize(value ?? '');
    if (clean.length === 0) {
      throw new BadRequestAppException(`${field} is required`);
    }
    if (clean.length > max) {
      throw new BadRequestAppException(`${field} must be ≤ ${max} characters`);
    }
    return clean;
  }

  private cleanOptional(
    value: string | null | undefined,
    field: string,
    max: number,
  ): string | null {
    if (value === null || value === undefined) return null;
    const clean = this.sanitize(value);
    if (clean === '') return null;
    if (clean.length > max) {
      throw new BadRequestAppException(`${field} must be ≤ ${max} characters`);
    }
    return clean;
  }

  private async writeAudit(
    actor: string,
    action: string,
    resourceId: string,
    payload: { before: unknown; after: unknown; reason?: string | null },
  ): Promise<void> {
    // Best-effort cross-cutting compliance mirror — never block the mutation
    // on the audit write (the module-local HsnMasterHistory row is atomic).
    await this.audit
      .writeAuditLog({
        actorId: actor,
        action,
        module: 'tax-master',
        resource: 'hsn_master',
        resourceId,
        oldValue: payload.before ?? undefined,
        newValue: payload.after ?? undefined,
        metadata: payload.reason ? { reason: payload.reason } : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `HSN audit-log write failed for ${resourceId}: ${(err as Error).message}`,
        ),
      );
  }

  private emit(
    eventName: string,
    hsnMasterId: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'HsnMaster',
        aggregateId: hsnMasterId,
        occurredAt: new Date(),
        payload: { hsnMasterId, ...payload },
      })
      .catch(() => undefined);
  }
}

function snapshot(row: HsnSnapshotRow): Record<string, unknown> {
  return {
    description: row.description,
    defaultGstRateBps: row.defaultGstRateBps,
    supplyTaxability: row.supplyTaxability,
    defaultUqcCode: row.defaultUqcCode,
    categoryHint: row.categoryHint,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    version: row.version,
  };
}

function toListItem(row: {
  id: string;
  hsnCode: string;
  description: string;
  defaultGstRateBps: number;
  supplyTaxability: SupplyTaxability;
  defaultUqcCode: string | null;
  categoryHint: string | null;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  deactivationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): HsnMasterListItem {
  return {
    id: row.id,
    hsnCode: row.hsnCode,
    description: row.description,
    defaultGstRateBps: row.defaultGstRateBps,
    supplyTaxability: row.supplyTaxability,
    defaultUqcCode: row.defaultUqcCode,
    categoryHint: row.categoryHint,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    version: row.version,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    deactivationReason: row.deactivationReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
