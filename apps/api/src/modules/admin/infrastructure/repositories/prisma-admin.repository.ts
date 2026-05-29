import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { Prisma } from '@prisma/client';
import { hashRefreshToken } from '../../../../core/auth/refresh-token';
import {
  AdminRepository,
  AdminRecord,
  AdminSessionRecord,
  AdminPasswordResetOtpRecord,
  SellerListItem,
  CustomerListItem,
  CustomerDetail,
  MasterOrderRecord,
} from '../../domain/repositories/admin.repository.interface';

@Injectable()
export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Admin auth ─────────────────────────────────────────────

  async findAdminByEmail(email: string): Promise<AdminRecord | null> {
    return this.prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    }) as Promise<AdminRecord | null>;
  }

  async findAdminById(
    adminId: string,
    select?: Record<string, boolean>,
  ): Promise<Partial<AdminRecord> | null> {
    if (select) {
      return this.prisma.admin.findUnique({ where: { id: adminId }, select }) as any;
    }
    return this.prisma.admin.findUnique({ where: { id: adminId } }) as any;
  }

  async updateAdmin(adminId: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.admin.update({ where: { id: adminId }, data });
  }

  async advanceMfaLastUsedStepCas(
    adminId: string,
    step: number,
  ): Promise<boolean> {
    // updateMany with the CAS predicate in the WHERE clause: the row
    // only matches when the column is still ahead of or equal to the
    // previous step. Prisma returns `count` so the caller can detect
    // a lost race.
    const res = await this.prisma.admin.updateMany({
      where: {
        id: adminId,
        OR: [
          { mfaLastUsedStep: null },
          { mfaLastUsedStep: { lt: step } },
        ],
      },
      data: { mfaLastUsedStep: step },
    });
    return res.count === 1;
  }

  async createAdminSession(data: {
    adminId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<AdminSessionRecord> {
    // Phase 3 (PR 3.2) — hash the raw refresh token before persisting.
    // Callers pass the raw token; the response body returns the raw
    // token to the client. Only the hash lives in the DB.
    return this.prisma.adminSession.create({
      data: { ...data, refreshToken: hashRefreshToken(data.refreshToken) },
    }) as Promise<AdminSessionRecord>;
  }

  async revokeAdminSessions(adminId: string): Promise<void> {
    // Phase 26 (2026-05-20) — also null stepUpVerifiedAt. The schema
    // comment on AdminSession.stepUpVerifiedAt promises the column is
    // "Reset to null on revoke / logout"; pre-Phase-26 the code only
    // wrote revokedAt and relied on the StepUpGuard rejecting revoked
    // sessions to make the stale stamp moot. That was correct
    // operationally but a future refactor that reads stepUpVerifiedAt
    // without checking revokedAt would silently extend a revoked
    // session's elevation. Cheap to make the docstring honest.
    await this.prisma.adminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date(), stepUpVerifiedAt: null } as any,
    });
  }

  async findAdminSessionByRefreshToken(rawToken: string): Promise<{
    id: string;
    adminId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  } | null> {
    return this.prisma.adminSession.findFirst({
      where: { refreshToken: hashRefreshToken(rawToken) },
      select: {
        id: true,
        adminId: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Phase 1 / C6 — secondary lookup on the burned-hash slot. Hit on
   * this path means the caller presented a refresh token that was
   * already rotated out — i.e. the token was stolen at some point
   * and the attacker is now trying to use it. Returns the adminId
   * so the use-case can revoke every session for them.
   */
  async findAdminSessionByPreviousRefreshToken(rawToken: string): Promise<{
    id: string;
    adminId: string;
  } | null> {
    return this.prisma.adminSession.findFirst({
      where: { previousRefreshTokenHash: hashRefreshToken(rawToken) } as any,
      select: { id: true, adminId: true },
    });
  }

  async rotateAdminSession(
    sessionId: string,
    newRawRefreshToken: string,
    newExpiresAt: Date,
  ): Promise<void> {
    // Phase 1 / C6 — capture the burned hash into
    // `previousRefreshTokenHash` so a future refresh request
    // presenting the old (now rotated) token can be detected as
    // theft via findAdminSessionByPreviousRefreshToken.
    const current = await this.prisma.adminSession.findUnique({
      where: { id: sessionId },
      select: { refreshToken: true },
    });
    await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: {
        previousRefreshTokenHash: current?.refreshToken ?? null,
        refreshToken: hashRefreshToken(newRawRefreshToken),
        expiresAt: newExpiresAt,
      } as any,
    });
  }

  // PR 10.10 — step-up auth. Stamp the session as freshly step-up-
  // verified so subsequent destructive-route requests in the
  // configured window pass the @RequiresStepUp guard. The `data`
  // shape uses a column that landed in the PR 10.10 schema change;
  // the cast bypasses the generated-type lag until the operator
  // runs `prisma generate` post-migration.
  async markSessionStepUpVerified(sessionId: string): Promise<void> {
    await this.prisma.adminSession.update({
      where: { id: sessionId },
      data: { stepUpVerifiedAt: new Date() } as any,
    });
  }

  // Phase 25 (2026-05-20) — race-safe MFA enrolment commit. The
  // updateMany pattern fails atomically against the optimistic-
  // concurrency predicate `mfaEnabledAt: null`: only the first of
  // two parallel completes sees count === 1. The other receives
  // count === 0 and the service surfaces a 409. The pending-secret
  // column is also nulled here so a partial-write failure mode
  // cannot leave the admin enrolled with a still-pending secret.
  async commitMfaEnrollmentAtomic(args: {
    adminId: string;
    pendingCiphertext: string;
    enabledAt: Date;
    lastUsedStep: number;
  }): Promise<boolean> {
    const res = await this.prisma.admin.updateMany({
      where: { id: args.adminId, mfaEnabledAt: null },
      data: {
        mfaSecretCiphertext: args.pendingCiphertext,
        mfaPendingSecretCiphertext: null,
        mfaPendingExpiresAt: null,
        mfaEnabledAt: args.enabledAt,
        mfaLastUsedStep: args.lastUsedStep,
      } as any,
    });
    return res.count === 1;
  }

  // ── Seller management ──────────────────────────────────────

  async findSellerById(sellerId: string): Promise<any | null> {
    return this.prisma.seller.findUnique({ where: { id: sellerId } });
  }

  async findSellerByIdWithSelect(
    sellerId: string,
    select: Record<string, boolean>,
  ): Promise<any | null> {
    return this.prisma.seller.findUnique({ where: { id: sellerId }, select });
  }

  async listSellers(params: {
    where: Prisma.SellerWhereInput;
    orderBy: Prisma.SellerOrderByWithRelationInput;
    skip: number;
    take: number;
  }): Promise<[SellerListItem[], number]> {
    const { where, orderBy, skip, take } = params;
    const [sellers, total] = await Promise.all([
      this.prisma.seller.findMany({
        where,
        select: {
          id: true,
          sellerName: true,
          sellerShopName: true,
          email: true,
          phoneNumber: true,
          status: true,
          verificationStatus: true,
          isEmailVerified: true,
          profileCompletionPercentage: true,
          isProfileCompleted: true,
          sellerProfileImageUrl: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy,
        skip,
        take,
      }),
      this.prisma.seller.count({ where }),
    ]);
    return [sellers as SellerListItem[], total];
  }

  async updateSeller(
    sellerId: string,
    data: Record<string, unknown>,
    select?: Record<string, boolean>,
  ): Promise<any> {
    if (select) {
      return this.prisma.seller.update({ where: { id: sellerId }, data, select });
    }
    return this.prisma.seller.update({ where: { id: sellerId }, data });
  }

  async softDeleteSellerAndRevokeSessions(sellerId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.seller.update({
        where: { id: sellerId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          status: 'DEACTIVATED',
        },
      }),
      this.prisma.sellerSession.updateMany({
        where: { sellerId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async changeSellerPasswordAndRevokeSessions(
    sellerId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.seller.update({
        where: { id: sellerId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      }),
      this.prisma.sellerSession.updateMany({
        where: { sellerId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── Impersonation log ──────────────────────────────────────

  // Phase 28 (2026-05-21) — multi-actor + JTI tracking shape.
  async createImpersonationLog(data: {
    adminId: string;
    targetActorType: 'SELLER' | 'FRANCHISE';
    targetActorId: string;
    tokenId: string;
    tokenJti: string;
    reason?: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.adminImpersonationLog.create({
      data: {
        adminId: data.adminId,
        targetActorType: data.targetActorType,
        targetActorId: data.targetActorId,
        // Preserve sellerId mirror for back-compat with old readers
        // when the target is a seller. Franchise rows leave it null.
        sellerId:
          data.targetActorType === 'SELLER' ? data.targetActorId : null,
        tokenId: data.tokenId,
        tokenJti: data.tokenJti,
        reason: data.reason ?? null,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      } as any,
    });
  }

  async findImpersonationLogByJti(tokenJti: string): Promise<{
    id: string;
    adminId: string;
    targetActorType: 'SELLER' | 'FRANCHISE';
    targetActorId: string;
    endedAt: Date | null;
    revokedAt: Date | null;
  } | null> {
    const row = await (this.prisma.adminImpersonationLog.findUnique as any)({
      where: { tokenJti },
      select: {
        id: true,
        adminId: true,
        targetActorType: true,
        targetActorId: true,
        endedAt: true,
        revokedAt: true,
      },
    });
    return row ?? null;
  }

  async endImpersonationLog(args: {
    id: string;
    endedAt: Date;
    revokedAt?: Date | null;
    revokedReason?: string | null;
  }): Promise<void> {
    await this.prisma.adminImpersonationLog.update({
      where: { id: args.id },
      data: {
        endedAt: args.endedAt,
        revokedAt: args.revokedAt ?? null,
        revokedReason: args.revokedReason ?? null,
        isActive: false,
      } as any,
    });
  }

  // ── Seller messages ────────────────────────────────────────

  async createSellerMessage(data: {
    sellerId: string;
    sentByAdminId: string;
    subject: string;
    message: string;
    channel: string;
    status: string;
  }): Promise<{
    id: string;
    subject: string;
    channel: string;
    status: string;
    createdAt: Date;
  }> {
    return this.prisma.adminSellerMessage.create({ data }) as any;
  }

  // ── Audit log ──────────────────────────────────────────────

  async createAuditLog(data: {
    adminId: string;
    sellerId?: string | null;
    actionType: string;
    oldValue?: any;
    newValue?: any;
    reason?: string | null;
    metadata?: any;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.prisma.adminActionAuditLog.create({
      data: {
        adminId: data.adminId,
        sellerId: data.sellerId || null,
        actionType: data.actionType,
        oldValue: data.oldValue ? JSON.parse(JSON.stringify(data.oldValue)) : undefined,
        newValue: data.newValue ? JSON.parse(JSON.stringify(data.newValue)) : undefined,
        reason: data.reason || null,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
      },
    });
  }

  // ── Customers ──────────────────────────────────────────────

  async listCustomers(params: {
    where: any;
    skip: number;
    take: number;
  }): Promise<[CustomerListItem[], number]> {
    const { where, skip, take } = params;
    const [customers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
          emailVerified: true,
          createdAt: true,
          addresses: {
            select: { city: true, state: true, country: true },
            orderBy: [
              { isDefault: 'desc' as const },
              { createdAt: 'desc' as const },
            ],
            take: 1,
          },
          orders: {
            select: { totalAmount: true, paymentStatus: true },
          },
        },
        orderBy: { createdAt: 'desc' as const },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return [customers as CustomerListItem[], total];
  }

  async findCustomerById(customerId: string): Promise<CustomerDetail | null> {
    return this.prisma.user.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        emailVerified: true,
        createdAt: true,
        addresses: {
          orderBy: { isDefault: 'desc' as const },
        },
      },
    }) as Promise<CustomerDetail | null>;
  }

  async findCustomerOrders(customerId: string): Promise<MasterOrderRecord[]> {
    return this.prisma.masterOrder.findMany({
      where: { customerId },
      include: {
        subOrders: {
          include: {
            items: true,
            seller: { select: { sellerShopName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' as const },
    }) as unknown as MasterOrderRecord[];
  }

  // ── Admin password reset OTP ────────────────────────────────────────────

  async findRecentAdminOtp(params: {
    adminId: string;
    unusedOnly: boolean;
    createdAfter: Date;
  }): Promise<AdminPasswordResetOtpRecord | null> {
    return this.prisma.adminPasswordResetOtp.findFirst({
      where: {
        adminId: params.adminId,
        ...(params.unusedOnly ? { usedAt: null } : {}),
        createdAt: { gte: params.createdAfter },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<AdminPasswordResetOtpRecord | null>;
  }

  async findActiveAdminOtp(
    adminId: string,
  ): Promise<AdminPasswordResetOtpRecord | null> {
    return this.prisma.adminPasswordResetOtp.findFirst({
      where: {
        adminId,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<AdminPasswordResetOtpRecord | null>;
  }

  async invalidateActiveAdminOtps(adminId: string): Promise<void> {
    await this.prisma.adminPasswordResetOtp.updateMany({
      where: {
        adminId,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { expiresAt: new Date() },
    });
  }

  async createAdminOtp(data: {
    adminId: string;
    otpHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.adminPasswordResetOtp.create({
      data: {
        adminId: data.adminId,
        otpHash: data.otpHash,
        purpose: data.purpose,
        expiresAt: data.expiresAt,
      },
    });
  }

  async incrementAdminOtpAttempts(otpId: string): Promise<void> {
    await this.prisma.adminPasswordResetOtp.update({
      where: { id: otpId },
      data: { attempts: { increment: 1 } },
    });
  }

  /**
   * Phase 26 (2026-05-20) — count of admin OTPs created since a given
   * timestamp. Powers the per-admin hourly resend cap. Mirror of
   * countOtpsSince in seller / franchise repos.
   */
  async countAdminOtpsSince(adminId: string, since: Date): Promise<number> {
    return this.prisma.adminPasswordResetOtp.count({
      where: { adminId, createdAt: { gte: since } },
    });
  }

  /**
   * Phase 26 (2026-05-20) — atomic CAS attempt increment for admin
   * reset OTPs. Mirrors PrismaUserRepository / PrismaSellerRepository /
   * PrismaFranchiseRepository. The WHERE clause expresses "still
   * active AND below cap" inside the same UPDATE statement so two
   * parallel verify requests cannot both pass the eligibility check.
   * Returns the post-increment attempts count or {ok: false} when
   * the row was ineligible (cap reached, expired, or already used).
   */
  async incrementAdminOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }> {
    const res = await this.prisma.adminPasswordResetOtp.updateMany({
      where: {
        id: otpId,
        attempts: { lt: maxAttempts },
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    if (res.count !== 1) return { ok: false };
    const after = await this.prisma.adminPasswordResetOtp.findUnique({
      where: { id: otpId },
      select: { attempts: true },
    });
    return { ok: true, attempts: after?.attempts ?? 0 };
  }

  async expireAdminOtp(otpId: string): Promise<void> {
    await this.prisma.adminPasswordResetOtp.update({
      where: { id: otpId },
      data: { expiresAt: new Date() },
    });
  }

  async markAdminOtpVerified(
    otpId: string,
    resetToken: string,
  ): Promise<void> {
    await this.prisma.adminPasswordResetOtp.update({
      where: { id: otpId },
      data: { verifiedAt: new Date(), resetToken },
    });
  }

  async findAdminOtpByResetToken(
    resetToken: string,
  ): Promise<AdminPasswordResetOtpRecord | null> {
    return this.prisma.adminPasswordResetOtp.findUnique({
      where: { resetToken },
      include: {
        admin: { select: { id: true, email: true, status: true } },
      },
    }) as unknown as AdminPasswordResetOtpRecord | null;
  }

  async resetAdminPasswordTransaction(params: {
    adminId: string;
    passwordHash: string;
    otpId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: params.adminId },
        data: {
          passwordHash: params.passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });
      await tx.adminPasswordResetOtp.update({
        where: { id: params.otpId },
        data: { usedAt: new Date() },
      });
      // Revoke all existing sessions — forces re-login with the new password.
      await tx.adminSession.updateMany({
        where: { adminId: params.adminId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
