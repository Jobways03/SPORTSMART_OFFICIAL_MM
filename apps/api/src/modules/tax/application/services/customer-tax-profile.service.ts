// Phase 25/26 GST — CustomerTaxProfileService.
//
// Customer-facing CRUD for the customer_tax_profiles table. A customer
// can register up to MAX_PROFILES_PER_CUSTOMER GSTIN-holding entities
// (e.g. their own proprietorship + an LLP they own + their employer)
// and switch which one is the default for tax-invoice generation.
//
// The persisted profiles are consumed by TaxDocumentService at invoice
// generation time (Phase 9) via `findFirst({ customerId, isDefault })`
// — so flipping the default here is what makes the NEXT order's invoice
// carry that GSTIN.
//
// Verification (isVerified / verifiedAt / verifiedBy) is admin-attested
// and lives behind a separate admin endpoint not yet surfaced. Created
// rows land with `isVerified=false`; B2B downstream still works because
// `tax-document.service.ts` reads the profile regardless and the GSTIN
// itself has already passed the Mod-36 checksum on create. Live GSTN
// portal verification is the remaining open item (P2 in the audit).

import { Injectable, Logger } from '@nestjs/common';
import type { CustomerTaxProfile, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { validateGstin } from '../../domain/gstin-validator';
import type { BillingAddressDto } from '../../presentation/dtos/billing-address.dto';

const MAX_PROFILES_PER_CUSTOMER = 5;

export interface CreateInput {
  gstin: string;
  legalName: string;
  billingAddress: BillingAddressDto;
  isDefault?: boolean;
}

export interface UpdateInput {
  legalName?: string;
  billingAddress?: BillingAddressDto;
  isDefault?: boolean;
}

@Injectable()
export class CustomerTaxProfileService {
  private readonly logger = new Logger(CustomerTaxProfileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** List the customer's profiles, default first, then most-recent. */
  async list(customerId: string): Promise<CustomerTaxProfile[]> {
    return this.prisma.customerTaxProfile.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Fetch one profile, enforcing the customer owns it. */
  async findOne(customerId: string, id: string): Promise<CustomerTaxProfile> {
    const profile = await this.prisma.customerTaxProfile.findUnique({
      where: { id },
    });
    if (!profile || profile.customerId !== customerId) {
      throw new NotFoundAppException('Tax profile not found');
    }
    return profile;
  }

  async create(
    customerId: string,
    input: CreateInput,
  ): Promise<CustomerTaxProfile> {
    // 1. GSTIN format + checksum.
    const validation = validateGstin(input.gstin);
    if (!validation.isValid || !validation.normalized || !validation.stateCode) {
      throw new BadRequestAppException(
        `Invalid GSTIN: ${validation.errors.join('; ') || 'failed format / checksum check'}`,
      );
    }
    const gstin = validation.normalized;
    const stateCode = validation.stateCode;

    // 2. Per-customer cap (advisory per schema comment).
    const existingCount = await this.prisma.customerTaxProfile.count({
      where: { customerId },
    });
    if (existingCount >= MAX_PROFILES_PER_CUSTOMER) {
      throw new BadRequestAppException(
        `Maximum of ${MAX_PROFILES_PER_CUSTOMER} tax profiles per account. Delete one before adding another.`,
      );
    }

    // 3. Idempotency-ish guard — friendlier error than the raw Prisma
    //    unique-violation that the (customerId, gstin) index throws.
    const duplicate = await this.prisma.customerTaxProfile.findFirst({
      where: { customerId, gstin },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictAppException(
        `This GSTIN is already saved on your account.`,
      );
    }

    // 4. First-profile auto-default. If the customer has none yet,
    //    force this one to be the default regardless of the input
    //    flag — otherwise tax-document generation would never pick
    //    a B2B profile and the customer would always get B2C invoices.
    const shouldBeDefault =
      input.isDefault === true || existingCount === 0;

    return this.prisma.$transaction(async (tx) => {
      if (shouldBeDefault) {
        await tx.customerTaxProfile.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await tx.customerTaxProfile.create({
        data: {
          customerId,
          gstin,
          stateCode,
          legalName: input.legalName.trim(),
          billingAddressJson:
            input.billingAddress as unknown as Prisma.InputJsonValue,
          isDefault: shouldBeDefault,
          isVerified: false,
        },
      });
      this.logger.log(
        `Tax profile created for customer ${customerId}: ${gstin} ` +
          `(stateCode=${stateCode}, default=${shouldBeDefault})`,
      );
      return created;
    });
  }

  async update(
    customerId: string,
    id: string,
    input: UpdateInput,
  ): Promise<CustomerTaxProfile> {
    // Ownership check + load existing row.
    const existing = await this.findOne(customerId, id);

    const data: Prisma.CustomerTaxProfileUpdateInput = {};
    if (input.legalName !== undefined) {
      data.legalName = input.legalName.trim();
    }
    if (input.billingAddress !== undefined) {
      data.billingAddressJson =
        input.billingAddress as unknown as Prisma.InputJsonValue;
    }

    // setDefault toggling — only meaningful for true; you cannot
    // self-clear the default (every customer with profiles must have
    // exactly one). To switch defaults, set a different profile's
    // isDefault=true, which clears the previous default in the same tx.
    if (input.isDefault === true && !existing.isDefault) {
      return this.prisma.$transaction(async (tx) => {
        await tx.customerTaxProfile.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
        return tx.customerTaxProfile.update({
          where: { id },
          data: { ...data, isDefault: true },
        });
      });
    }

    if (Object.keys(data).length === 0) {
      // No-op update — return the existing row.
      return existing;
    }
    return this.prisma.customerTaxProfile.update({
      where: { id },
      data,
    });
  }

  /**
   * Soft delete by hard-deleting the row. The audit trail lives on
   * issued tax_documents — those carry their own snapshot of the
   * buyer GSTIN + legalName at issuance time, so deleting the profile
   * later doesn't change historical invoices.
   *
   * Refuses to delete the customer's currently-default profile
   * unless it's also their only profile (in which case the customer
   * is opting out of B2B entirely — allowed). This keeps the "every
   * B2B customer has exactly one default" invariant on the happy
   * path while still letting them clean up completely.
   */
  async delete(customerId: string, id: string): Promise<void> {
    const existing = await this.findOne(customerId, id);
    if (existing.isDefault) {
      const otherCount = await this.prisma.customerTaxProfile.count({
        where: { customerId, NOT: { id } },
      });
      if (otherCount > 0) {
        throw new BadRequestAppException(
          'Cannot delete the default tax profile while other profiles exist. ' +
            'Set a different profile as default first, then delete this one.',
        );
      }
    }
    await this.prisma.customerTaxProfile.delete({ where: { id } });
    this.logger.log(
      `Tax profile ${id} deleted for customer ${customerId}`,
    );
  }

  /** Flip a profile to the customer's default. Idempotent. */
  async setDefault(
    customerId: string,
    id: string,
  ): Promise<CustomerTaxProfile> {
    const existing = await this.findOne(customerId, id);
    if (existing.isDefault) return existing;
    return this.prisma.$transaction(async (tx) => {
      await tx.customerTaxProfile.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
      return tx.customerTaxProfile.update({
        where: { id },
        data: { isDefault: true },
      });
    });
  }
}
