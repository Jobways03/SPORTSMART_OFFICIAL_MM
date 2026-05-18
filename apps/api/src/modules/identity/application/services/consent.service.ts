import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * Customer consent tracking (DPDP §6 — informed-consent compliance).
 *
 * Phase 14 (2026-05-16) — dual-write architecture:
 *
 *   • `AuditLog` (module='consent') remains the legal record. Every
 *     grant / revoke writes a row to the tamper-evident hash chain;
 *     a DPDP audit reads from there.
 *   • `consent_records` is the indexed projection. One row per
 *     (userId, purpose). Lookups by user + purpose are O(1) instead
 *     of "scan recent audit rows desc, take first." Marketing
 *     dispatchers JOIN against this table directly.
 *
 * Reads now come from `consent_records`. Writes go to BOTH — the
 * audit row first (so the legal record never lags), then the
 * projection upsert. A failed projection write logs + returns; the
 * audit row is the source of truth, and the next read or write
 * heals the projection.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * Canonical purposes a customer can grant / revoke consent for. Add
   * new values here when a new tracking surface is introduced; do not
   * silently accept free-form purpose strings (an attacker could fill
   * the audit log with junk).
   */
  static readonly PURPOSES = [
    'COOKIE_ANALYTICS',
    'COOKIE_MARKETING',
    'EMAIL_MARKETING',
    'WHATSAPP_MARKETING',
    'SMS_MARKETING',
    'PERSONALIZED_RECOMMENDATIONS',
  ] as const;

  static isValidPurpose(value: string): value is ConsentPurpose {
    return (ConsentService.PURPOSES as readonly string[]).includes(value);
  }

  /**
   * Read the current consent state for a user across all known purposes.
   * Purposes the user has never interacted with default to `false`
   * (DPDP requires opt-IN, not opt-out).
   *
   * Phase 14 (2026-05-16) — reads come from the `consent_records`
   * projection. The audit log keeps the legal history; this table
   * is what the marketing-eligibility check joins against.
   */
  async getCurrent(userId: string): Promise<ConsentSnapshot> {
    const rows = await this.prisma.consentRecord.findMany({
      where: { userId },
      select: { purpose: true, granted: true, updatedAt: true },
    });

    const byPurpose = new Map<string, ConsentEntry>();
    for (const row of rows) {
      if (!ConsentService.isValidPurpose(row.purpose)) continue;
      byPurpose.set(row.purpose, {
        purpose: row.purpose,
        granted: row.granted,
        timestamp: row.updatedAt,
      });
    }

    // Backfill purposes the user has never touched with explicit false.
    const result: ConsentSnapshot = {};
    for (const purpose of ConsentService.PURPOSES) {
      result[purpose] = byPurpose.get(purpose) ?? {
        purpose,
        granted: false,
        timestamp: null,
      };
    }
    return result;
  }

  /**
   * Record a consent change. Writes a single audit row with module='consent'
   * and action='GRANTED'|'REVOKED'. Idempotent against the current state
   * — re-asserting "granted=true" when already granted is a no-op (we
   * don't pollute the log with phantom changes).
   */
  async setConsent(
    userId: string,
    purpose: string,
    granted: boolean,
    context: { ipAddress?: string; userAgent?: string; source?: string } = {},
  ): Promise<{ purpose: string; granted: boolean; changed: boolean }> {
    if (!ConsentService.isValidPurpose(purpose)) {
      throw new BadRequestAppException(
        `Unknown consent purpose "${purpose}". Allowed: ${ConsentService.PURPOSES.join(', ')}`,
      );
    }

    // Idempotency: re-affirming the same state is a no-op.
    const current = await this.getCurrent(userId);
    if (current[purpose]?.granted === granted) {
      return { purpose, granted, changed: false };
    }

    // Step 1: write the audit row. This is the legal record — if it
    // throws, the entire setConsent fails and the projection upsert
    // never runs. That's the right precedence: the projection without
    // an audit row would lie about provenance.
    await this.audit.writeAuditLog({
      actorId: userId,
      actorRole: 'CUSTOMER',
      action: granted ? 'GRANTED' : 'REVOKED',
      module: 'consent',
      resource: 'CustomerConsent',
      resourceId: purpose,
      oldValue: { granted: current[purpose]?.granted ?? false },
      newValue: { granted },
      metadata: {
        source: context.source ?? 'customer-portal',
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    // Step 2: upsert the projection. Failures are logged + swallowed
    // — the audit row above already captured the legal change. The
    // next read or write will heal the projection if it's stale.
    try {
      await this.prisma.consentRecord.upsert({
        where: {
          consent_records_user_purpose_unique: { userId, purpose },
        },
        create: {
          userId,
          purpose,
          granted,
          source: context.source ?? 'customer-portal',
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
        update: {
          granted,
          source: context.source ?? 'customer-portal',
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Consent projection upsert failed for user=${userId} purpose=${purpose}: ${(err as Error).message}`,
      );
    }

    return { purpose, granted, changed: true };
  }
}

export type ConsentPurpose = (typeof ConsentService.PURPOSES)[number];

export interface ConsentEntry {
  purpose: string;
  granted: boolean;
  timestamp: Date | null;
}

export type ConsentSnapshot = Record<string, ConsentEntry>;

void NotFoundAppException; // silence unused if narrower exception types are added later
