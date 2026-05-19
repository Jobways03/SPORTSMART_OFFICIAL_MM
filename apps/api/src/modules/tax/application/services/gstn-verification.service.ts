// Phase 35 GST — GstnVerificationService.
//
// Drives the "verify against GSTN portal" lifecycle for two target
// rows:
//   - SellerGstin (tax-master.prisma)        — the seller's onboarded
//     GST registration(s). Verifying flips `verifiedAt / verifiedBy /
//     verificationNotes` and (if the provider returns ACTIVE) marks
//     the row truly attested rather than admin-claimed.
//   - CustomerTaxProfile (tax-master.prisma) — a customer's saved B2B
//     GSTIN. Verifying flips `isVerified / verifiedAt / verifiedBy /
//     verificationNotes`.
//
// Today's local Mod-36 check confirms the GSTIN is well-formed but
// can't confirm it EXISTS on the GST roll. This service closes that
// gap by routing through a `GstnProvider` (stub for dev; the
// `sandbox` adapter is reserved for the GSTN sandbox API once
// credentials are issued).
//
// Notes recorded onto the row include the provider name, status,
// portal-returned legal name (so admins can spot name mismatches),
// and timestamp. Non-throwing on provider error — the failure is
// captured in `verificationNotes` and the row remains unverified.

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  GSTN_PROVIDER,
  GstnProvider,
  GstnVerifyResult,
} from '../../infrastructure/gstn/gstn-provider';

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
  /** True when the provider confirmed the GSTIN exists on the roll
   *  regardless of whether it's currently ACTIVE. False when the
   *  provider couldn't find the GSTIN or the call failed. */
  found: boolean;
  /** Portal status — only ACTIVE rows can issue invoices. The UI
   *  surfaces non-ACTIVE results as warnings. */
  status: string;
  legalName: string | null;
  /** True when the portal-returned legal name differs (case-
   *  insensitive, whitespace-normalised) from the locally-stored
   *  legalName. Surfaced so admins can review before approving. */
  legalNameMismatch: boolean;
  /** Verbatim notes persisted onto the row. */
  notes: string;
}

@Injectable()
export class GstnVerificationService {
  private readonly logger = new Logger(GstnVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(GSTN_PROVIDER) private readonly provider: GstnProvider,
  ) {}

  /**
   * Verify a SellerGstin row. Idempotent — re-running on an already-
   * verified row re-checks the portal status and refreshes the
   * verification timestamp. Notes are appended (not overwritten) so
   * the audit history remains intact.
   */
  async verifySellerGstin(args: {
    sellerGstinId: string;
    actorId: string;
  }): Promise<VerifyResult> {
    const row = await this.prisma.sellerGstin.findUnique({
      where: { id: args.sellerGstinId },
      select: { id: true, gstin: true, legalName: true },
    });
    if (!row) throw new SellerGstinNotFoundError(args.sellerGstinId);

    const { result, notes, mismatch } = await this.callProvider({
      gstin: row.gstin,
      localLegalName: row.legalName,
    });

    const verifiedAt = new Date();
    await this.prisma.sellerGstin.update({
      where: { id: row.id },
      data: {
        verifiedAt,
        verifiedBy: args.actorId,
        verificationNotes: notes,
      },
    });

    this.logger.log(
      `SellerGstin ${row.id} (${row.gstin}) verified via ${this.provider.name}: ` +
        `found=${result.found} status=${result.status} mismatch=${mismatch} by=${args.actorId}`,
    );

    return {
      verified: result.found && result.status === 'ACTIVE',
      found: result.found,
      status: result.status,
      legalName: result.legalName,
      legalNameMismatch: mismatch,
      notes,
    };
  }

  /**
   * Verify a CustomerTaxProfile row. Same shape as
   * `verifySellerGstin`. Flips `isVerified` only when the provider
   * confirms the GSTIN is found AND ACTIVE — SUSPENDED / CANCELLED
   * GSTINs land in the row but stay unverified.
   */
  async verifyCustomerTaxProfile(args: {
    profileId: string;
    actorId: string;
  }): Promise<VerifyResult> {
    const row = await this.prisma.customerTaxProfile.findUnique({
      where: { id: args.profileId },
      select: { id: true, gstin: true, legalName: true },
    });
    if (!row) {
      throw new CustomerTaxProfileNotFoundError(args.profileId);
    }

    const { result, notes, mismatch } = await this.callProvider({
      gstin: row.gstin,
      localLegalName: row.legalName,
    });

    const verifiedAt = new Date();
    const isVerified = result.found && result.status === 'ACTIVE';
    await this.prisma.customerTaxProfile.update({
      where: { id: row.id },
      data: {
        isVerified,
        verifiedAt,
        verifiedBy: args.actorId,
        verificationNotes: notes,
      },
    });

    this.logger.log(
      `CustomerTaxProfile ${row.id} (${row.gstin}) verified via ${this.provider.name}: ` +
        `found=${result.found} status=${result.status} verified=${isVerified} mismatch=${mismatch} by=${args.actorId}`,
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

  /**
   * Common provider call + result-shaping. Returns the raw provider
   * result, the human-readable note line we persist on the row, and
   * the legal-name-mismatch flag.
   */
  private async callProvider(args: {
    gstin: string;
    localLegalName: string | null;
  }): Promise<{
    result: GstnVerifyResult;
    notes: string;
    mismatch: boolean;
  }> {
    let result: GstnVerifyResult;
    try {
      result = await this.provider.verify({ gstin: args.gstin });
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
          `[${new Date().toISOString()}] provider=${this.provider.name} ` +
          `error: ${reason}`,
        mismatch: false,
      };
    }

    const mismatch =
      result.found &&
      result.legalName != null &&
      args.localLegalName != null &&
      normalize(result.legalName) !== normalize(args.localLegalName);

    const noteParts: string[] = [
      `[${new Date().toISOString()}]`,
      `provider=${this.provider.name}`,
      `found=${result.found}`,
      `status=${result.status}`,
    ];
    if (result.legalName) {
      noteParts.push(`portalLegalName="${result.legalName}"`);
    }
    if (mismatch) {
      noteParts.push(
        `legalNameMismatch=true (local="${args.localLegalName}")`,
      );
    }
    return { result, notes: noteParts.join(' '), mismatch };
  }
}

function normalize(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ');
}
