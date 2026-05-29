import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * Phase 19 (2026-05-20) — Seller bank-details service.
 *
 * Stores the seller's payout bank account encrypted-at-rest:
 *   • `accountNumberEnc`  — AES-256-GCM ciphertext (base64 of
 *                            iv||ciphertext||tag), keyed off
 *                            `SELLER_BANK_ENCRYPTION_KEY`.
 *   • `accountNumberLast4` — readable last 4 for masked display.
 *   • `ifscCode`           — kept in cleartext (public-ish identifier).
 *
 * The plaintext account number is never returned outside this
 * service. Callers receive `accountNumberLast4` + a boolean
 * `isVerified` flag at most.
 *
 * Encryption-key sourcing mirrors the affiliate-side pattern but is
 * deliberately a separate key so a leak on the affiliate side does
 * not impact seller payouts (and vice-versa).
 */

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_RE = /^[0-9]{9,18}$/;
const UPI_VPA_RE = /^[a-zA-Z0-9._\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-_]*$/;

export interface UpdateBankDetailsInput {
  sellerId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName?: string | null;
  upiVpa?: string | null;
}

export interface BankDetailsView {
  sellerId: string;
  accountHolderName: string;
  accountNumberLast4: string;
  ifscCode: string;
  bankName: string | null;
  upiVpa: string | null;
  verifiedAt: Date | null;
  updatedAt: Date;
}

@Injectable()
export class SellerBankDetailsService {
  private readonly logger = new Logger(SellerBankDetailsService.name);
  private readonly key: Buffer | null;

  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
  ) {
    const raw = this.envService.getOptional('SELLER_BANK_ENCRYPTION_KEY');
    if (!raw) {
      // Dev / staging may not have a key configured. The service
      // still mounts; writes fail loudly via assertKey() below.
      this.key = null;
      this.logger.warn(
        'SELLER_BANK_ENCRYPTION_KEY unset — bank-details writes will be refused. Required in production.',
      );
      return;
    }
    // Accept either 64 hex chars (32 bytes) or 44 base64 chars.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length !== 32) {
        throw new Error(
          'SELLER_BANK_ENCRYPTION_KEY must be 32 bytes (64 hex chars or 44 base64 chars)',
        );
      }
      this.key = buf;
    }
  }

  private assertKey(): Buffer {
    if (!this.key) {
      throw new BadRequestAppException(
        'Bank-details encryption is not configured. Set SELLER_BANK_ENCRYPTION_KEY and restart.',
        'BANK_DETAILS_UNAVAILABLE',
      );
    }
    return this.key;
  }

  private encrypt(plaintext: string): string {
    const key = this.assertKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Single base64 blob = iv || ciphertext || tag — self-contained.
    return Buffer.concat([iv, ct, tag]).toString('base64');
  }

  /**
   * Reads back the plaintext account number. NOT exposed via any
   * API route — used only for admin payout instruction generation
   * (out of scope for this PR). Kept here so the key never leaves
   * the service boundary.
   */
  decrypt(enc: string): string {
    const key = this.assertKey();
    const buf = Buffer.from(enc, 'base64');
    if (buf.length < 12 + 16) {
      throw new Error('SellerBankDetails ciphertext is too short');
    }
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      'utf8',
    );
  }

  /**
   * Validate IFSC against RBI's published format. Returns nothing;
   * throws BadRequestAppException on mismatch.
   */
  private validateInput(input: UpdateBankDetailsInput): void {
    if (!ACCOUNT_NUMBER_RE.test(input.accountNumber)) {
      throw new BadRequestAppException(
        'Account number must be 9–18 digits',
      );
    }
    if (!IFSC_RE.test(input.ifscCode)) {
      throw new BadRequestAppException(
        'IFSC code is invalid. Expected format: 4 letters + 0 + 6 alphanumerics (e.g. HDFC0001234).',
      );
    }
    if (
      input.upiVpa &&
      input.upiVpa.trim().length > 0 &&
      !UPI_VPA_RE.test(input.upiVpa.trim())
    ) {
      throw new BadRequestAppException(
        'UPI VPA is invalid. Expected format: handle@provider (e.g. seller@upi).',
      );
    }
    if (input.accountHolderName.trim().length < 2) {
      throw new BadRequestAppException(
        'Account holder name must be at least 2 characters',
      );
    }
  }

  async upsert(input: UpdateBankDetailsInput): Promise<BankDetailsView> {
    this.validateInput(input);
    const accountNumber = input.accountNumber.trim();
    const accountNumberLast4 = accountNumber.slice(-4);
    const accountNumberEnc = this.encrypt(accountNumber);
    const accountHolderName = input.accountHolderName.trim();
    const ifscCode = input.ifscCode.trim().toUpperCase();
    const bankName = input.bankName?.trim() || null;
    const upiVpa = input.upiVpa?.trim() || null;

    const row = await this.prisma.sellerBankDetails.upsert({
      where: { sellerId: input.sellerId },
      create: {
        sellerId: input.sellerId,
        accountHolderName,
        accountNumberEnc,
        accountNumberLast4,
        ifscCode,
        bankName,
        upiVpa,
      },
      update: {
        accountHolderName,
        accountNumberEnc,
        accountNumberLast4,
        ifscCode,
        bankName,
        upiVpa,
        // Clear verification state on any change — a previously-
        // verified account that swaps numbers must be re-verified.
        verifiedAt: null,
        verifiedBy: null,
      },
    });

    return {
      sellerId: row.sellerId,
      accountHolderName: row.accountHolderName,
      accountNumberLast4: row.accountNumberLast4,
      ifscCode: row.ifscCode,
      bankName: row.bankName,
      upiVpa: row.upiVpa,
      verifiedAt: row.verifiedAt,
      updatedAt: row.updatedAt,
    };
  }

  async getStatus(
    sellerId: string,
  ): Promise<{ hasBankDetails: true; details: BankDetailsView } | { hasBankDetails: false }> {
    const row = await this.prisma.sellerBankDetails.findUnique({
      where: { sellerId },
    });
    if (!row) return { hasBankDetails: false };
    return {
      hasBankDetails: true,
      details: {
        sellerId: row.sellerId,
        accountHolderName: row.accountHolderName,
        accountNumberLast4: row.accountNumberLast4,
        ifscCode: row.ifscCode,
        bankName: row.bankName,
        upiVpa: row.upiVpa,
        verifiedAt: row.verifiedAt,
        updatedAt: row.updatedAt,
      },
    };
  }

  /**
   * Used by NotFoundAppException-style callers that prefer the
   * "throw if missing" shape.
   */
  async getOrThrow(sellerId: string): Promise<BankDetailsView> {
    const status = await this.getStatus(sellerId);
    if (!status.hasBankDetails) {
      throw new NotFoundAppException('No bank details found for this seller');
    }
    return status.details;
  }
}
