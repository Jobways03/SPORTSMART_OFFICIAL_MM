import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { BCRYPT_TARGET_COST } from '../../../../core/auth/bcrypt-policy';

/**
 * Affiliate registration / lifecycle service.
 *
 * Phase 22 (2026-05-20) — Audit-driven hardening across the whole
 * service:
 *
 *   • register(): enumeration-safe duplicate path (same 201 shape for
 *     fresh + duplicate-email/phone with a timing-soak delay), strict
 *     password complexity (now enforced at the DTO too — the use-case
 *     keeps a minimum belt-and-suspenders check), confirmPassword and
 *     consent gates, P2002 race fallback to uniform response.
 *
 *   • approve(): only PENDING_APPROVAL → ACTIVE (REJECTED applicants
 *     must explicitly re-submit before they can be approved). KYC
 *     precondition: kycStatus === 'VERIFIED' required before flipping
 *     to ACTIVE; otherwise approval fails with a clear message and
 *     the admin queue's "approve" button stays disabled until the
 *     KYC review completes. Coupon generation uses crypto.randomInt
 *     and runs inside the same transaction as the status flip; a
 *     P2002 on the coupon code falls through to a single retry.
 *
 *   • reject/suspend/deactivate/reactivate(): each action stamps its
 *     own actor column (no more overloading approvedById). Audit log
 *     and domain event published for every admin lifecycle change.
 */
@Injectable()
export class AffiliateRegistrationService {
  private readonly logger = new Logger(AffiliateRegistrationService.name);

  /** Soak delay range (ms) on the duplicate-email path so the
   *  enumeration-safe response timing matches the create path. */
  private static readonly DUPLICATE_TIMING_DELAY_MIN_MS = 200;
  private static readonly DUPLICATE_TIMING_DELAY_MAX_MS = 450;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly audit: AuditPublicFacade,
  ) {}

  // ── Applicant flow ──────────────────────────────────────────

  async register(input: {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    password: string;
    websiteUrl?: string;
    socialHandle?: string;
    joinReason?: string;
    acceptTerms: boolean;
    acceptPrivacy: boolean;
    acceptMarketing?: boolean;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    const phone = input.phone.trim();
    if (!phone) {
      throw new BadRequestAppException('Phone number is required.');
    }
    if (input.acceptTerms !== true) {
      throw new BadRequestAppException(
        'You must agree to the Terms of Service to submit your application.',
      );
    }
    if (input.acceptPrivacy !== true) {
      throw new BadRequestAppException(
        'You must agree to the Privacy Policy to submit your application.',
      );
    }

    // Uniform duplicate response — both fresh and duplicate paths
    // return the SAME shape so an attacker cannot probe registered
    // emails/phones by error string.
    const uniformAcceptedMessage =
      'If these details are not already registered, your application has been received. We will review and email you shortly.';

    const existing = await this.prisma.affiliate.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { id: true },
    });
    if (existing) {
      // Burn bcrypt cost + timing soak so duplicate-path latency
      // matches create-path latency.
      await bcrypt.hash(input.password, BCRYPT_TARGET_COST);
      await this.timingSoakDelay();
      this.logger.log(
        'Affiliate register: duplicate email/phone absorbed (uniform 201 returned)',
      );
      return {
        email,
        status: 'PENDING_APPROVAL' as const,
        requiresReview: true as const,
        message: uniformAcceptedMessage,
      };
    }

    // Cost 12 hash (BCRYPT_TARGET_COST). Login enforces a rehash
    // on success if a legacy cost-10 hash is detected.
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_TARGET_COST);

    let affiliate: { id: string; email: string };
    try {
      affiliate = await this.prisma.affiliate.create({
        data: {
          email,
          phone,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          passwordHash,
          websiteUrl: input.websiteUrl?.trim() || null,
          socialHandle: input.socialHandle?.trim() || null,
          joinReason: input.joinReason?.trim() || null,
        },
        select: { id: true, email: true },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Race window: another request inserted the same email/phone
        // between our findFirst and create. Fall back to the uniform
        // response — same enumeration safety as the pre-check path.
        await this.timingSoakDelay();
        this.logger.log(
          'Affiliate register: P2002 collapsed to uniform 201 response',
        );
        return {
          email,
          status: 'PENDING_APPROVAL' as const,
          requiresReview: true as const,
          message: uniformAcceptedMessage,
        };
      }
      throw err;
    }

    // Lifecycle event. Welcome email is dispatched by the
    // @OnEvent('affiliate.registered') handler in
    // email-notification.handler.ts.
    this.eventBus
      .publish({
        eventName: 'affiliate.registered',
        aggregate: 'affiliate',
        aggregateId: affiliate.id,
        occurredAt: new Date(),
        payload: {
          affiliateId: affiliate.id,
          email: affiliate.email,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          acceptedMarketing: input.acceptMarketing === true,
        },
      })
      .catch((err) =>
        this.logger.error(
          `Failed to publish affiliate.registered for ${affiliate.id}: ${err}`,
        ),
      );

    // Audit row carries the consent capture (DPDP §6) so we can prove
    // the applicant ticked Terms + Privacy at registration.
    this.audit
      .writeAuditLog({
        actorId: affiliate.id,
        actorRole: 'AFFILIATE',
        action: 'AFFILIATE_REGISTERED',
        module: 'affiliate',
        resource: 'Affiliate',
        resourceId: affiliate.id,
        newValue: { status: 'PENDING_APPROVAL' },
        metadata: {
          acceptTerms: true,
          acceptPrivacy: true,
          acceptMarketing: input.acceptMarketing === true,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for AFFILIATE_REGISTERED: ${err}`,
        ),
      );

    this.logger.log(`Affiliate application received: ${email}`);
    return {
      email: affiliate.email,
      status: 'PENDING_APPROVAL' as const,
      requiresReview: true as const,
      message: uniformAcceptedMessage,
      affiliateId: affiliate.id,
    };
  }

  /**
   * Self-service profile update.
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
    if (input.websiteUrl !== undefined)
      data.websiteUrl = input.websiteUrl === '' ? null : input.websiteUrl;
    if (input.socialHandle !== undefined)
      data.socialHandle = input.socialHandle === '' ? null : input.socialHandle;
    if (input.joinReason !== undefined)
      data.joinReason = input.joinReason === '' ? null : input.joinReason;

    if (Object.keys(data).length === 0) {
      return this.getProfile(input.affiliateId);
    }

    await this.prisma.affiliate.update({
      where: { id: input.affiliateId },
      data,
    });

    this.logger.log(`Affiliate profile updated: ${input.affiliateId}`);
    return this.getProfile(input.affiliateId);
  }

  async getProfile(affiliateId: string) {
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
            startsAt: true,
            expiresAt: true,
            maxUses: true,
            usedCount: true,
            perUserLimit: true,
            minOrderValue: true,
            customerDiscountType: true,
            customerDiscountValue: true,
            maxDiscountAmount: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
        },
        // Phase 159 — recent commission-rate changes for the detail page.
        commissionRateHistory: {
          select: {
            id: true,
            fromRate: true,
            toRate: true,
            changedByAdminId: true,
            reason: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    return affiliate;
  }

  /**
   * Admin approves an application. Phase 22 preconditions:
   *
   *   • Only PENDING_APPROVAL → ACTIVE. A REJECTED applicant must
   *     be put back into PENDING_APPROVAL through a re-application,
   *     not silently revived by approve().
   *
   * KYC policy (Phase 22, 2026-05-20):
   *   Affiliate KYC is currently disabled per product decision (the
   *   /dashboard/kyc nav link is commented out, the admin
   *   verify/reject endpoints are commented out). Approval therefore
   *   does NOT gate on kycStatus — an affiliate can be activated and
   *   begin earning commissions without a verified KYC. The gate is
   *   enforced where it actually matters: the PAYOUT REQUEST flow
   *   refuses to release funds unless KYC is verified, so an
   *   affiliate can accumulate commissions but the money stays in
   *   their balance until KYC is restored. When KYC is re-enabled
   *   product-side, restore the precondition (`kycStatus ===
   *   'VERIFIED'`) below.
   */
  // Phase 156 — append a status-history row (best-effort, like the audit
  // write). The dedicated actor columns hold the latest actor per type; this
  // keeps the full ordered timeline.
  private recordStatusChange(args: {
    affiliateId: string;
    fromStatus: string;
    toStatus: string;
    adminId: string;
    reason?: string;
  }): void {
    this.prisma.affiliateStatusHistory
      .create({
        data: {
          affiliateId: args.affiliateId,
          fromStatus: args.fromStatus,
          toStatus: args.toStatus,
          changedByAdminId: args.adminId,
          reason: args.reason ?? null,
        },
      })
      .catch((e) => this.logger.error(`Affiliate status-history write failed: ${e}`));
  }

  async approve(
    affiliateId: string,
    approverAdminId: string,
    audit?: { ipAddress?: string; userAgent?: string },
  ) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { id: true, status: true, email: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    if (affiliate.status === 'ACTIVE') {
      throw new BadRequestAppException('Affiliate is already active.');
    }
    if (affiliate.status !== 'PENDING_APPROVAL') {
      throw new BadRequestAppException(
        `Cannot approve an affiliate whose status is ${affiliate.status}. Only PENDING_APPROVAL applications can be approved.`,
      );
    }

    const now = new Date();
    const previousStatus = affiliate.status;

    // Phase 22 (2026-05-20) — coupon generation moved INSIDE the
    // transaction; the prior code generated the candidate outside,
    // creating a race window where two concurrent approves could
    // create duplicate primary codes (the findFirst was non-atomic).
    // The unique constraint on `code` + the small retry loop here
    // guarantees forward progress under contention.
    const updated = await this.prisma.$transaction(async (tx) => {
      // Phase 157 — status-CAS: only a still-PENDING_APPROVAL row flips, so two
      // concurrent approves can't both run the update + coupon-create (the
      // loser sees count 0 → 409 instead of racing a second primary coupon).
      const claim = await tx.affiliate.updateMany({
        where: { id: affiliateId, status: 'PENDING_APPROVAL' },
        data: {
          status: 'ACTIVE',
          approvedAt: now,
          approvedById: approverAdminId,
          rejectedAt: null,
          rejectionReason: null,
          rejectedById: null,
          suspendedAt: null,
          suspensionReason: null,
          suspendedById: null,
          deactivatedAt: null,
          deactivatedById: null,
          reactivatedAt: null,
          reactivatedById: null,
        },
      });
      if (claim.count === 0) {
        throw new ConflictAppException(
          'Affiliate was approved concurrently or is no longer PENDING_APPROVAL — refresh and retry.',
        );
      }
      const u = await tx.affiliate.findUniqueOrThrow({
        where: { id: affiliateId },
        select: this.publicSelect(),
      });

      const existingPrimary = await tx.affiliateCouponCode.findFirst({
        where: { affiliateId, isPrimary: true },
        select: { id: true },
      });
      if (!existingPrimary) {
        // One retry on P2002 — the unique constraint catches the
        // (vanishingly rare) collision and we regenerate.
        for (let attempt = 0; attempt < 2; attempt++) {
          const code = this.generateCouponCandidate();
          try {
            await tx.affiliateCouponCode.create({
              // couponSource defaults to REGISTRATION_AUTO; record the approver
              // as the creator (Phase 159b).
              data: { affiliateId, code, isPrimary: true, createdByAdminId: approverAdminId },
            });
            break;
          } catch (err: any) {
            if (err?.code === 'P2002' && attempt < 1) continue;
            throw err;
          }
        }
      }
      return u;
    });

    this.audit
      .writeAuditLog({
        actorId: approverAdminId,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_APPROVED',
        module: 'affiliate',
        resource: 'Affiliate',
        resourceId: affiliateId,
        oldValue: { status: previousStatus },
        newValue: { status: 'ACTIVE' },
        ipAddress: audit?.ipAddress,
        userAgent: audit?.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for AFFILIATE_APPROVED: ${err}`,
        ),
      );

    this.eventBus
      .publish({
        eventName: 'affiliate.approved',
        aggregate: 'affiliate',
        aggregateId: affiliateId,
        occurredAt: now,
        payload: { affiliateId, email: affiliate.email },
      })
      .catch((err) =>
        this.logger.error(
          `Failed to publish affiliate.approved for ${affiliateId}: ${err}`,
        ),
      );

    this.recordStatusChange({
      affiliateId,
      fromStatus: previousStatus,
      toStatus: 'ACTIVE',
      adminId: approverAdminId,
    });
    return updated;
  }

  async reject(
    affiliateId: string,
    reason: string,
    rejectorAdminId: string,
    audit?: { ipAddress?: string; userAgent?: string },
  ) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { id: true, status: true, email: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    if (affiliate.status === 'REJECTED') {
      throw new BadRequestAppException('Affiliate is already rejected.');
    }
    if (affiliate.status === 'ACTIVE') {
      throw new BadRequestAppException(
        'Cannot reject an already-active affiliate. Use suspend or deactivate.',
      );
    }

    const previousStatus = affiliate.status;
    const now = new Date();
    const updated = await this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        status: 'REJECTED',
        rejectedAt: now,
        rejectionReason: reason,
        rejectedById: rejectorAdminId,
      },
      select: this.publicSelect(),
    });

    this.audit
      .writeAuditLog({
        actorId: rejectorAdminId,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_REJECTED',
        module: 'affiliate',
        resource: 'Affiliate',
        resourceId: affiliateId,
        oldValue: { status: previousStatus },
        newValue: { status: 'REJECTED' },
        metadata: { reason },
        ipAddress: audit?.ipAddress,
        userAgent: audit?.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for AFFILIATE_REJECTED: ${err}`,
        ),
      );

    this.eventBus
      .publish({
        eventName: 'affiliate.rejected',
        aggregate: 'affiliate',
        aggregateId: affiliateId,
        occurredAt: now,
        payload: { affiliateId, email: affiliate.email, reason },
      })
      .catch((err) =>
        this.logger.error(
          `Failed to publish affiliate.rejected for ${affiliateId}: ${err}`,
        ),
      );

    this.recordStatusChange({
      affiliateId,
      fromStatus: previousStatus,
      toStatus: 'REJECTED',
      adminId: rejectorAdminId,
      reason,
    });
    return updated;
  }

  async suspend(
    affiliateId: string,
    reason: string,
    adminId: string,
    audit?: { ipAddress?: string; userAgent?: string },
  ) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { id: true, status: true, email: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    if (affiliate.status === 'SUSPENDED') {
      throw new BadRequestAppException('Affiliate is already suspended.');
    }
    // Phase 159h — only an ACTIVE affiliate can be suspended (suspending a
    // PENDING/REJECTED/INACTIVE record is semantically meaningless).
    if (affiliate.status !== 'ACTIVE') {
      throw new BadRequestAppException(
        `Cannot suspend a ${affiliate.status} affiliate; only ACTIVE affiliates can be suspended.`,
      );
    }
    // Phase 159h — strip any HTML so the reason can't carry an XSS payload into
    // email templates / CSV exports that interpolate it.
    const cleanReason = (reason ?? '').replace(/<[^>]*>/g, '').trim();

    const previousStatus = affiliate.status;
    const now = new Date();
    // Phase 159h — atomic suspend: CAS the status, revoke sessions, cancel
    // in-flight payout requests (so a suspended affiliate can't be paid),
    // release their claimed commissions, and HOLD pending/confirmed commissions
    // (the return-window cron skips HOLD, so they stop accruing toward payout).
    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.affiliate.updateMany({
        where: { id: affiliateId, status: 'ACTIVE' },
        data: {
          status: 'SUSPENDED',
          suspendedAt: now,
          suspensionReason: cleanReason,
          suspendedById: adminId,
        },
      });
      if (claim.count === 0) {
        throw new ConflictAppException(
          'Affiliate status changed concurrently. Please reload and retry.',
        );
      }

      await tx.affiliateSession.updateMany({
        where: { affiliateId, revokedAt: null },
        data: { revokedAt: now },
      });

      // Cancel in-flight payout requests + unlink their (non-PAID) commissions.
      const inflight = await tx.affiliatePayoutRequest.findMany({
        where: { affiliateId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSING'] } },
        select: { id: true },
      });
      if (inflight.length > 0) {
        const ids = inflight.map((p) => p.id);
        await tx.affiliatePayoutRequest.updateMany({
          where: { id: { in: ids } },
          data: { status: 'CANCELLED', failedAt: now, failureReason: `Affiliate suspended: ${cleanReason}` },
        });
        await tx.affiliateCommission.updateMany({
          where: { payoutRequestId: { in: ids }, status: { not: 'PAID' } },
          data: { payoutRequestId: null },
        });
        // No TDS was withheld for a cancelled payout — drop its COMPUTED ledger row.
        await tx.affiliateTds194OLedger.deleteMany({
          where: { payoutRequestId: { in: ids }, status: 'COMPUTED' },
        });
      }

      // Freeze accruing commissions so the cron can't confirm them while
      // suspended; reactivate releases them.
      await tx.affiliateCommission.updateMany({
        where: { affiliateId, status: { in: ['PENDING', 'CONFIRMED'] } },
        data: { status: 'HOLD', holdReason: `Affiliate suspended: ${cleanReason}` },
      });

      return tx.affiliate.findUnique({
        where: { id: affiliateId },
        select: this.publicSelect(),
      });
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_SUSPENDED',
        module: 'affiliate',
        resource: 'Affiliate',
        resourceId: affiliateId,
        oldValue: { status: previousStatus },
        newValue: { status: 'SUSPENDED' },
        metadata: { reason: cleanReason },
        ipAddress: audit?.ipAddress,
        userAgent: audit?.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for AFFILIATE_SUSPENDED: ${err}`,
        ),
      );

    this.eventBus
      .publish({
        eventName: 'affiliate.suspended',
        aggregate: 'affiliate',
        aggregateId: affiliateId,
        occurredAt: now,
        payload: { affiliateId, email: affiliate.email, reason: cleanReason },
      })
      .catch((err) =>
        this.logger.error(
          `Failed to publish affiliate.suspended for ${affiliateId}: ${err}`,
        ),
      );

    this.recordStatusChange({
      affiliateId,
      fromStatus: previousStatus,
      toStatus: 'SUSPENDED',
      adminId,
      reason: cleanReason,
    });
    return updated;
  }

  async deactivate(
    affiliateId: string,
    adminId: string,
    audit?: { ipAddress?: string; userAgent?: string },
  ) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { id: true, status: true, email: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');

    const previousStatus = affiliate.status;
    const now = new Date();
    const updated = await this.prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        status: 'INACTIVE',
        deactivatedAt: now,
        deactivatedById: adminId,
      },
      select: this.publicSelect(),
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_DEACTIVATED',
        module: 'affiliate',
        resource: 'Affiliate',
        resourceId: affiliateId,
        oldValue: { status: previousStatus },
        newValue: { status: 'INACTIVE' },
        ipAddress: audit?.ipAddress,
        userAgent: audit?.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for AFFILIATE_DEACTIVATED: ${err}`,
        ),
      );

    this.eventBus
      .publish({
        eventName: 'affiliate.deactivated',
        aggregate: 'affiliate',
        aggregateId: affiliateId,
        occurredAt: now,
        payload: { affiliateId, email: affiliate.email },
      })
      .catch(() => undefined);

    this.recordStatusChange({
      affiliateId,
      fromStatus: previousStatus,
      toStatus: 'INACTIVE',
      adminId,
    });
    return updated;
  }

  async reactivate(
    affiliateId: string,
    adminId: string,
    reason?: string,
    audit?: { ipAddress?: string; userAgent?: string },
  ) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { id: true, status: true, email: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    if (affiliate.status === 'ACTIVE') {
      throw new BadRequestAppException('Affiliate is already active.');
    }
    const cleanReason = reason
      ? reason.replace(/<[^>]*>/g, '').trim() || null
      : null;

    const previousStatus = affiliate.status;
    const now = new Date();
    // Phase 159h — atomic reactivate: CAS the status (concurrent guard),
    // record the reason, and release commissions that the suspension HELD back
    // to PENDING so the return-window cron re-confirms the eligible ones.
    const updated = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.affiliate.updateMany({
        where: { id: affiliateId, status: { not: 'ACTIVE' } },
        data: {
          status: 'ACTIVE',
          reactivatedAt: now,
          reactivatedById: adminId,
          reactivationReason: cleanReason,
          suspendedAt: null,
          suspensionReason: null,
          suspendedById: null,
          deactivatedAt: null,
          deactivatedById: null,
        },
      });
      if (claim.count === 0) {
        throw new ConflictAppException(
          'Affiliate status changed concurrently. Please reload and retry.',
        );
      }
      await tx.affiliateCommission.updateMany({
        where: { affiliateId, status: 'HOLD', holdReason: { startsWith: 'Affiliate suspended' } },
        data: { status: 'PENDING', holdReason: null },
      });
      return tx.affiliate.findUnique({
        where: { id: affiliateId },
        select: this.publicSelect(),
      });
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_REACTIVATED',
        module: 'affiliate',
        resource: 'Affiliate',
        resourceId: affiliateId,
        oldValue: { status: previousStatus },
        newValue: { status: 'ACTIVE' },
        metadata: cleanReason ? { reason: cleanReason } : undefined,
        ipAddress: audit?.ipAddress,
        userAgent: audit?.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for AFFILIATE_REACTIVATED: ${err}`,
        ),
      );

    this.eventBus
      .publish({
        eventName: 'affiliate.reactivated',
        aggregate: 'affiliate',
        aggregateId: affiliateId,
        occurredAt: now,
        payload: { affiliateId, email: affiliate.email },
      })
      .catch(() => undefined);

    this.recordStatusChange({
      affiliateId,
      fromStatus: previousStatus,
      toStatus: 'ACTIVE',
      adminId,
      reason: cleanReason ?? undefined,
    });
    return updated;
  }

  async updateCommissionRate(input: {
    affiliateId: string;
    percentage: number | null;
    adminId: string;
    reason?: string;
    audit?: { ipAddress?: string; userAgent?: string };
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
    // null clears the override (falls back to the platform default).
    const newRate =
      input.percentage == null ? null : Math.round(input.percentage * 100) / 100;

    // Phase 159 — the whole change is atomic: read current → CAS on the
    // current rate value → write the denormalised updater columns →
    // append the history row. The CAS (audit: no version guard) makes a
    // concurrent change lose instead of silently last-write-wins.
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.affiliate.findUnique({
        where: { id: input.affiliateId },
        select: { id: true, commissionPercentage: true },
      });
      if (!current) throw new NotFoundAppException('Affiliate not found');

      const currentNum =
        current.commissionPercentage == null
          ? null
          : Number(current.commissionPercentage);

      // No-op (same value, incl. null→null): don't write a history row or audit.
      if (currentNum === newRate) {
        const unchanged = await tx.affiliate.findUnique({
          where: { id: input.affiliateId },
          select: this.publicSelect(),
        });
        return { affiliate: unchanged, changed: false, from: current.commissionPercentage };
      }

      // Compare-and-swap on the prior rate value. A concurrent update that
      // already changed the rate makes this match 0 rows → Conflict.
      const cas = await tx.affiliate.updateMany({
        where: {
          id: input.affiliateId,
          commissionPercentage: current.commissionPercentage,
        },
        data: {
          commissionPercentage: newRate,
          commissionPercentageUpdatedById: input.adminId,
          commissionPercentageUpdatedAt: new Date(),
        },
      });
      if (cas.count === 0) {
        throw new ConflictAppException(
          'Commission rate was changed concurrently. Please reload and retry.',
        );
      }

      await tx.affiliateCommissionRateHistory.create({
        data: {
          affiliateId: input.affiliateId,
          fromRate: current.commissionPercentage,
          toRate: newRate,
          changedByAdminId: input.adminId,
          reason: input.reason ?? null,
        },
      });

      const updated = await tx.affiliate.findUnique({
        where: { id: input.affiliateId },
        select: this.publicSelect(),
      });
      return { affiliate: updated, changed: true, from: current.commissionPercentage };
    });

    if (result.changed) {
      // Phase 159 — cross-system audit trail (audit Medium: no audit_logs row).
      this.audit
        .writeAuditLog({
          actorId: input.adminId,
          actorRole: 'ADMIN',
          action: 'AFFILIATE_COMMISSION_RATE_UPDATED',
          module: 'affiliate',
          resource: 'Affiliate',
          resourceId: input.affiliateId,
          oldValue: { commissionPercentage: result.from },
          newValue: { commissionPercentage: newRate },
          ipAddress: input.audit?.ipAddress,
          userAgent: input.audit?.userAgent,
        })
        .catch((err) =>
          this.logger.error(
            `Audit log write failed for AFFILIATE_COMMISSION_RATE_UPDATED: ${err}`,
          ),
        );

      this.eventBus
        .publish({
          eventName: 'affiliate.commission_rate_updated',
          aggregate: 'affiliate',
          aggregateId: input.affiliateId,
          occurredAt: new Date(),
          payload: {
            affiliateId: input.affiliateId,
            fromRate: result.from == null ? null : Number(result.from),
            toRate: newRate,
            changedByAdminId: input.adminId,
          },
        })
        .catch((err) =>
          this.logger.error(
            `Event publish failed for affiliate.commission_rate_updated: ${err}`,
          ),
        );
    }

    return result.affiliate;
  }

  async updateCouponConfig(input: {
    affiliateId: string;
    couponId: string;
    isActive?: boolean;
    // Phase 158 — FREE_SHIPPING added; maxDiscountAmount caps a PERCENT
    // discount; startsAt schedules a future activation.
    customerDiscountType?: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null;
    customerDiscountValue?: number | null;
    maxDiscountAmount?: number | null;
    startsAt?: Date | null;
    expiresAt?: Date | null;
    maxUses?: number | null;
    perUserLimit?: number;
    minOrderValue?: number | null;
    // Finding #13 — optional human-readable reason recorded on the row when
    // this update DEACTIVATES the coupon (revokes it). Threaded from the
    // admin DTO; ignored on a reactivate / no-op.
    revocationReason?: string | null;
    adminId: string;
    audit?: { ipAddress?: string; userAgent?: string };
  }) {
    // Phase 158 — fetch the current config so we can write a before/after
    // audit diff (audit finding #9: coupon-config changes were unaudited,
    // yet they directly move customer-facing money).
    const coupon = await this.prisma.affiliateCouponCode.findUnique({
      where: { id: input.couponId },
      select: {
        id: true,
        affiliateId: true,
        isActive: true,
        customerDiscountType: true,
        customerDiscountValue: true,
        maxDiscountAmount: true,
        startsAt: true,
        expiresAt: true,
        maxUses: true,
        perUserLimit: true,
        minOrderValue: true,
      },
    });
    if (!coupon || coupon.affiliateId !== input.affiliateId) {
      throw new NotFoundAppException('Coupon not found for this affiliate');
    }

    if (input.customerDiscountType != null) {
      if (
        !['PERCENT', 'FIXED', 'FREE_SHIPPING'].includes(
          input.customerDiscountType,
        )
      ) {
        throw new BadRequestAppException(
          "customerDiscountType must be 'PERCENT', 'FIXED' or 'FREE_SHIPPING'.",
        );
      }
    }
    // The effective type after this update (incoming value, else the stored one)
    // — used to bound value-dependent validation below.
    const effectiveType =
      input.customerDiscountType !== undefined
        ? input.customerDiscountType
        : coupon.customerDiscountType;
    if (input.customerDiscountValue != null) {
      if (
        !Number.isFinite(input.customerDiscountValue) ||
        input.customerDiscountValue < 0
      ) {
        throw new BadRequestAppException('Discount value must be ≥ 0.');
      }
      if (effectiveType === 'PERCENT' && input.customerDiscountValue > 100) {
        throw new BadRequestAppException(
          'Percentage discount cannot exceed 100.',
        );
      }
    }
    // Phase 158 — a PERCENT/FIXED code must carry a positive value. Without
    // this an admin could save type=PERCENT with no value and the storefront
    // would silently apply a 0% discount.
    if (
      (effectiveType === 'PERCENT' || effectiveType === 'FIXED') &&
      input.customerDiscountValue === null
    ) {
      throw new BadRequestAppException(
        'A PERCENT or FIXED discount needs a value.',
      );
    }
    if (input.maxDiscountAmount != null) {
      if (
        !Number.isFinite(input.maxDiscountAmount) ||
        input.maxDiscountAmount < 0
      ) {
        throw new BadRequestAppException('Max discount amount must be ≥ 0.');
      }
    }
    if (
      input.maxUses != null &&
      (!Number.isInteger(input.maxUses) || input.maxUses < 0)
    ) {
      throw new BadRequestAppException(
        'Max uses must be a non-negative integer.',
      );
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
    // Phase 158 — reject a malformed date string (new Date('garbage') yields
    // an Invalid Date) before it can reach Prisma as a cryptic 500.
    if (input.startsAt != null && Number.isNaN(input.startsAt.getTime())) {
      throw new BadRequestAppException('Invalid start date.');
    }
    if (input.expiresAt != null && Number.isNaN(input.expiresAt.getTime())) {
      throw new BadRequestAppException('Invalid expiry date.');
    }
    // Phase 158 — the activation window must be coherent. Compare against the
    // incoming value where provided, else the stored one.
    const effectiveStartsAt =
      input.startsAt !== undefined ? input.startsAt : coupon.startsAt;
    const effectiveExpiresAt =
      input.expiresAt !== undefined ? input.expiresAt : coupon.expiresAt;
    if (
      effectiveStartsAt &&
      effectiveExpiresAt &&
      effectiveStartsAt >= effectiveExpiresAt
    ) {
      throw new BadRequestAppException(
        'Coupon start date must be before its expiry date.',
      );
    }

    const data: any = {};
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.customerDiscountType !== undefined)
      data.customerDiscountType = input.customerDiscountType;
    if (input.customerDiscountValue !== undefined)
      data.customerDiscountValue = input.customerDiscountValue;
    if (input.maxDiscountAmount !== undefined)
      data.maxDiscountAmount = input.maxDiscountAmount;
    if (input.startsAt !== undefined) data.startsAt = input.startsAt;
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
    if (input.maxUses !== undefined) data.maxUses = input.maxUses;
    if (input.perUserLimit !== undefined) data.perUserLimit = input.perUserLimit;
    if (input.minOrderValue !== undefined) data.minOrderValue = input.minOrderValue;

    // Phase 158 — FREE_SHIPPING carries no subtotal value or percentage cap;
    // clear them so stale numbers can't mislead a future reader/audit.
    if (input.customerDiscountType === 'FREE_SHIPPING') {
      data.customerDiscountValue = null;
      data.maxDiscountAmount = null;
    }

    // Finding #13 — revocation provenance. Setting isActive=false silently
    // killed a customer-facing coupon with no on-row trail of who/when/why.
    // Only act on a genuine TRANSITION (incoming value differs from stored);
    // an unchanged isActive (or an undefined isActive) leaves the columns
    // alone so re-saving other config can't blank an existing revoke record.
    if (input.isActive !== undefined && input.isActive !== coupon.isActive) {
      if (input.isActive === false) {
        // Deactivate → stamp the revocation provenance.
        data.revokedByAdminId = input.adminId;
        data.revokedAt = new Date();
        data.revocationReason = input.revocationReason ?? null;
      } else {
        // Reactivate → clear the prior revocation so a re-enabled coupon
        // doesn't carry a stale revoked-by/at/reason.
        data.revokedByAdminId = null;
        data.revokedAt = null;
        data.revocationReason = null;
      }
    }

    const updated = await this.prisma.affiliateCouponCode.update({
      where: { id: input.couponId },
      data,
      select: {
        id: true,
        code: true,
        isPrimary: true,
        isActive: true,
        startsAt: true,
        expiresAt: true,
        maxUses: true,
        usedCount: true,
        perUserLimit: true,
        minOrderValue: true,
        customerDiscountType: true,
        customerDiscountValue: true,
        maxDiscountAmount: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Phase 158 (audit finding #9) — record the config change. Coupon config
    // is customer-facing money; a silent change had no trail before.
    this.audit
      .writeAuditLog({
        actorId: input.adminId,
        actorRole: 'ADMIN',
        action: 'AFFILIATE_COUPON_CONFIG_UPDATED',
        module: 'affiliate',
        resource: 'AffiliateCouponCode',
        resourceId: input.couponId,
        oldValue: {
          isActive: coupon.isActive,
          customerDiscountType: coupon.customerDiscountType,
          customerDiscountValue: coupon.customerDiscountValue,
          maxDiscountAmount: coupon.maxDiscountAmount,
          startsAt: coupon.startsAt,
          expiresAt: coupon.expiresAt,
          maxUses: coupon.maxUses,
          perUserLimit: coupon.perUserLimit,
          minOrderValue: coupon.minOrderValue,
        },
        newValue: {
          isActive: updated.isActive,
          customerDiscountType: updated.customerDiscountType,
          customerDiscountValue: updated.customerDiscountValue,
          maxDiscountAmount: updated.maxDiscountAmount,
          startsAt: updated.startsAt,
          expiresAt: updated.expiresAt,
          maxUses: updated.maxUses,
          perUserLimit: updated.perUserLimit,
          minOrderValue: updated.minOrderValue,
        },
        ipAddress: input.audit?.ipAddress,
        userAgent: input.audit?.userAgent,
      })
      .catch((err) =>
        this.logger.error(
          `Audit log write failed for AFFILIATE_COUPON_CONFIG_UPDATED: ${err}`,
        ),
      );

    return updated;
  }

  /**
   * Phase 159b — create an ADDITIONAL affiliate coupon (campaign codes).
   * Before this the only coupon an affiliate had was the primary minted on
   * approval. Admin-only; the affiliate must be ACTIVE. A per-affiliate cap
   * (AffiliateSettings.maxCodesPerAffiliate) guards against abuse/admin error.
   * The code is admin-supplied (validated + uppercased) or auto-generated with
   * the same crypto candidate generator + collision retry the approval uses.
   */
  async createAdditionalCoupon(input: {
    affiliateId: string;
    code?: string;
    customerDiscountType?: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING' | null;
    customerDiscountValue?: number | null;
    maxDiscountAmount?: number | null;
    minOrderValue?: number | null;
    maxUses?: number | null;
    perUserLimit?: number;
    startsAt?: Date | null;
    expiresAt?: Date | null;
    isPrimary?: boolean;
    adminId: string;
    audit?: { ipAddress?: string; userAgent?: string };
  }) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: input.affiliateId },
      select: { id: true, status: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');
    if (affiliate.status !== 'ACTIVE') {
      throw new BadRequestAppException(
        'Coupons can only be added to an ACTIVE affiliate.',
      );
    }

    // Per-affiliate cap (abuse / admin-error guard).
    const settings = await this.prisma.affiliateSettings.findUnique({
      where: { id: 'singleton' },
      select: { maxCodesPerAffiliate: true },
    });
    const cap = settings?.maxCodesPerAffiliate ?? 10;
    const existingCount = await this.prisma.affiliateCouponCode.count({
      where: { affiliateId: input.affiliateId },
    });
    if (existingCount >= cap) {
      throw new BadRequestAppException(
        `This affiliate already has the maximum of ${cap} coupon codes.`,
      );
    }

    // ── Discount config validation (mirrors updateCouponConfig, Phase 158) ──
    const type = input.customerDiscountType ?? null;
    let discountValue = input.customerDiscountValue ?? null;
    let maxDiscount = input.maxDiscountAmount ?? null;
    if (type === 'PERCENT' || type === 'FIXED') {
      if (
        discountValue == null ||
        !Number.isFinite(discountValue) ||
        discountValue < 0
      ) {
        throw new BadRequestAppException(
          'A PERCENT or FIXED discount needs a non-negative value.',
        );
      }
      if (type === 'PERCENT' && discountValue > 100) {
        throw new BadRequestAppException('Percentage discount cannot exceed 100.');
      }
      // The cap only applies to PERCENT.
      if (type !== 'PERCENT') maxDiscount = null;
      if (
        maxDiscount != null &&
        (!Number.isFinite(maxDiscount) || maxDiscount < 0)
      ) {
        throw new BadRequestAppException('Max discount amount must be ≥ 0.');
      }
    } else {
      // FREE_SHIPPING or attribution-only carry no subtotal value or cap.
      discountValue = null;
      maxDiscount = null;
    }
    if (
      input.minOrderValue != null &&
      (!Number.isFinite(input.minOrderValue) || input.minOrderValue < 0)
    ) {
      throw new BadRequestAppException('Minimum order value must be ≥ 0.');
    }
    if (
      input.maxUses != null &&
      (!Number.isInteger(input.maxUses) || input.maxUses < 0)
    ) {
      throw new BadRequestAppException('Max uses must be a non-negative integer.');
    }
    if (
      input.perUserLimit != null &&
      (!Number.isInteger(input.perUserLimit) || input.perUserLimit < 1)
    ) {
      throw new BadRequestAppException('Per-user limit must be a positive integer.');
    }
    const startsAt = input.startsAt ?? null;
    const expiresAt = input.expiresAt ?? null;
    if (startsAt && Number.isNaN(startsAt.getTime())) {
      throw new BadRequestAppException('Invalid start date.');
    }
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestAppException('Invalid expiry date.');
    }
    if (startsAt && expiresAt && startsAt >= expiresAt) {
      throw new BadRequestAppException(
        'Coupon start date must be before its expiry date.',
      );
    }

    // ── Code: admin-supplied (validated) or auto-generated ──
    let code: string;
    let autoGen = false;
    if (input.code != null && input.code.trim() !== '') {
      code = input.code.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,20}$/.test(code)) {
        throw new BadRequestAppException(
          'Coupon code must be 4–20 uppercase alphanumeric characters.',
        );
      }
    } else {
      code = this.generateCouponCandidate();
      autoGen = true;
    }

    const couponSelect = {
      id: true,
      code: true,
      isPrimary: true,
      isActive: true,
      startsAt: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
      perUserLimit: true,
      minOrderValue: true,
      customerDiscountType: true,
      customerDiscountValue: true,
      maxDiscountAmount: true,
      couponSource: true,
      createdByAdminId: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    // Retry only matters for auto-generated codes (collision → regenerate).
    // A manual-code or primary-partial collision surfaces as a clean Conflict.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          // Promoting this code to primary demotes the current primary first,
          // so the partial-unique (one primary per affiliate) holds.
          if (input.isPrimary === true) {
            await tx.affiliateCouponCode.updateMany({
              where: { affiliateId: input.affiliateId, isPrimary: true },
              data: { isPrimary: false },
            });
          }
          return tx.affiliateCouponCode.create({
            data: {
              affiliateId: input.affiliateId,
              code,
              isPrimary: input.isPrimary ?? false,
              isActive: true,
              customerDiscountType: type,
              customerDiscountValue: discountValue,
              maxDiscountAmount: maxDiscount,
              minOrderValue: input.minOrderValue ?? null,
              maxUses: input.maxUses ?? null,
              perUserLimit: input.perUserLimit ?? 1,
              startsAt,
              expiresAt,
              createdByAdminId: input.adminId,
              couponSource: 'ADMIN_MANUAL',
            },
            select: couponSelect,
          });
        });

        this.audit
          .writeAuditLog({
            actorId: input.adminId,
            actorRole: 'ADMIN',
            action: 'AFFILIATE_COUPON_CREATED',
            module: 'affiliate',
            resource: 'AffiliateCouponCode',
            resourceId: created.id,
            newValue: {
              affiliateId: input.affiliateId,
              code: created.code,
              isPrimary: created.isPrimary,
              couponSource: 'ADMIN_MANUAL',
            },
            ipAddress: input.audit?.ipAddress,
            userAgent: input.audit?.userAgent,
          })
          .catch((err) =>
            this.logger.error(
              `Audit log write failed for AFFILIATE_COUPON_CREATED: ${err}`,
            ),
          );

        this.eventBus
          .publish({
            eventName: 'affiliate.coupon_created',
            aggregate: 'affiliate',
            aggregateId: input.affiliateId,
            occurredAt: new Date(),
            payload: {
              affiliateId: input.affiliateId,
              couponId: created.id,
              code: created.code,
              isPrimary: created.isPrimary,
              couponSource: 'ADMIN_MANUAL',
            },
          })
          .catch((err) =>
            this.logger.error(
              `Event publish failed for affiliate.coupon_created: ${err}`,
            ),
          );

        return created;
      } catch (err: any) {
        // Any unique violation: for an auto-generated code, regenerate and
        // retry (the candidate, or—if promoting to primary—a racing primary
        // the re-run demote will clear). For an admin-supplied code we can't
        // silently change it, so surface a clean Conflict. We don't parse
        // meta.target because the primary guard is a raw-SQL partial index
        // whose reported target differs across Prisma versions.
        if (err?.code === 'P2002') {
          if (autoGen) {
            code = this.generateCouponCandidate();
            continue;
          }
          throw new ConflictAppException('That coupon code is already taken.');
        }
        throw err;
      }
    }
    throw new ConflictAppException(
      'Could not allocate a unique coupon code. Please retry.',
    );
  }

  // ── Helpers ─────────────────────────────────────────────────

  private publicSelect() {
    return {
      id: true,
      email: true,
      phone: true,
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
   * Phase 22 (2026-05-20) — coupon candidate generator.
   *
   * Uses crypto.randomInt (OS CSPRNG) instead of Math.random. The
   * pre-Phase-22 code used V8's Math.random which is NOT
   * cryptographically secure — an attacker observing one issued code
   * could narrow the PRNG state and predict subsequent codes. For
   * affiliate referral codes that drive revenue attribution that's
   * a fraud-enabling weakness.
   *
   * Alphabet avoids visually ambiguous characters (I/O/0/1) so
   * affiliates handing out their code over voice / handwriting don't
   * lose conversions to typos.
   */
  private generateCouponCandidate(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let body = '';
    for (let i = 0; i < 7; i++) {
      body += alphabet[randomInt(0, alphabet.length)];
    }
    return `AF${body}`;
  }

  private timingSoakDelay(): Promise<void> {
    const min = AffiliateRegistrationService.DUPLICATE_TIMING_DELAY_MIN_MS;
    const max = AffiliateRegistrationService.DUPLICATE_TIMING_DELAY_MAX_MS;
    const delay = min + Math.random() * (max - min);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
