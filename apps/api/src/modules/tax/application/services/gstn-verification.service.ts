// Phase 35 GST — GstnVerificationService.
//
// Drives the "verify against GSTN portal" lifecycle for two target rows:
//   - SellerGstin (tax-master.prisma)        — the seller's onboarded
//     GST registration(s).
//   - CustomerTaxProfile (tax-master.prisma) — a customer's saved B2B GSTIN.
//
// Today's local Mod-36 check confirms the GSTIN is well-formed but can't
// confirm it EXISTS on the GST roll. This service closes that gap by routing
// through a `GstnProvider` (stub for dev; the `sandbox` adapter lands once
// credentials are issued).
//
// Phase 161 (Seller GSTIN Verification audit) hardening:
//   B1  legalNameMismatch + gstLegalName persisted as QUERYABLE columns
//       (were buried in the verificationNotes text blob).
//   B2  verifiedAt = last SUCCESSFUL verification only; lastCheckedAt = every
//       attempt. A NOT_FOUND / SUSPENDED / CANCELLED result no longer makes
//       the row look "verified".
//   B3  SellerGstin.isVerified now set (= found && ACTIVE), mirroring
//       CustomerTaxProfile.
//   B4  verificationNotes APPENDED (bounded), and every attempt recorded in
//       the append-only GstinVerificationEvent table — re-verify no longer
//       loses history (the header's old "appended" promise is now true).
//   B5  gstnRawResponseJson / gstnPortalStatus / lastVerifiedProvider /
//       verificationFailureReason persisted for the compliance audit trail.
//   #8  AuditPublicFacade row + lifecycle event on every verification.
//   #11 fuzzy legal-name match (abbreviation expansion + Levenshtein ≥ 0.9)
//       so "ACME PVT LTD" vs "Acme Private Limited" is NOT a false mismatch.
//   #13 re-verify cooldown (GSTN_REVERIFY_COOLDOWN_HOURS, default 0 = off)
//       returns the cached row instead of hammering the provider quota.
//   #14 transient provider failures retried (immediate, N attempts).

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  GSTN_PROVIDER,
  GstnProvider,
  GstnVerifyResult,
} from '../../infrastructure/gstn/gstn-provider';

export const GSTN_VERIFICATION_EVENTS = {
  VERIFIED: 'tax.gstin.verified',
  FAILED: 'tax.gstin.verification_failed',
  MISMATCH: 'tax.gstin.legal_name_mismatch',
} as const;

const NOTES_MAX_LINES = 50;
const PROVIDER_RETRY_ATTEMPTS = 2;

export class SellerGstinNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`SellerGstin ${id} not found`);
    this.name = 'SellerGstinNotFoundError';
  }
}

export class CustomerTaxProfileNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`CustomerTaxProfile ${id} not found`);
    this.name = 'CustomerTaxProfileNotFoundError';
  }
}

export interface VerifyResult {
  verified: boolean;
  found: boolean;
  status: string;
  legalName: string | null;
  legalNameMismatch: boolean;
  notes: string;
  /** True when the cooldown short-circuited the provider call (#13). */
  cached?: boolean;
}

@Injectable()
export class GstnVerificationService {
  private readonly logger = new Logger(GstnVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GSTN_PROVIDER) private readonly provider: GstnProvider,
    private readonly audit: AuditPublicFacade,
    @Optional() private readonly env?: EnvService,
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  async verifySellerGstin(args: {
    sellerGstinId: string;
    actorId: string;
    force?: boolean;
    ipAddress?: string | null;
  }): Promise<VerifyResult> {
    const row = await this.prisma.sellerGstin.findUnique({
      where: { id: args.sellerGstinId },
    });
    if (!row) throw new SellerGstinNotFoundError(args.sellerGstinId);

    // #13 — cooldown: skip the provider call if we checked recently.
    const cached = this.cooldownHit(row.lastCheckedAt, args.force);
    if (cached) {
      return {
        verified: row.isVerified,
        found: row.isVerified || !!row.gstLegalName,
        status: row.gstnPortalStatus ?? 'UNKNOWN',
        legalName: row.gstLegalName,
        legalNameMismatch: row.legalNameMismatch,
        notes: row.verificationNotes ?? '',
        cached: true,
      };
    }

    const { result, notes, mismatch, failureReason } = await this.callProvider({
      gstin: row.gstin,
      localLegalName: row.legalName,
    });
    const isVerified = result.found && result.status === 'ACTIVE';
    const now = new Date();

    await this.prisma.sellerGstin.update({
      where: { id: row.id },
      data: {
        isVerified,
        // B2 — verifiedAt = last SUCCESS only; preserve prior on failure.
        verifiedAt: isVerified ? now : row.verifiedAt,
        lastCheckedAt: now,
        verifiedBy: args.actorId,
        legalNameMismatch: mismatch,
        gstLegalName: result.legalName,
        gstnPortalStatus: result.status,
        gstnRawResponseJson: (result.rawResponse ?? null) as Prisma.InputJsonValue,
        lastVerifiedProvider: this.provider.name,
        verificationFailureReason: isVerified ? null : failureReason,
        verificationNotes: this.appendNotes(row.verificationNotes, notes),
      },
    });

    await this.recordEvent('SELLER_GSTIN', row.id, row.gstin, args.actorId, result, isVerified, mismatch, failureReason);
    await this.writeAuditAndEvent({
      target: 'seller_gstin',
      targetId: row.id,
      gstin: row.gstin,
      actorId: args.actorId,
      ipAddress: args.ipAddress,
      isVerified,
      mismatch,
      status: result.status,
    });

    this.logger.log(
      `SellerGstin ${row.id} (${row.gstin}) via ${this.provider.name}: ` +
        `verified=${isVerified} found=${result.found} status=${result.status} mismatch=${mismatch} by=${args.actorId}`,
    );

    return {
      verified: isVerified,
      found: result.found,
      status: result.status,
      legalName: result.legalName,
      legalNameMismatch: mismatch,
      notes,
    };
  }

  async verifyCustomerTaxProfile(args: {
    profileId: string;
    actorId: string;
    force?: boolean;
    ipAddress?: string | null;
  }): Promise<VerifyResult> {
    const row = await this.prisma.customerTaxProfile.findUnique({
      where: { id: args.profileId },
    });
    if (!row) throw new CustomerTaxProfileNotFoundError(args.profileId);

    const cached = this.cooldownHit(row.lastCheckedAt, args.force);
    if (cached) {
      return {
        verified: row.isVerified,
        found: row.isVerified || !!row.gstLegalName,
        status: row.gstnPortalStatus ?? 'UNKNOWN',
        legalName: row.gstLegalName,
        legalNameMismatch: row.legalNameMismatch,
        notes: row.verificationNotes ?? '',
        cached: true,
      };
    }

    const { result, notes, mismatch, failureReason } = await this.callProvider({
      gstin: row.gstin,
      localLegalName: row.legalName,
    });
    const isVerified = result.found && result.status === 'ACTIVE';
    const now = new Date();

    await this.prisma.customerTaxProfile.update({
      where: { id: row.id },
      data: {
        isVerified,
        verifiedAt: isVerified ? now : row.verifiedAt,
        lastCheckedAt: now,
        verifiedBy: args.actorId,
        legalNameMismatch: mismatch,
        gstLegalName: result.legalName,
        gstnPortalStatus: result.status,
        gstnRawResponseJson: (result.rawResponse ?? null) as Prisma.InputJsonValue,
        lastVerifiedProvider: this.provider.name,
        verificationFailureReason: isVerified ? null : failureReason,
        verificationNotes: this.appendNotes(row.verificationNotes, notes),
      },
    });

    await this.recordEvent('CUSTOMER_TAX_PROFILE', row.id, row.gstin, args.actorId, result, isVerified, mismatch, failureReason);
    await this.writeAuditAndEvent({
      target: 'customer_tax_profile',
      targetId: row.id,
      gstin: row.gstin,
      actorId: args.actorId,
      ipAddress: args.ipAddress,
      isVerified,
      mismatch,
      status: result.status,
    });

    this.logger.log(
      `CustomerTaxProfile ${row.id} (${row.gstin}) via ${this.provider.name}: ` +
        `verified=${isVerified} found=${result.found} status=${result.status} mismatch=${mismatch} by=${args.actorId}`,
    );

    return {
      verified: isVerified,
      found: result.found,
      status: result.status,
      legalName: result.legalName,
      legalNameMismatch: mismatch,
      notes,
    };
  }

  // ── provider + helpers ────────────────────────────────────────────

  private async callProvider(args: {
    gstin: string;
    localLegalName: string | null;
  }): Promise<{
    result: GstnVerifyResult;
    notes: string;
    mismatch: boolean;
    failureReason: string | null;
  }> {
    let result: GstnVerifyResult;
    try {
      result = await this.withRetry(() => this.provider.verify({ gstin: args.gstin }));
    } catch (err) {
      const reason = (err as Error).message;
      return {
        result: {
          found: false,
          legalName: null,
          stateCode: null,
          registrationType: null,
          status: 'UNKNOWN',
          rawResponse: { error: reason },
        },
        notes:
          `[${new Date().toISOString()}] provider=${this.provider.name} error: ${reason}`,
        mismatch: false,
        failureReason: reason,
      };
    }

    // #11 — fuzzy match (abbreviation-aware + Levenshtein) to avoid the
    // false mismatches exact-compare produced (PVT LTD vs Private Limited).
    const mismatch =
      result.found &&
      result.legalName != null &&
      args.localLegalName != null &&
      !legalNamesMatch(result.legalName, args.localLegalName);

    const failureReason = result.found
      ? result.status === 'ACTIVE'
        ? null
        : `GSTIN found but portal status is ${result.status}`
      : 'GSTIN not found on the GST roll';

    const noteParts: string[] = [
      `[${new Date().toISOString()}]`,
      `provider=${this.provider.name}`,
      `found=${result.found}`,
      `status=${result.status}`,
    ];
    if (result.legalName) noteParts.push(`portalLegalName="${result.legalName}"`);
    if (mismatch) noteParts.push(`legalNameMismatch=true (local="${args.localLegalName}")`);
    return { result, notes: noteParts.join(' '), mismatch, failureReason };
  }

  /** #14 — retry transient provider failures (immediate, bounded). */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= PROVIDER_RETRY_ATTEMPTS; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /** #13 — true when a prior check is within the configured cooldown. */
  private cooldownHit(lastCheckedAt: Date | null, force?: boolean): boolean {
    if (force || !lastCheckedAt) return false;
    const hours = this.env?.getNumber?.('GSTN_REVERIFY_COOLDOWN_HOURS', 0) ?? 0;
    if (!hours || hours <= 0) return false;
    return Date.now() - lastCheckedAt.getTime() < hours * 60 * 60 * 1000;
  }

  /** B4 — append the latest note, bounded to the most recent N lines. */
  private appendNotes(existing: string | null, latest: string): string {
    if (!existing) return latest;
    const lines = `${existing}\n${latest}`.split('\n');
    return lines.slice(-NOTES_MAX_LINES).join('\n');
  }

  private async recordEvent(
    targetType: 'SELLER_GSTIN' | 'CUSTOMER_TAX_PROFILE',
    targetId: string,
    gstin: string,
    actorId: string,
    result: GstnVerifyResult,
    isVerified: boolean,
    mismatch: boolean,
    failureReason: string | null,
  ): Promise<void> {
    // Append-only history (B4/#8). Best-effort — never block verification.
    await this.prisma.gstinVerificationEvent
      .create({
        data: {
          targetType,
          targetId,
          gstin,
          provider: this.provider.name,
          actorId,
          found: result.found,
          verified: isVerified,
          status: result.status,
          portalLegalName: result.legalName,
          legalNameMismatch: mismatch,
          failureReason,
          rawResponseJson: (result.rawResponse ?? null) as Prisma.InputJsonValue,
        },
      })
      .catch((err) =>
        this.logger.error(
          `GSTIN verification-event write failed for ${targetId}: ${(err as Error).message}`,
        ),
      );
  }

  private async writeAuditAndEvent(args: {
    target: string;
    targetId: string;
    gstin: string;
    actorId: string;
    ipAddress?: string | null;
    isVerified: boolean;
    mismatch: boolean;
    status: string;
  }): Promise<void> {
    await this.audit
      .writeAuditLog({
        actorId: args.actorId,
        action: args.isVerified
          ? GSTN_VERIFICATION_EVENTS.VERIFIED
          : GSTN_VERIFICATION_EVENTS.FAILED,
        module: 'tax-master',
        resource: args.target,
        resourceId: args.targetId,
        newValue: {
          gstin: args.gstin,
          isVerified: args.isVerified,
          legalNameMismatch: args.mismatch,
          status: args.status,
          provider: this.provider.name,
        },
        metadata: args.ipAddress ? { ipAddress: args.ipAddress } : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `GSTIN audit-log write failed for ${args.targetId}: ${(err as Error).message}`,
        ),
      );
    if (this.eventBus) {
      const eventName = args.mismatch
        ? GSTN_VERIFICATION_EVENTS.MISMATCH
        : args.isVerified
          ? GSTN_VERIFICATION_EVENTS.VERIFIED
          : GSTN_VERIFICATION_EVENTS.FAILED;
      void this.eventBus
        .publish({
          eventName,
          aggregate: 'GstinVerification',
          aggregateId: args.targetId,
          occurredAt: new Date(),
          payload: {
            target: args.target,
            targetId: args.targetId,
            gstin: args.gstin,
            isVerified: args.isVerified,
            legalNameMismatch: args.mismatch,
            status: args.status,
          },
        })
        .catch(() => undefined);
    }
  }
}

// ── legal-name matching (#11) ────────────────────────────────────────

function normalize(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ');
}

// Common GSTN legal-suffix abbreviations → canonical long form so
// "PVT LTD" / "Pvt. Ltd." / "Private Limited" all collapse to one token set.
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bPVT\b/g, 'PRIVATE'],
  [/\bLTD\b/g, 'LIMITED'],
  [/\bLLP\b/g, 'LIMITED LIABILITY PARTNERSHIP'],
  [/\bCORP\b/g, 'CORPORATION'],
  [/\bCO\b/g, 'COMPANY'],
  [/\bINC\b/g, 'INCORPORATED'],
  [/&/g, 'AND'],
];

function canonicalName(s: string): string {
  let n = normalize(s).replace(/[.,]/g, ' ');
  for (const [re, rep] of ABBREVIATIONS) n = n.replace(re, rep);
  return n.replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Exact-after-canonicalisation OR ≥ 90% similar. Exported for tests. */
export function legalNamesMatch(portal: string, local: string): boolean {
  const a = canonicalName(portal);
  const b = canonicalName(local);
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  const similarity = 1 - levenshtein(a, b) / maxLen;
  return similarity >= 0.9;
}
