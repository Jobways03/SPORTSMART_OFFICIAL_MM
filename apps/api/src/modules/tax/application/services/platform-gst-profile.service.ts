// Phase 37 — PlatformGstProfileService.
//
// CRUD for Sportsmart's own GSTINs — used as the supplier identity
// for OWN_BRAND / SPORTSMART supplies (no marketplace seller in the
// loop). Typically one row marked isDefault=true; additional rows
// when Sportsmart registers in more states.
//
// Phase 161 (Platform GST Profile flow audit) hardening — mirrors the HSN /
// UQC master hardening:
//   B4  AuditPublicFacade row on every mutation (changing the default GSTIN
//       is the most consequential action on this table).
//   B5  persist the acting admin in created_by / updated_by.
//   #6  one ACTIVE profile per state + single DEFAULT enforced by partial
//       unique indexes (migration) — makes getDefault() deterministic (#13).
//   #7  PAN regex-validated + masked in API responses (only panLast4 exposed;
//       full panNumber never returned). At-rest encryption is gated on the
//       (not-yet-built) platform encryption helper — see audit #134.
//   #9  class-validator DTOs at the controller (defence in depth here too).
//   #10 deactivating the CURRENT default is rejected (set a successor first).
//   #11 setDefault / deactivate capture a reason.
//   #12 optimistic concurrency via version; PlatformGstProfileHistory rows.
//   #15 registeredAddressJson structurally validated.
//   #16 publish tax.platform-gst.* lifecycle events.
//   #17 update() can also flip isDefault (with the clear-others transaction).
//   B1  getProfileForState(stateCode) — state-specific active profile, else
//       default. The per-state capability the schema was designed for.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type GstRegistrationType } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { validateGstin } from '../../domain/gstin-validator';

export const PLATFORM_GST_EVENTS = {
  CREATED: 'tax.platform-gst.created',
  UPDATED: 'tax.platform-gst.updated',
  DEACTIVATED: 'tax.platform-gst.deactivated',
  REACTIVATED: 'tax.platform-gst.reactivated',
  DEFAULT_CHANGED: 'tax.platform-gst.default_changed',
} as const;

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export interface PlatformGstProfileItem {
  id: string;
  legalBusinessName: string;
  gstin: string;
  registeredAddressJson: unknown;
  gstStateCode: string;
  registrationType: GstRegistrationType;
  // Phase 161 #7 — full PAN is NEVER returned via the API; only the last 4.
  panLast4: string | null;
  panVerified: boolean;
  isDefault: boolean;
  isActive: boolean;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  deactivationReason: string | null;
  setDefaultReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlatformProfileInput {
  legalBusinessName: string;
  gstin: string;
  registeredAddressJson: unknown;
  registrationType?: GstRegistrationType;
  panNumber?: string | null;
  isDefault?: boolean;
}

export interface UpdatePlatformProfileInput {
  legalBusinessName?: string;
  registeredAddressJson?: unknown;
  registrationType?: GstRegistrationType;
  panNumber?: string | null;
  isActive?: boolean;
  // Phase 161 #17 — flip default in the same call (clear-others transaction).
  isDefault?: boolean;
  // Phase 161 #10/#11 — reason required when deactivating / setting default.
  deactivationReason?: string | null;
  setDefaultReason?: string | null;
  // Phase 161 #12 — optimistic-concurrency token.
  expectedVersion?: number;
}

type ProfileSnapshotRow = {
  legalBusinessName: string;
  gstin: string;
  gstStateCode: string;
  registrationType: GstRegistrationType;
  panLast4: string | null;
  isDefault: boolean;
  isActive: boolean;
  version: number;
};

@Injectable()
export class PlatformGstProfileService {
  private readonly logger = new Logger(PlatformGstProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async list(): Promise<PlatformGstProfileItem[]> {
    const rows = await this.prisma.platformGstProfile.findMany({
      orderBy: [{ isDefault: 'desc' }, { gstStateCode: 'asc' }],
    });
    return rows.map(toItem);
  }

  /**
   * Phase 159z (GSTR-8 audit B3) — the platform's own GSTIN, the
   * `isDefault=true` + `isActive=true` row. Authoritative operator-GSTIN
   * source for GSTR-8 / GSTR-1 / GSTR-3B exports (controllers MUST NOT
   * accept a user-supplied operatorGstin). Deterministic now that a partial
   * unique index enforces a single default (Phase 161 #6/#13). orderBy added
   * defensively for legacy data predating the constraint.
   */
  async getDefault(): Promise<PlatformGstProfileItem | null> {
    const row = await this.prisma.platformGstProfile.findFirst({
      where: { isDefault: true, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? toItem(row) : null;
  }

  async requireDefault(): Promise<PlatformGstProfileItem> {
    const row = await this.getDefault();
    if (!row) {
      throw new BadRequestAppException(
        'No default Platform GST profile configured — set one via ' +
          'Settings → Tax → Platform GSTINs before running GSTR-8 / GSTR-1 / GSTR-3B exports.',
      );
    }
    return row;
  }

  /**
   * Phase 161 (audit B1) — resolve the supplier profile for a supply
   * originating in `stateCode`: the active profile registered in that state
   * if one exists, otherwise the default. This is the per-state capability
   * the multi-state schema was designed for; supply-identity consumers pass
   * the dispatch-origin state. Falls back to the default so a single-state
   * marketplace behaves exactly as before.
   */
  async getProfileForState(
    stateCode: string | null | undefined,
  ): Promise<PlatformGstProfileItem | null> {
    if (stateCode) {
      const row = await this.prisma.platformGstProfile.findFirst({
        where: { gstStateCode: stateCode, isActive: true },
        orderBy: { isDefault: 'desc' },
      });
      if (row) return toItem(row);
    }
    return this.getDefault();
  }

  async getById(id: string): Promise<PlatformGstProfileItem | null> {
    const row = await this.prisma.platformGstProfile.findUnique({ where: { id } });
    return row ? toItem(row) : null;
  }

  async create(
    input: CreatePlatformProfileInput,
    actor: string,
  ): Promise<PlatformGstProfileItem> {
    const validation = validateGstin(input.gstin);
    if (!validation.isValid || !validation.stateCode) {
      throw new BadRequestAppException(
        `Invalid GSTIN: ${validation.errors.join('; ')}`,
      );
    }
    const stateCode: string = validation.stateCode;
    const legalBusinessName = this.requireName(input.legalBusinessName);
    const panNumber = this.validatePan(input.panNumber);
    const registeredAddressJson = this.validateAddress(input.registeredAddressJson);

    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        if (input.isDefault) {
          await tx.platformGstProfile.updateMany({
            where: { isDefault: true },
            data: { isDefault: false, updatedBy: actor },
          });
        }
        const created = await tx.platformGstProfile.create({
          data: {
            legalBusinessName,
            gstin: input.gstin.toUpperCase(),
            gstStateCode: stateCode,
            registeredAddressJson: registeredAddressJson as Prisma.InputJsonValue,
            registrationType: input.registrationType ?? 'REGULAR',
            panNumber,
            panLast4: panNumber ? panNumber.slice(-4) : null,
            isDefault: input.isDefault ?? false,
            isActive: true,
            createdBy: actor,
            updatedBy: actor,
          },
        });
        await tx.platformGstProfileHistory.create({
          data: {
            profileId: created.id,
            gstin: created.gstin,
            action: 'CREATE',
            oldValues: Prisma.JsonNull,
            newValues: snapshot(created) as Prisma.InputJsonValue,
            changedBy: actor,
          },
        });
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // gstin global-unique OR the active-per-state / single-default partial
        // unique indexes (Phase 161 #6) — surface a clean 409.
        throw new ConflictAppException(
          `A Platform GST profile conflicts with an existing one (GSTIN ${input.gstin.toUpperCase()}, ` +
            `or another active profile / default already exists for this state).`,
        );
      }
      throw err;
    }

    await this.writeAudit(actor, PLATFORM_GST_EVENTS.CREATED, row.id, {
      before: null,
      after: snapshot(row),
    });
    this.emit(PLATFORM_GST_EVENTS.CREATED, row.id, { gstin: row.gstin, gstStateCode: row.gstStateCode });
    this.logger.log(`Platform GST profile ${row.gstin} created by ${actor} (id=${row.id})`);
    return toItem(row);
  }

  async update(
    id: string,
    input: UpdatePlatformProfileInput,
    actor: string,
  ): Promise<PlatformGstProfileItem> {
    const existing = await this.prisma.platformGstProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('Platform GST profile not found');

    const data: Prisma.PlatformGstProfileUpdateInput = {};
    if (input.legalBusinessName !== undefined) {
      data.legalBusinessName = this.requireName(input.legalBusinessName);
    }
    if (input.registeredAddressJson !== undefined) {
      data.registeredAddressJson = this.validateAddress(
        input.registeredAddressJson,
      ) as Prisma.InputJsonValue;
    }
    if (input.registrationType !== undefined) data.registrationType = input.registrationType;
    if (input.panNumber !== undefined) {
      const pan = this.validatePan(input.panNumber);
      data.panNumber = pan;
      data.panLast4 = pan ? pan.slice(-4) : null;
    }

    let action: 'UPDATE' | 'DEACTIVATE' | 'REACTIVATE' | 'SET_DEFAULT' = 'UPDATE';
    let auditEvent: string = PLATFORM_GST_EVENTS.UPDATED;
    const deactivationReason = input.deactivationReason
      ? this.sanitize(input.deactivationReason)
      : null;

    if (input.isActive !== undefined && input.isActive !== existing.isActive) {
      data.isActive = input.isActive;
      if (input.isActive === false) {
        action = 'DEACTIVATE';
        auditEvent = PLATFORM_GST_EVENTS.DEACTIVATED;
        // Phase 161 #10 — deactivating the CURRENT default would leave the
        // platform with no supplier identity (every subsequent invoice falls
        // through to the conservative-IGST branch). Force a successor first.
        if (existing.isDefault) {
          throw new ConflictAppException(
            'Cannot deactivate the current default Platform GST profile. ' +
              'Set another profile as default first, then deactivate this one.',
          );
        }
        if (!deactivationReason || deactivationReason.length < 5) {
          throw new BadRequestAppException(
            'deactivationReason (min 5 chars) is required to deactivate a Platform GST profile.',
          );
        }
        data.deactivationReason = deactivationReason;
      } else {
        action = 'REACTIVATE';
        auditEvent = PLATFORM_GST_EVENTS.REACTIVATED;
        data.deactivationReason = null;
      }
    }

    // Phase 161 #17 — allow update() to promote to default in one call.
    const promoteToDefault = input.isDefault === true && !existing.isDefault;
    const setDefaultReason = input.setDefaultReason ? this.sanitize(input.setDefaultReason) : null;
    if (promoteToDefault) {
      if (input.isActive === false) {
        throw new BadRequestAppException('Cannot set an inactive profile as default.');
      }
      if (!setDefaultReason || setDefaultReason.length < 5) {
        throw new BadRequestAppException(
          'setDefaultReason (min 5 chars) is required when changing the default profile.',
        );
      }
      data.isDefault = true;
      data.setDefaultReason = setDefaultReason;
      action = 'SET_DEFAULT';
      auditEvent = PLATFORM_GST_EVENTS.DEFAULT_CHANGED;
    }

    const expectedVersion = input.expectedVersion ?? existing.version;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (promoteToDefault) {
        await tx.platformGstProfile.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false, updatedBy: actor },
        });
      }
      const res = await tx.platformGstProfile.updateMany({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 }, updatedBy: actor },
      });
      if (res.count === 0) {
        throw new ConflictAppException(
          `Platform GST profile changed since you loaded it (version ${existing.version}). Reload and retry.`,
        );
      }
      const fresh = await tx.platformGstProfile.findUniqueOrThrow({ where: { id } });
      await tx.platformGstProfileHistory.create({
        data: {
          profileId: id,
          gstin: existing.gstin,
          action,
          oldValues: snapshot(existing) as Prisma.InputJsonValue,
          newValues: snapshot(fresh) as Prisma.InputJsonValue,
          changedBy: actor,
          reason: deactivationReason ?? setDefaultReason,
        },
      });
      return fresh;
    });

    await this.writeAudit(actor, auditEvent, id, {
      before: snapshot(existing),
      after: snapshot(updated),
      reason: deactivationReason ?? setDefaultReason,
    });
    this.emit(auditEvent, id, { gstin: updated.gstin, action });
    this.logger.log(`Platform GST profile ${updated.gstin} ${action} by ${actor} (id=${id})`);
    return toItem(updated);
  }

  /**
   * Phase 161 #11 — switching the default platform GSTIN is the most
   * consequential action on this table (every subsequent invoice/export
   * rides on it), so a reason is mandatory + audited + history-logged.
   */
  async setDefault(
    id: string,
    reason: string,
    actor: string,
  ): Promise<PlatformGstProfileItem> {
    const cleanReason = this.sanitize(reason ?? '');
    if (cleanReason.length < 5) {
      throw new BadRequestAppException(
        'A reason (min 5 chars) is required to change the default Platform GST profile.',
      );
    }
    const existing = await this.prisma.platformGstProfile.findUnique({ where: { id } });
    if (!existing) throw new NotFoundAppException('Platform GST profile not found');
    if (!existing.isActive) {
      throw new BadRequestAppException(
        'Cannot mark an inactive profile as default. Reactivate it first.',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.platformGstProfile.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false, updatedBy: actor },
      });
      const row = await tx.platformGstProfile.update({
        where: { id },
        data: {
          isDefault: true,
          setDefaultReason: cleanReason,
          updatedBy: actor,
          version: { increment: 1 },
        },
      });
      await tx.platformGstProfileHistory.create({
        data: {
          profileId: id,
          gstin: existing.gstin,
          action: 'SET_DEFAULT',
          oldValues: snapshot(existing) as Prisma.InputJsonValue,
          newValues: snapshot(row) as Prisma.InputJsonValue,
          changedBy: actor,
          reason: cleanReason,
        },
      });
      return row;
    });

    await this.writeAudit(actor, PLATFORM_GST_EVENTS.DEFAULT_CHANGED, id, {
      before: snapshot(existing),
      after: snapshot(updated),
      reason: cleanReason,
    });
    this.emit(PLATFORM_GST_EVENTS.DEFAULT_CHANGED, id, { gstin: updated.gstin });
    this.logger.log(`Platform GST default → ${updated.gstin} by ${actor} (id=${id})`);
    return toItem(updated);
  }

  /** Phase 161 #12 — field-change history for a profile. */
  async historyForRow(id: string, opts: { limit?: number } = {}): Promise<unknown[]> {
    const row = await this.prisma.platformGstProfile.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) throw new NotFoundAppException('Platform GST profile not found');
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return this.prisma.platformGstProfileHistory.findMany({
      where: { profileId: id },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  // ── helpers ──────────────────────────────────────────────────────

  private sanitize(value: string): string {
    return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  private requireName(value: string): string {
    const clean = this.sanitize(value ?? '');
    if (clean.length === 0) throw new BadRequestAppException('legalBusinessName is required');
    if (clean.length > 200) {
      throw new BadRequestAppException('legalBusinessName must be ≤ 200 characters');
    }
    return clean;
  }

  // Phase 161 #7 — PAN format (5 letters + 4 digits + 1 letter), uppercased.
  private validatePan(pan: string | null | undefined): string | null {
    if (pan === null || pan === undefined || pan === '') return null;
    const up = pan.toUpperCase().trim();
    if (!PAN_RE.test(up)) {
      throw new BadRequestAppException(
        'PAN must match the format AAAAA9999A (5 letters, 4 digits, 1 letter).',
      );
    }
    return up;
  }

  // Phase 161 #15 — registeredAddressJson must be a structured object (the
  // NIC e-invoice / e-way-bill payloads need addressLine1/city/pincode/state).
  // Reject primitives / arrays; require a 6-digit pincode when present.
  private validateAddress(json: unknown): Record<string, unknown> {
    if (json === null || json === undefined) return {};
    if (typeof json !== 'object' || Array.isArray(json)) {
      throw new BadRequestAppException(
        'registeredAddressJson must be an object (addressLine1, city, pincode, stateCode, ...).',
      );
    }
    const obj = json as Record<string, unknown>;
    const pincode = obj.pincode ?? obj.pinCode ?? obj.postalCode;
    if (pincode !== undefined && pincode !== null && !/^\d{6}$/.test(String(pincode))) {
      throw new BadRequestAppException('registeredAddressJson.pincode must be 6 digits.');
    }
    if (JSON.stringify(obj).length > 4000) {
      throw new BadRequestAppException('registeredAddressJson is too large (max 4000 chars).');
    }
    return obj;
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
        resource: 'platform_gst_profile',
        resourceId,
        oldValue: payload.before ?? undefined,
        newValue: payload.after ?? undefined,
        metadata: payload.reason ? { reason: payload.reason } : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `Platform GST audit-log write failed for ${resourceId}: ${(err as Error).message}`,
        ),
      );
  }

  private emit(
    eventName: string,
    profileId: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'PlatformGstProfile',
        aggregateId: profileId,
        occurredAt: new Date(),
        payload: { profileId, ...payload },
      })
      .catch(() => undefined);
  }
}

function snapshot(row: ProfileSnapshotRow): Record<string, unknown> {
  return {
    legalBusinessName: row.legalBusinessName,
    gstin: row.gstin,
    gstStateCode: row.gstStateCode,
    registrationType: row.registrationType,
    panLast4: row.panLast4,
    isDefault: row.isDefault,
    isActive: row.isActive,
    version: row.version,
  };
}

function toItem(row: {
  id: string;
  legalBusinessName: string;
  gstin: string;
  registeredAddressJson: unknown;
  gstStateCode: string;
  registrationType: GstRegistrationType;
  panLast4: string | null;
  panVerified: boolean;
  isDefault: boolean;
  isActive: boolean;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  deactivationReason: string | null;
  setDefaultReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PlatformGstProfileItem {
  // Phase 161 #7 — full PAN is intentionally NOT projected here.
  return {
    id: row.id,
    legalBusinessName: row.legalBusinessName,
    gstin: row.gstin,
    registeredAddressJson: row.registeredAddressJson,
    gstStateCode: row.gstStateCode,
    registrationType: row.registrationType,
    panLast4: row.panLast4,
    panVerified: row.panVerified,
    isDefault: row.isDefault,
    isActive: row.isActive,
    version: row.version,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    deactivationReason: row.deactivationReason,
    setDefaultReason: row.setDefaultReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
