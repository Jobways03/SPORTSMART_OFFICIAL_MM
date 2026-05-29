import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { BadRequestAppException } from '../../../../core/exceptions';

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
 *
 * Phase 28 (2026-05-21) — consent purposes are split:
 *
 *   • REVOCABLE_PURPOSES are toggleable from /account/privacy
 *     (cookies, marketing channels, personalization).
 *   • REGISTRATION_PURPOSES are one-shot acceptances at signup
 *     (TERMS_OF_SERVICE, PRIVACY_POLICY). The user cannot "revoke
 *     the TOS" — withdrawing that consent is account deletion, not
 *     a checkbox flip. They live in the same table so the audit
 *     trail + getCurrent enumerate them, but the DTO refuses to set
 *     them via the customer-portal POST.
 *
 * Every write now stamps `consentVersion` (default
 * CURRENT_POLICY_VERSION) so a DPDP auditor can answer "what notice
 * did the customer agree to on date X?" Pre-Phase-28 rows have a
 * null version; the next change re-stamps with the current one.
 */
@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * Toggleable consent purposes — exposed on /account/privacy.
   * Re-asserting one of these via POST /customer/consent is the
   * supported way to flip the value.
   */
  static readonly REVOCABLE_PURPOSES = [
    'COOKIE_ANALYTICS',
    'COOKIE_MARKETING',
    'EMAIL_MARKETING',
    'WHATSAPP_MARKETING',
    'SMS_MARKETING',
    'PERSONALIZED_RECOMMENDATIONS',
  ] as const;

  /**
   * One-shot acceptances captured at registration. Stored in the same
   * table so getCurrent + the audit trail enumerate them; rejected at
   * the customer-portal DTO boundary because withdrawing them is a
   * separate flow (account deletion / right-to-erasure).
   */
  static readonly REGISTRATION_PURPOSES = [
    'TERMS_OF_SERVICE',
    'PRIVACY_POLICY',
  ] as const;

  /** Full purpose allowlist — accepts both buckets at any write boundary. */
  static readonly PURPOSES = [
    ...ConsentService.REGISTRATION_PURPOSES,
    ...ConsentService.REVOCABLE_PURPOSES,
  ] as const;

  /**
   * Phase 28 (2026-05-21) — privacy-notice / TOS version stamped on
   * every consent row. When the customer-facing copy at /legal/privacy
   * or /legal/terms changes materially, bump this constant — existing
   * consents flagged with the older value are then "stale" and the UI
   * can prompt a re-confirm. Kept as a literal until a config table
   * lands.
   */
  static readonly CURRENT_POLICY_VERSION = '1.0';

  /** Marketing channel → consent purpose mapping for the notification gate. */
  private static readonly MARKETING_PURPOSE_BY_CHANNEL: Record<
    'EMAIL' | 'SMS' | 'WHATSAPP',
    string
  > = {
    EMAIL: 'EMAIL_MARKETING',
    SMS: 'SMS_MARKETING',
    WHATSAPP: 'WHATSAPP_MARKETING',
  };

  static isValidPurpose(value: string): value is ConsentPurpose {
    return (ConsentService.PURPOSES as readonly string[]).includes(value);
  }

  static isRevocablePurpose(value: string): boolean {
    return (ConsentService.REVOCABLE_PURPOSES as readonly string[]).includes(value);
  }

  /**
   * Channel → purpose lookup the notification gate uses to decide
   * whether a non-transactional send is allowed.
   */
  static marketingPurposeForChannel(channel: string): string | null {
    return ConsentService.MARKETING_PURPOSE_BY_CHANNEL[channel as 'EMAIL' | 'SMS' | 'WHATSAPP'] ?? null;
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
      select: {
        purpose: true,
        granted: true,
        updatedAt: true,
        consentVersion: true,
      },
    });

    const byPurpose = new Map<string, ConsentEntry>();
    for (const row of rows) {
      if (!ConsentService.isValidPurpose(row.purpose)) continue;
      byPurpose.set(row.purpose, {
        purpose: row.purpose,
        granted: row.granted,
        timestamp: row.updatedAt,
        consentVersion: row.consentVersion ?? null,
      });
    }

    // Backfill purposes the user has never touched with explicit false.
    const result: ConsentSnapshot = {};
    for (const purpose of ConsentService.PURPOSES) {
      result[purpose] = byPurpose.get(purpose) ?? {
        purpose,
        granted: false,
        timestamp: null,
        consentVersion: null,
      };
    }
    return result;
  }

  /**
   * Phase 28 (2026-05-21) — marketing-eligibility query consumed by
   * the notification gate. Returns true when the projection row for
   * (userId, purpose) exists and `granted=true`. A missing row is
   * treated as "not consented" (DPDP opt-IN default), so a customer
   * who has never visited /account/privacy is silent for marketing.
   *
   * Falls open on a DB error so a transient outage doesn't suppress
   * transactional-adjacent flows; the error is logged for ops.
   */
  async isAllowed(userId: string, purpose: string): Promise<boolean> {
    if (!ConsentService.isValidPurpose(purpose)) return false;
    try {
      const row = await this.prisma.consentRecord.findUnique({
        where: {
          consent_records_user_purpose_unique: { userId, purpose },
        },
        select: { granted: true },
      });
      return row?.granted === true;
    } catch (err) {
      this.logger.warn(
        `isAllowed lookup failed for user=${userId} purpose=${purpose}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Phase 28 (2026-05-21) — paginated audit-log history. DPDP §11
   * right-of-access requires that a customer can ask "show me my
   * consent changes." Reads from the AuditLog hash chain (the legal
   * record), filtered to module='consent' for this actor.
   */
  async getHistory(
    userId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    return this.audit.searchAuditHistory({
      module: 'consent',
      actorId: userId,
      limit,
      offset,
    });
  }

  /**
   * Record a consent change. Writes a single audit row with module='consent'
   * and action='GRANTED'|'REVOKED'. Idempotent against the current state
   * — re-asserting "granted=true" when already granted is a no-op (we
   * don't pollute the log with phantom changes).
   *
   * Phase 28 (2026-05-21) — every write now stamps the policy version.
   * Caller may override (e.g. registration writes the version that was
   * shown at signup); otherwise we default to CURRENT_POLICY_VERSION.
   */
  async setConsent(
    userId: string,
    purpose: string,
    granted: boolean,
    context: {
      ipAddress?: string;
      userAgent?: string;
      source?: string;
      consentVersion?: string;
    } = {},
  ): Promise<{
    purpose: string;
    granted: boolean;
    changed: boolean;
    consentVersion: string;
  }> {
    if (!ConsentService.isValidPurpose(purpose)) {
      throw new BadRequestAppException(
        `Unknown consent purpose "${purpose}". Allowed: ${ConsentService.PURPOSES.join(', ')}`,
      );
    }

    const consentVersion =
      context.consentVersion ?? ConsentService.CURRENT_POLICY_VERSION;

    // Idempotency: re-affirming the same state is a no-op.
    const current = await this.getCurrent(userId);
    if (current[purpose]?.granted === granted) {
      return {
        purpose,
        granted,
        changed: false,
        consentVersion: current[purpose]?.consentVersion ?? consentVersion,
      };
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
      oldValue: {
        granted: current[purpose]?.granted ?? false,
        consentVersion: current[purpose]?.consentVersion ?? null,
      },
      newValue: { granted, consentVersion },
      metadata: {
        source: context.source ?? 'customer-portal',
        consentVersion,
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
          consentVersion,
          source: context.source ?? 'customer-portal',
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
        update: {
          granted,
          consentVersion,
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

    return { purpose, granted, changed: true, consentVersion };
  }
}

export type ConsentPurpose = (typeof ConsentService.PURPOSES)[number];

export interface ConsentEntry {
  purpose: string;
  granted: boolean;
  timestamp: Date | null;
  /** Phase 28 (2026-05-21) — version stamped at the last grant/revoke. */
  consentVersion: string | null;
}

export type ConsentSnapshot = Record<string, ConsentEntry>;
