import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * Phase 20 (2026-05-20) — Franchise bank-details service.
 *
 * Mirror of SellerBankDetailsService. Encrypts the account number
 * (AES-256-GCM, key = FRANCHISE_BANK_ENCRYPTION_KEY) at rest and
 * stores `accountNumberLast4` separately for masked display. The
 * plaintext account number never leaves this service.
 */

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_RE = /^[0-9]{9,18}$/;
const UPI_VPA_RE = /^[a-zA-Z0-9._\-]{2,256}@[a-zA-Z][a-zA-Z0-9.\-_]*$/;

export interface UpdateFranchiseBankDetailsInput {
  franchisePartnerId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName?: string | null;
  upiVpa?: string | null;
}

export interface FranchiseBankDetailsView {
  franchisePartnerId: string;
  accountHolderName: string;
  accountNumberLast4: string;
  ifscCode: string;
  bankName: string | null;
  upiVpa: string | null;
  verifiedAt: Date | null;
  updatedAt: Date;
}

@Injectable()
export class FranchiseBankDetailsService {
  private readonly logger = new Logger(FranchiseBankDetailsService.name);
  private readonly key: Buffer | null;

  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
  ) {
    const raw = this.envService.getOptional('FRANCHISE_BANK_ENCRYPTION_KEY');
    if (!raw) {
      this.key = null;
      this.logger.warn(
        'FRANCHISE_BANK_ENCRYPTION_KEY unset — bank-details writes will be refused. Required in production.',
      );
      return;
    }
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length !== 32) {
        throw new Error(
          'FRANCHISE_BANK_ENCRYPTION_KEY must be 32 bytes (64 hex chars or 44 base64 chars)',
        );
      }
      this.key = buf;
    }
  }

  private assertKey(): Buffer {
    if (!this.key) {
      throw new BadRequestAppException(
        'Bank-details encryption is not configured. Set FRANCHISE_BANK_ENCRYPTION_KEY and restart.',
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
    return Buffer.concat([iv, ct, tag]).toString('base64');
  }

  decrypt(enc: string): string {
    const key = this.assertKey();
    const buf = Buffer.from(enc, 'base64');
    if (buf.length < 12 + 16) {
      throw new Error('FranchiseBankDetails ciphertext is too short');
    }
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  private validateInput(input: UpdateFranchiseBankDetailsInput): void {
    if (!ACCOUNT_NUMBER_RE.test(input.accountNumber)) {
      throw new BadRequestAppException('Account number must be 9–18 digits');
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
        'UPI VPA is invalid. Expected format: handle@provider.',
      );
    }
    if (input.accountHolderName.trim().length < 2) {
      throw new BadRequestAppException(
        'Account holder name must be at least 2 characters',
      );
    }
  }

  async upsert(
    input: UpdateFranchiseBankDetailsInput,
  ): Promise<FranchiseBankDetailsView> {
    this.validateInput(input);
    const accountNumber = input.accountNumber.trim();
    const accountNumberLast4 = accountNumber.slice(-4);
    const accountNumberEnc = this.encrypt(accountNumber);
    const accountHolderName = input.accountHolderName.trim();
    const ifscCode = input.ifscCode.trim().toUpperCase();
    const bankName = input.bankName?.trim() || null;
    const upiVpa = input.upiVpa?.trim() || null;

    const row = await this.prisma.franchiseBankDetails.upsert({
      where: { franchisePartnerId: input.franchisePartnerId },
      create: {
        franchisePartnerId: input.franchisePartnerId,
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
        verifiedAt: null,
        verifiedBy: null,
      },
    });

    return {
      franchisePartnerId: row.franchisePartnerId,
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
    franchisePartnerId: string,
  ): Promise<
    | { hasBankDetails: true; details: FranchiseBankDetailsView }
    | { hasBankDetails: false }
  > {
    const row = await this.prisma.franchiseBankDetails.findUnique({
      where: { franchisePartnerId },
    });
    if (!row) return { hasBankDetails: false };
    return {
      hasBankDetails: true,
      details: {
        franchisePartnerId: row.franchisePartnerId,
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

  async getOrThrow(
    franchisePartnerId: string,
  ): Promise<FranchiseBankDetailsView> {
    const status = await this.getStatus(franchisePartnerId);
    if (!status.hasBankDetails) {
      throw new NotFoundAppException('No bank details found for this franchise');
    }
    return status.details;
  }
}
