import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * Phase 1 affiliate registration service.
 *
 * Implements the §5.1 onboarding flow: applicant registers,
 * admin reviews, admin approves (status → ACTIVE + auto-generated
 * primary coupon code) or rejects (status → REJECTED + reason).
 *
 * NOT in scope for Phase 1: KYC, payout method capture, fraud
 * automation, TDS, return-window cron. Those land in later phases
 * but the underlying tables already exist (see affiliate.prisma).
 */
@Injectable()
export class AffiliateRegistrationService {
  private readonly logger = new Logger(AffiliateRegistrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Applicant flow ──────────────────────────────────────────

  /**
   * Submit a registration application. Status starts as
   * PENDING_APPROVAL — admin must review and approve before the
   * affiliate can earn commissions or generate referral links.
   */
  async register(input: {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    password: string;
    websiteUrl?: string;
    socialHandle?: string;
    joinReason?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const phone = input.phone.trim();
    if (!phone) {
      throw new BadRequestAppException('Phone number is required.');
    }

    // Email + phone uniqueness — same constraints as the schema, but
    // surfaced as a clean error before hitting the DB-level violation.
    const existing = await this.prisma.affiliate.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { id: true, email: true, phone: true, status: true },
    });
    if (existing) {
      throw new ConflictAppException(
        existing.email === email
          ? 'An affiliate application with this email already exists.'
          : 'An affiliate application with this phone number already exists.',
      );
    }

    if (input.password.length < 8) {
      throw new BadRequestAppException('Password must be at least 8 characters long.');
    }
    const passwordHash = await bcrypt.hash(input.password, 10);

    const affiliate = await this.prisma.affiliate.create({
      data: {
        email,
        phone,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        passwordHash,
        websiteUrl: input.websiteUrl?.trim() || null,
        socialHandle: input.socialHandle?.trim() || null,
        joinReason: input.joinReason?.trim() || null,
        // status defaults to PENDING_APPROVAL — admin will review
      },
      select: this.publicSelect(),
    });

    this.logger.log(`Affiliate application received: ${email}`);
    return affiliate;
  }

  /**
   * Self-service profile update. Affiliate can change their name,
   * phone, website, social handle, and join reason. Email cannot be
   * changed here (requires verification flow). Admin-controlled fields
   * (status, kyc, commissionPercentage) are not exposed.
   *
   * Empty strings for the clearable optional fields (websiteUrl,
   * socialHandle, joinReason) collapse to `null`. Phone uniqueness is
   * re-checked against the existing constraint, with a clean error if
   * another affiliate already claims the number.
   */
  async updateProfile(input: {
    affiliateId: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    websiteUrl?: string;
    socialHandle?: string;
    joinReason?: string;
  }) {
    const existing = await this.prisma.affiliate.findUnique({
      where: { id: input.affiliateId },
      select: { id: true, phone: true },
    });
    if (!existing) throw new NotFoundAppException('Affiliate not found');

    // Phone uniqueness — skip if unchanged so the affiliate can save
    // unrelated fields without re-validating the phone.
    if (input.phone && input.phone !== existing.phone) {
      const phoneTaken = await this.prisma.affiliate.findFirst({
        where: { phone: input.phone, id: { not: input.affiliateId } },
        select: { id: true },
      });
      if (phoneTaken) {
        throw new ConflictAppException(
          'That phone number is already registered to another affiliate.',
        );
      }
    }

    const data: any = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.phone !== undefined) data.phone = input.phone;
    // `""` from the form means "clear" — store NULL so the field reads
    // back as "—" in the UI rather than an empty string.
    if (input.websiteUrl !== undefined) data.websiteUrl = input.websiteUrl === '' ? null : input.websiteUrl;
    if (input.socialHandle !== undefined) data.socialHandle = input.socialHandle === '' ? null : input.socialHandle;
    if (input.joinReason !== undefined) data.joinReason = input.joinReason === '' ? null : input.joinReason;

    if (Object.keys(data).length === 0) {
      // Nothing to do; just return the current profile so the client
      // doesn't need a separate refetch.
      return this.getProfile(input.affiliateId);
    }

    // Changing the phone invalidates verification — they have to re-verify
    // the new number. Email isn't editable here, so emailVerified is
    // never invalidated by this path.
    if (data.phone !== undefined && data.phone !== existing.phone) {
      data.phoneVerified = false;
      data.phoneVerifiedAt = null;
    }

    await this.prisma.affiliate.update({
      where: { id: input.affiliateId },
      data,
    });

    this.logger.log(`Affiliate profile updated: ${input.affiliateId}`);
    return this.getProfile(input.affiliateId);
  }

  /**
   * Returns the affiliate's own profile snapshot. Used by the
   * affiliate portal dashboard (after login) and by the "check my
   * status" endpoint pre-login.
   */
  async getProfile(affiliateId: string) {
    // Return ALL coupon codes (not just the primary) so the affiliate
    // portal's Coupons & Links page can render every code + state.
    // Selecting the full field set keeps the frontend in sync with
    // the schema without an extra round-trip.
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: {
        ...this.publicSelect(),
        couponCodes: {
          select: {
            id: true,
            code: true,
            isPrimary: true,
            isActive: true,
            expiresAt: true,
            maxUses: true,
            usedCount: true,
            perUserLimit: true,
            minOrderValue: true,
            customerDiscountType: true,
            customerDiscountValue: true,
            createdAt: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    return affiliate;
  }

  // ── Admin flow ──────────────────────────────────────────────

  async listForAdmin(params: {
    page?: number;
    limit?: number;
    status?: string;
    kycStatus?: string;
    search?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.kycStatus) where.kycStatus = params.kycStatus;
    if (params.search) {
      const q = params.search.trim();
      if (q) {
        where.OR = [
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
        ];
      }
    }

    const [affiliates, total] = await this.prisma.$transaction([
      this.prisma.affiliate.findMany({
        where,
        select: this.publicSelect(),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.affiliate.count({ where }),
    ]);

    return {
      affiliates,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getForAdmin(affiliateId: string) {
    // Full coupon details so the Manage modal can pre-populate the
    // discount / expiry / cap fields without a second round-trip.
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: {
        ...this.publicSelect(),
        couponCodes: {
          select: {
            id: true,
            code: true,
            isPrimary: true,
            isActive: true,
            expiresAt: true,
            maxUses: true,
            usedCount: true,
            perUserLimit: true,
            minOrderValue: true,
            customerDiscountType: true,
            customerDiscountValue: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    return affiliate;
  }

  /**
   * Admin approves an application. Sets status to ACTIVE, captures
   * approver, and generates the affiliate's primary coupon code if
   * one doesn't already exist (re-approval after suspension is a
   * no-op for the coupon — they keep the original code so existing
   * referral links still resolve).
   */
  async approve(affiliateId: string, approverAdminId: string) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { id: true, status: true, email: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    if (affiliate.status === 'ACTIVE') {
      throw new BadRequestAppException('Affiliate is already active.');
    }

    const code = await this.generateUniqueCouponCode();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.affiliate.update({
        where: { id: affiliateId },
        data: {
          status: 'ACTIVE',
          approvedAt: new Date(),
          approvedById: approverAdminId,
          rejectedAt: null,
          rejectionReason: null,
          suspendedAt: null,
          suspensionReason: null,
        },
        select: this.publicSelect(),
      });

      // Idempotent coupon creation — if the affiliate already has a
      // primary code (re-approval after suspension), don't make a new
      // one. The primary code is the public identifier they hand out.
      const existingPrimary = await tx.affiliateCouponCode.findFirst({
        where: { affiliateId, isPrimary: true },
        select: { id: true },
      });
      if (!existingPrimary) {
        await tx.affiliateCouponCode.create({
          data: {
            affiliateId,
            code,
            isPrimary: true,
          },
        });
      }

      return updated;
    });
  }

  async reject(affiliateId: string, reason: string, rejectorAdminId: string) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { id: true, status: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    if (affiliate.status === 'REJECTED') {
      throw new BadRequestAppException('Affiliate is already rejected.');
    }

    return this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectionReason: reason,
        approvedById: rejectorAdminId,
      },
      select: this.publicSelect(),
    });
  }

  async suspend(affiliateId: string, reason: string, adminId: string) {
    return this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspensionReason: reason,
        approvedById: adminId,
      },
      select: this.publicSelect(),
    });
  }

  async deactivate(affiliateId: string, adminId: string) {
    return this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        status: 'INACTIVE',
        approvedById: adminId,
      },
      select: this.publicSelect(),
    });
  }

  async reactivate(affiliateId: string, adminId: string) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { status: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    if (affiliate.status === 'ACTIVE') {
      throw new BadRequestAppException('Affiliate is already active.');
    }
    return this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        status: 'ACTIVE',
        approvedById: adminId,
        suspendedAt: null,
        suspensionReason: null,
      },
      select: this.publicSelect(),
    });
  }

  /**
   * Override the affiliate's commission percentage. Pass `null` to
   * clear the override and fall back to the platform default
   * (CommissionSetting). Range: 0 ≤ pct ≤ 100. Stored as Decimal(5,2).
   */
  async updateCommissionRate(input: {
    affiliateId: string;
    percentage: number | null;
    adminId: string;
  }) {
    if (input.percentage != null) {
      if (
        !Number.isFinite(input.percentage) ||
        input.percentage < 0 ||
        input.percentage > 100
      ) {
        throw new BadRequestAppException(
          'Commission percentage must be between 0 and 100.',
        );
      }
    }
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: input.affiliateId },
      select: { id: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');

    return this.prisma.affiliate.update({
      where: { id: input.affiliateId },
      data: {
        // Decimal column. Prisma accepts a plain number; null clears.
        commissionPercentage:
          input.percentage == null
            ? null
            : Math.round(input.percentage * 100) / 100,
      },
      select: this.publicSelect(),
    });
  }

  /**
   * Update one of the affiliate's coupon codes. Admin-only — the
   * affiliate themselves cannot change discount value, expiry, or
   * usage caps (those are platform-level levers). Validates that the
   * coupon belongs to the affiliate before mutating.
   *
   * Pass `null` for an optional field to clear it (e.g. drop the
   * customer discount or remove the expiry).
   */
  async updateCouponConfig(input: {
    affiliateId: string;
    couponId: string;
    isActive?: boolean;
    customerDiscountType?: 'PERCENT' | 'FIXED' | null;
    customerDiscountValue?: number | null;
    expiresAt?: Date | null;
    maxUses?: number | null;
    perUserLimit?: number;
    minOrderValue?: number | null;
    adminId: string;
  }) {
    const coupon = await this.prisma.affiliateCouponCode.findUnique({
      where: { id: input.couponId },
      select: { id: true, affiliateId: true },
    });
    if (!coupon || coupon.affiliateId !== input.affiliateId) {
      throw new NotFoundAppException('Coupon not found for this affiliate');
    }

    if (input.customerDiscountType != null) {
      if (!['PERCENT', 'FIXED'].includes(input.customerDiscountType)) {
        throw new BadRequestAppException(
          "customerDiscountType must be 'PERCENT' or 'FIXED'.",
        );
      }
    }
    if (input.customerDiscountValue != null) {
      if (
        !Number.isFinite(input.customerDiscountValue) ||
        input.customerDiscountValue < 0
      ) {
        throw new BadRequestAppException('Discount value must be ≥ 0.');
      }
      if (
        input.customerDiscountType === 'PERCENT' &&
        input.customerDiscountValue > 100
      ) {
        throw new BadRequestAppException(
          'Percentage discount cannot exceed 100.',
        );
      }
    }
    if (input.maxUses != null && (!Number.isInteger(input.maxUses) || input.maxUses < 0)) {
      throw new BadRequestAppException('Max uses must be a non-negative integer.');
    }
    if (
      input.perUserLimit != null &&
      (!Number.isInteger(input.perUserLimit) || input.perUserLimit < 1)
    ) {
      throw new BadRequestAppException('Per-user limit must be a positive integer.');
    }
    if (
      input.minOrderValue != null &&
      (!Number.isFinite(input.minOrderValue) || input.minOrderValue < 0)
    ) {
      throw new BadRequestAppException('Minimum order value must be ≥ 0.');
    }

    // Build the patch — only set keys that were explicitly provided.
    // `undefined` means "don't touch"; explicit `null` means "clear".
    const data: any = {};
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.customerDiscountType !== undefined)
      data.customerDiscountType = input.customerDiscountType;
    if (input.customerDiscountValue !== undefined)
      data.customerDiscountValue = input.customerDiscountValue;
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
    if (input.maxUses !== undefined) data.maxUses = input.maxUses;
    if (input.perUserLimit !== undefined) data.perUserLimit = input.perUserLimit;
    if (input.minOrderValue !== undefined) data.minOrderValue = input.minOrderValue;

    return this.prisma.affiliateCouponCode.update({
      where: { id: input.couponId },
      data,
      select: {
        id: true,
        code: true,
        isPrimary: true,
        isActive: true,
        expiresAt: true,
        maxUses: true,
        usedCount: true,
        perUserLimit: true,
        minOrderValue: true,
        customerDiscountType: true,
        customerDiscountValue: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────

  /** Don't leak passwordHash / fraudFlagCount internals to API consumers. */
  private publicSelect() {
    return {
      id: true,
      email: true,
      phone: true,
      emailVerified: true,
      phoneVerified: true,
      phoneVerifiedAt: true,
      firstName: true,
      lastName: true,
      websiteUrl: true,
      socialHandle: true,
      joinReason: true,
      status: true,
      kycStatus: true,
      kycVerifiedAt: true,
      commissionPercentage: true,
      approvedAt: true,
      rejectedAt: true,
      rejectionReason: true,
      suspendedAt: true,
      suspensionReason: true,
      isFlagged: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  /**
   * Build a 7-char alphanumeric code, prefix with "AF". Loops up to
   * 10 times if a collision happens (vanishingly rare given 36^7
   * combinations).
   */
  private async generateUniqueCouponCode(): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip ambiguous I/O/0/1
    for (let attempt = 0; attempt < 10; attempt++) {
      let body = '';
      for (let i = 0; i < 7; i++) {
        body += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      const candidate = `AF${body}`;
      const taken = await this.prisma.affiliateCouponCode.findUnique({
        where: { code: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    throw new BadRequestAppException(
      'Could not generate a unique coupon code. Please retry.',
    );
  }
}
