import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { resolveTrustedMediaHosts } from '../../../../core/util/trusted-media-hosts';
import { AffiliateEncryptionService } from './affiliate-encryption.service';

/**
 * SRS §5.2 — KYC capture and admin verification. PAN is mandatory
 * (required for TDS); Aadhaar / document URLs are optional.
 *
 * Flow:
 *   submit  → status = PENDING (or re-submission after REJECTED)
 *   verify  → status = VERIFIED, mirrored onto affiliate.kycStatus
 *   reject  → status = REJECTED, reason captured
 *
 * The full PAN / Aadhaar values are encrypted at rest. Only the
 * last-4 chars and the verification status are kept in plaintext
 * for fraud lookup and admin display.
 */
@Injectable()
export class AffiliateKycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: AffiliateEncryptionService,
    private readonly env: EnvService,
  ) {}

  /**
   * Submit / re-submit KYC. Idempotent on affiliateId — re-submitting
   * after a REJECTED decision overwrites the previous payload and
   * resets status to PENDING for re-review.
   */
  async submit(input: {
    affiliateId: string;
    panNumber: string;
    aadhaarNumber?: string;
    panDocumentUrl?: string;
    aadhaarDocumentUrl?: string;
  }) {
    const pan = input.panNumber.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      throw new BadRequestAppException(
        'PAN must match the format ABCDE1234F (5 letters, 4 digits, 1 letter).',
      );
    }
    const aadhaar = input.aadhaarNumber?.replace(/\s+/g, '');
    if (aadhaar && !/^[0-9]{12}$/.test(aadhaar)) {
      throw new BadRequestAppException('Aadhaar must be exactly 12 digits.');
    }

    // #252.9 (2026-06-03) — Defence in depth: re-validate the document URLs
    // against the media host allowlist even for callers that bypass the
    // DTO (internal / service-to-service), so a foreign or SSRF host can never
    // be persisted onto a KYC record an admin will later open.
    this.assertAllowedKycUrl(input.panDocumentUrl, 'panDocumentUrl');
    this.assertAllowedKycUrl(input.aadhaarDocumentUrl, 'aadhaarDocumentUrl');

    const panEnc = this.encryption.encrypt(pan)!;
    const aadhaarEnc = aadhaar ? this.encryption.encrypt(aadhaar) : null;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.affiliateKyc.findUnique({
        where: { affiliateId: input.affiliateId },
        select: { id: true, status: true },
      });

      const data = {
        panNumberEnc: panEnc.enc,
        panNumberIv: panEnc.iv,
        panLast4: this.encryption.last4(pan),
        aadhaarNumberEnc: aadhaarEnc?.enc ?? null,
        aadhaarNumberIv: aadhaarEnc?.iv ?? null,
        aadhaarLast4: aadhaar ? this.encryption.last4(aadhaar) : null,
        panDocumentUrl: input.panDocumentUrl ?? null,
        aadhaarDocumentUrl: input.aadhaarDocumentUrl ?? null,
        status: 'PENDING' as const,
        rejectedAt: null,
        rejectionReason: null,
      };

      const kyc = existing
        ? await tx.affiliateKyc.update({
            where: { affiliateId: input.affiliateId },
            data,
          })
        : await tx.affiliateKyc.create({
            data: { ...data, affiliateId: input.affiliateId },
          });

      // Mirror summary status onto the Affiliate row for fast reads.
      await tx.affiliate.update({
        where: { id: input.affiliateId },
        data: { kycStatus: 'PENDING', kycVerifiedAt: null },
      });

      return this.toPublic(kyc);
    });
  }

  async getMine(affiliateId: string) {
    const kyc = await this.prisma.affiliateKyc.findUnique({
      where: { affiliateId },
    });
    return kyc ? this.toPublic(kyc) : null;
  }

  async getForAdmin(affiliateId: string) {
    const kyc = await this.prisma.affiliateKyc.findUnique({
      where: { affiliateId },
    });
    return kyc ? this.toAdminView(kyc) : null;
  }

  /**
   * Admin verifies the KYC submission. Records who verified and when.
   * Mirrors `kycStatus = VERIFIED` onto the affiliate for the SRS
   * §15.1 "KYC must be VERIFIED before payout" eligibility gate.
   */
  async verify(input: { affiliateId: string; adminId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const kyc = await tx.affiliateKyc.findUnique({
        where: { affiliateId: input.affiliateId },
      });
      if (!kyc) {
        throw new NotFoundAppException('No KYC submission found for this affiliate');
      }
      if (kyc.status === 'VERIFIED') {
        return this.toPublic(kyc);
      }
      const verifiedAt = new Date();
      const updated = await tx.affiliateKyc.update({
        where: { affiliateId: input.affiliateId },
        data: {
          status: 'VERIFIED',
          verifiedAt,
          verifiedById: input.adminId,
          rejectedAt: null,
          rejectionReason: null,
        },
      });
      await tx.affiliate.update({
        where: { id: input.affiliateId },
        data: { kycStatus: 'VERIFIED', kycVerifiedAt: verifiedAt },
      });
      return this.toPublic(updated);
    });
  }

  async reject(input: {
    affiliateId: string;
    adminId: string;
    reason: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const kyc = await tx.affiliateKyc.findUnique({
        where: { affiliateId: input.affiliateId },
      });
      if (!kyc) {
        throw new NotFoundAppException('No KYC submission found for this affiliate');
      }
      const updated = await tx.affiliateKyc.update({
        where: { affiliateId: input.affiliateId },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectionReason: input.reason,
          verifiedAt: null,
          verifiedById: input.adminId,
        },
      });
      await tx.affiliate.update({
        where: { id: input.affiliateId },
        data: { kycStatus: 'REJECTED', kycVerifiedAt: null },
      });
      return this.toPublic(updated);
    });
  }

  /**
   * #252.9 — Allowlist guard for client-supplied KYC document URLs.
   * Mirrors the returns evidence-URL validator: https-only, pinned to the
   * platform's media delivery host (derived from R2_PUBLIC_BASE_URL at
   * runtime, plus the dev-stub host), with explicit localhost / link-local /
   * cloud-metadata SSRF blocks. The DTO enforces the format rules at the HTTP
   * boundary; this runs the authoritative host check for every caller
   * (including internal ones) right before persistence. No-ops on an absent
   * (optional) URL.
   */
  private assertAllowedKycUrl(url: string | undefined, field: string): void {
    if (url === undefined || url === null) return;
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new BadRequestAppException(`${field} must be a non-empty URL string.`);
    }
    const trimmed = url.trim();
    if (trimmed.length > 500) {
      throw new BadRequestAppException(
        `${field} must be at most 500 characters.`,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BadRequestAppException(`${field} is not a valid URL.`);
    }
    if (parsed.protocol !== 'https:') {
      throw new BadRequestAppException(`${field} must use https.`);
    }
    const host = parsed.hostname;
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host === '169.254.169.254' ||
      host === 'metadata.google.internal'
    ) {
      throw new BadRequestAppException(
        `${field} host is not an allowed document host.`,
      );
    }
    const trusted = resolveTrustedMediaHosts(
      this.env.getOptional('R2_PUBLIC_BASE_URL'),
    );
    const allowed = trusted.some((h) => host === h || host.endsWith(`.${h}`));
    if (!allowed) {
      throw new BadRequestAppException(
        `${field} must be a URL from the platform's media host.`,
      );
    }
  }

  /**
   * Strip the encrypted columns from the response — only the last-4
   * mirror is safe to ship to the affiliate's own UI.
   */
  private toPublic(kyc: any) {
    return {
      id: kyc.id,
      affiliateId: kyc.affiliateId,
      panLast4: kyc.panLast4,
      aadhaarLast4: kyc.aadhaarLast4,
      panDocumentUrl: kyc.panDocumentUrl,
      aadhaarDocumentUrl: kyc.aadhaarDocumentUrl,
      status: kyc.status,
      verifiedAt: kyc.verifiedAt,
      rejectedAt: kyc.rejectedAt,
      rejectionReason: kyc.rejectionReason,
      createdAt: kyc.createdAt,
      updatedAt: kyc.updatedAt,
    };
  }

  /**
   * Admin-facing view: includes the FULL decrypted PAN + Aadhaar so the
   * reviewer can cross-check against the uploaded scan and (when
   * needed) re-enter into NSDL / GSTIN portals. Decryption only runs
   * for users who already passed `affiliates.read` permission. Every
   * call to this method is implicitly an admin read of PII — the audit
   * log should reflect that at the controller layer.
   */
  private toAdminView(kyc: any) {
    let panFull: string | null = null;
    let aadhaarFull: string | null = null;
    try {
      if (kyc.panNumberEnc && kyc.panNumberIv) {
        panFull = this.encryption.decrypt(kyc.panNumberEnc, kyc.panNumberIv);
      }
    } catch {
      panFull = null;
    }
    try {
      if (kyc.aadhaarNumberEnc && kyc.aadhaarNumberIv) {
        aadhaarFull = this.encryption.decrypt(
          kyc.aadhaarNumberEnc,
          kyc.aadhaarNumberIv,
        );
      }
    } catch {
      aadhaarFull = null;
    }
    return {
      ...this.toPublic(kyc),
      panNumber: panFull,
      aadhaarNumber: aadhaarFull,
    };
  }
}
