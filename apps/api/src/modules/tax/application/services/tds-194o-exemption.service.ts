// Phase 161 (TDS §194-O exempt seller flow audit) — Tds194OExemptionService.
//
// Owns the grant / revoke lifecycle of a seller's Section 194-O TDS
// exemption. Pre-Phase-161 this was inline in the admin controller: a binary
// flag flip that destroyed attestation history on revoke, with no audit, no
// history, optional reason, and no effective-dating. This service:
//   B3  requires a reason on grant.
//   B4  revoke does NOT null the attestation fields (keeps last-known-good);
//       stamps revoked_by/at/reason + closes the effective window instead.
//   B1  effective-dating (effectiveFrom default now, optional effectiveTo).
//   #5  AuditPublicFacade row on grant + revoke.
//   #6  append-only SellerTdsExemptionHistory row per change.
//   #11 publishes tax.seller.tds194o_exemption_(granted|revoked) events.
//   #16 bulk grant/revoke (annual revalidation ergonomics).

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { TaxNotificationService } from './tax-notification.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

export const TDS194O_EXEMPTION_EVENTS = {
  GRANTED: 'tax.seller.tds194o_exemption_granted',
  REVOKED: 'tax.seller.tds194o_exemption_revoked',
} as const;

const EXEMPTION_SELECT = {
  id: true,
  is194OExempt: true,
  exempt194OReason: true,
  exempt194OAttestedBy: true,
  exempt194OAttestedAt: true,
  exempt194OEffectiveFrom: true,
  exempt194OEffectiveTo: true,
  exempt194ORevokedBy: true,
  exempt194ORevokedAt: true,
  exempt194ORevokeReason: true,
} as const;

export interface SetExemptionArgs {
  sellerId: string;
  reason: string;
  effectiveFrom?: string | Date | null;
  effectiveTo?: string | Date | null;
  actorId: string;
  ipAddress?: string | null;
}

export interface RevokeExemptionArgs {
  sellerId: string;
  reason: string;
  actorId: string;
  ipAddress?: string | null;
}

@Injectable()
export class Tds194OExemptionService {
  private readonly logger = new Logger(Tds194OExemptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    @Optional() private readonly eventBus?: EventBusService,
    // #13 — best-effort seller notification on exemption change.
    @Optional() private readonly notifications?: TaxNotificationService,
  ) {}

  async grant(args: SetExemptionArgs) {
    const reason = (args.reason ?? '').trim();
    if (reason.length < 8) {
      throw new BadRequestAppException(
        'A documented reason (min 8 chars) is required to grant a §194-O exemption (CBIC attestation basis).',
      );
    }
    const effectiveFrom = this.parseDate(args.effectiveFrom) ?? new Date();
    const effectiveTo = this.parseDate(args.effectiveTo);
    if (effectiveTo && effectiveTo.getTime() <= effectiveFrom.getTime()) {
      throw new BadRequestAppException('effectiveTo must be after effectiveFrom.');
    }

    const before = await this.prisma.seller.findUnique({
      where: { id: args.sellerId },
      select: EXEMPTION_SELECT,
    });
    if (!before) throw new NotFoundAppException(`Seller ${args.sellerId} not found`);

    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.seller.update({
        where: { id: args.sellerId },
        data: {
          is194OExempt: true,
          exempt194OReason: reason,
          exempt194OAttestedBy: args.actorId,
          exempt194OAttestedAt: new Date(),
          exempt194OEffectiveFrom: effectiveFrom,
          exempt194OEffectiveTo: effectiveTo,
          // Re-granting after a prior revoke clears the revoke trail (the
          // history table preserves it).
          exempt194ORevokedBy: null,
          exempt194ORevokedAt: null,
          exempt194ORevokeReason: null,
        },
        select: EXEMPTION_SELECT,
      });
      await tx.sellerTdsExemptionHistory.create({
        data: {
          sellerId: args.sellerId,
          action: 'EXEMPT',
          isExempt: true,
          reason,
          effectiveFrom,
          effectiveTo,
          changedBy: args.actorId,
        },
      });
      return updated;
    });

    await this.writeAudit(args.actorId, TDS194O_EXEMPTION_EVENTS.GRANTED, args.sellerId, {
      before,
      after,
      reason,
      ipAddress: args.ipAddress,
    });
    this.emit(TDS194O_EXEMPTION_EVENTS.GRANTED, args.sellerId, {
      effectiveFrom: effectiveFrom.toISOString(),
      effectiveTo: effectiveTo?.toISOString() ?? null,
    });
    void this.notifications
      ?.sellerTds194OExemptionChanged({ sellerId: args.sellerId, exempt: true, reason, effectiveFrom })
      .catch(() => undefined);
    this.logger.log(
      `§194-O exemption GRANTED for seller ${args.sellerId} by ${args.actorId} ` +
        `(from ${effectiveFrom.toISOString()}${effectiveTo ? ` to ${effectiveTo.toISOString()}` : ', open-ended'})`,
    );
    return after;
  }

  async revoke(args: RevokeExemptionArgs) {
    const reason = (args.reason ?? '').trim();
    if (reason.length < 8) {
      throw new BadRequestAppException(
        'A reason (min 8 chars) is required to revoke a §194-O exemption.',
      );
    }
    const before = await this.prisma.seller.findUnique({
      where: { id: args.sellerId },
      select: EXEMPTION_SELECT,
    });
    if (!before) throw new NotFoundAppException(`Seller ${args.sellerId} not found`);

    const now = new Date();
    const after = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.seller.update({
        where: { id: args.sellerId },
        data: {
          is194OExempt: false,
          // B4 — KEEP exempt194OReason / AttestedBy / AttestedAt as the
          // last-known-good attestation; only stamp the revoke trail + close
          // the effective window.
          exempt194OEffectiveTo: now,
          exempt194ORevokedBy: args.actorId,
          exempt194ORevokedAt: now,
          exempt194ORevokeReason: reason,
        },
        select: EXEMPTION_SELECT,
      });
      await tx.sellerTdsExemptionHistory.create({
        data: {
          sellerId: args.sellerId,
          action: 'REVOKE',
          isExempt: false,
          reason: before.exempt194OReason,
          effectiveFrom: before.exempt194OEffectiveFrom,
          effectiveTo: now,
          changedBy: args.actorId,
          changeReason: reason,
        },
      });
      return updated;
    });

    await this.writeAudit(args.actorId, TDS194O_EXEMPTION_EVENTS.REVOKED, args.sellerId, {
      before,
      after,
      reason,
      ipAddress: args.ipAddress,
    });
    this.emit(TDS194O_EXEMPTION_EVENTS.REVOKED, args.sellerId, { reason });
    void this.notifications
      ?.sellerTds194OExemptionChanged({ sellerId: args.sellerId, exempt: false, reason })
      .catch(() => undefined);
    this.logger.log(`§194-O exemption REVOKED for seller ${args.sellerId} by ${args.actorId}`);
    return after;
  }

  /**
   * #16 — bulk grant/revoke for annual revalidation. Each row is applied
   * independently; a per-seller failure is captured, not fatal.
   */
  async bulk(args: {
    actorId: string;
    ipAddress?: string | null;
    items: Array<{ sellerId: string; exempt: boolean; reason: string; effectiveFrom?: string; effectiveTo?: string }>;
  }): Promise<{ ok: number; failed: Array<{ sellerId: string; error: string }> }> {
    if (!Array.isArray(args.items) || args.items.length === 0) {
      throw new BadRequestAppException('bulk requires a non-empty items list');
    }
    if (args.items.length > 500) {
      throw new BadRequestAppException('bulk is capped at 500 sellers per request');
    }
    let ok = 0;
    const failed: Array<{ sellerId: string; error: string }> = [];
    for (const it of args.items) {
      try {
        if (it.exempt) {
          await this.grant({
            sellerId: it.sellerId,
            reason: it.reason,
            effectiveFrom: it.effectiveFrom,
            effectiveTo: it.effectiveTo,
            actorId: args.actorId,
            ipAddress: args.ipAddress,
          });
        } else {
          await this.revoke({
            sellerId: it.sellerId,
            reason: it.reason,
            actorId: args.actorId,
            ipAddress: args.ipAddress,
          });
        }
        ok++;
      } catch (e) {
        failed.push({ sellerId: it.sellerId, error: (e as Error).message });
      }
    }
    return { ok, failed };
  }

  // ── helpers ────────────────────────────────────────────────────────

  private parseDate(v: string | Date | null | undefined): Date | null {
    if (v === null || v === undefined || v === '') return null;
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) {
      throw new BadRequestAppException(`Invalid date: ${String(v)}`);
    }
    return d;
  }

  private async writeAudit(
    actorId: string,
    action: string,
    sellerId: string,
    payload: { before: unknown; after: unknown; reason: string; ipAddress?: string | null },
  ): Promise<void> {
    await this.audit
      .writeAuditLog({
        actorId,
        action,
        module: 'tax',
        resource: 'seller_tds194o_exemption',
        resourceId: sellerId,
        oldValue: payload.before ?? undefined,
        newValue: payload.after ?? undefined,
        metadata: {
          reason: payload.reason,
          ...(payload.ipAddress ? { ipAddress: payload.ipAddress } : {}),
        },
      })
      .catch((err) =>
        this.logger.error(
          `§194-O exemption audit-log write failed for ${sellerId}: ${(err as Error).message}`,
        ),
      );
  }

  private emit(eventName: string, sellerId: string, payload: Record<string, unknown>): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'Seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: { sellerId, ...payload },
      })
      .catch(() => undefined);
  }
}
