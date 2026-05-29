import { Injectable } from '@nestjs/common';
import {
  FranchisePartner,
  FranchiseSession,
  FranchisePasswordResetOtp,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { hashRefreshToken } from '../../../../core/auth/refresh-token';
import {
  FranchisePartnerRepository,
  OtpWithFranchise,
} from '../../domain/repositories/franchise.repository.interface';

@Injectable()
export class PrismaFranchiseRepository implements FranchisePartnerRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Auth / Franchise Partner CRUD ──────────────────────────

  async findByEmail(email: string): Promise<FranchisePartner | null> {
    return this.prisma.franchisePartner.findFirst({
      where: { email, isDeleted: false },
    });
  }

  async findByPhone(phoneNumber: string): Promise<FranchisePartner | null> {
    return this.prisma.franchisePartner.findFirst({
      where: { phoneNumber, isDeleted: false },
    });
  }

  /**
   * Phase 20 (2026-05-20) — duplicate-GSTIN pre-check. Excludes
   * soft-deleted rows so a deleted franchise's old GSTIN can be
   * re-claimed. Returns only the id — the caller's only decision is
   * "is this someone else's row?" so a wider select is wasted IO.
   */
  async findByGstNumber(gstNumber: string): Promise<{ id: string } | null> {
    return this.prisma.franchisePartner.findFirst({
      where: { gstNumber, isDeleted: false },
      select: { id: true },
    });
  }

  async findByPanNumber(panNumber: string): Promise<{ id: string } | null> {
    return this.prisma.franchisePartner.findFirst({
      where: { panNumber, isDeleted: false },
      select: { id: true },
    });
  }

  async findById(id: string): Promise<FranchisePartner | null> {
    return this.prisma.franchisePartner.findFirst({
      where: { id, isDeleted: false },
    });
  }

  async findByIdSelect<T extends Record<string, boolean>>(
    id: string,
    select: T,
  ): Promise<Pick<
    FranchisePartner,
    Extract<keyof T, keyof FranchisePartner>
  > | null> {
    return this.prisma.franchisePartner.findFirst({
      where: { id, isDeleted: false },
      select,
    }) as any;
  }

  async createFranchise(data: {
    ownerName: string;
    businessName: string;
    email: string;
    phoneNumber: string;
    passwordHash: string;
    franchiseCode: string;
  }): Promise<FranchisePartner> {
    return this.prisma.franchisePartner.create({ data });
  }

  async updateFranchise(
    id: string,
    data: Record<string, unknown>,
  ): Promise<FranchisePartner> {
    return this.prisma.franchisePartner.update({ where: { id }, data });
  }

  async updateFranchiseSelect<T extends Record<string, boolean>>(
    id: string,
    data: Record<string, unknown>,
    select: T,
  ): Promise<Pick<FranchisePartner, Extract<keyof T, keyof FranchisePartner>>> {
    return this.prisma.franchisePartner.update({
      where: { id },
      data,
      select,
    }) as any;
  }

  // ── Session operations ──────────────────────────────────────

  async createSession(data: {
    franchisePartnerId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<FranchiseSession> {
    // Phase 3 (PR 3.2) — hash before persisting. See refresh-token.ts
    // header for the security rationale.
    return this.prisma.franchiseSession.create({
      data: { ...data, refreshToken: hashRefreshToken(data.refreshToken) },
    });
  }

  async revokeAllSessions(franchisePartnerId: string): Promise<void> {
    await this.prisma.franchiseSession.updateMany({
      where: { franchisePartnerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async findSessionByRefreshToken(rawToken: string): Promise<{
    id: string;
    franchisePartnerId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null> {
    return this.prisma.franchiseSession.findFirst({
      where: { refreshToken: hashRefreshToken(rawToken) },
      select: {
        id: true,
        franchisePartnerId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  /**
   * Phase 1 / C6 — secondary lookup on the burned-hash slot.
   * Same contract as Admin / Seller: hit = theft replay.
   */
  async findSessionByPreviousRefreshToken(rawToken: string): Promise<{
    id: string;
    franchisePartnerId: string;
  } | null> {
    return this.prisma.franchiseSession.findFirst({
      where: { previousRefreshTokenHash: hashRefreshToken(rawToken) } as any,
      select: { id: true, franchisePartnerId: true },
    });
  }

  async rotateSession(
    sessionId: string,
    newRawRefreshToken: string,
    newExpiresAt: Date,
  ): Promise<void> {
    // Phase 1 / C6 — stash the burned hash for reuse detection.
    const current = await this.prisma.franchiseSession.findUnique({
      where: { id: sessionId },
      select: { refreshToken: true },
    });
    await this.prisma.franchiseSession.update({
      where: { id: sessionId },
      data: {
        previousRefreshTokenHash: current?.refreshToken ?? null,
        refreshToken: hashRefreshToken(newRawRefreshToken),
        expiresAt: newExpiresAt,
      } as any,
    });
  }

  // ── OTP operations ──────────────────────────────────────────

  async findRecentOtp(params: {
    franchisePartnerId: string;
    purpose?: string;
    unusedOnly: boolean;
    createdAfter?: Date;
  }): Promise<FranchisePasswordResetOtp | null> {
    const where: Record<string, unknown> = {
      franchisePartnerId: params.franchisePartnerId,
    };
    if (params.purpose) where.purpose = params.purpose;
    if (params.unusedOnly) where.usedAt = null;
    if (params.createdAfter) where.createdAt = { gte: params.createdAfter };

    return this.prisma.franchisePasswordResetOtp.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOtpByResetToken(
    resetToken: string,
  ): Promise<OtpWithFranchise | null> {
    return this.prisma.franchisePasswordResetOtp.findUnique({
      where: { resetToken },
      include: { franchisePartner: true },
    });
  }

  async findLatestValidOtp(
    franchisePartnerId: string,
    purpose?: string,
  ): Promise<FranchisePasswordResetOtp | null> {
    const where: Record<string, unknown> = {
      franchisePartnerId,
      usedAt: null,
      verifiedAt: null,
      expiresAt: { gte: new Date() },
    };
    if (purpose) where.purpose = purpose;

    return this.prisma.franchisePasswordResetOtp.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async countOtpsSince(
    franchisePartnerId: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.franchisePasswordResetOtp.count({
      where: { franchisePartnerId, createdAt: { gte: since } },
    });
  }

  async invalidateActiveOtps(
    franchisePartnerId: string,
    purpose?: string,
  ): Promise<void> {
    const where: Record<string, unknown> = {
      franchisePartnerId,
      usedAt: null,
      verifiedAt: null,
      expiresAt: { gte: new Date() },
    };
    if (purpose) where.purpose = purpose;

    await this.prisma.franchisePasswordResetOtp.updateMany({
      where,
      data: { expiresAt: new Date() },
    });
  }

  async createOtp(data: {
    franchisePartnerId: string;
    otpHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<FranchisePasswordResetOtp> {
    return this.prisma.franchisePasswordResetOtp.create({ data });
  }

  async updateOtp(
    id: string,
    data: Record<string, unknown>,
  ): Promise<FranchisePasswordResetOtp> {
    return this.prisma.franchisePasswordResetOtp.update({
      where: { id },
      data,
    });
  }

  async expireOtp(id: string): Promise<void> {
    await this.prisma.franchisePasswordResetOtp.update({
      where: { id },
      data: { expiresAt: new Date() },
    });
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.prisma.franchisePasswordResetOtp.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  /**
   * Phase 20 (2026-05-20) — atomic CAS attempt increment. WHERE
   * asserts "still active AND below cap" inside the same UPDATE so
   * concurrent verify calls cannot bypass the cap.
   */
  async incrementOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }> {
    const res = await this.prisma.franchisePasswordResetOtp.updateMany({
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
    const after = await this.prisma.franchisePasswordResetOtp.findUnique({
      where: { id: otpId },
      select: { attempts: true },
    });
    return { ok: true, attempts: after?.attempts ?? 0 };
  }

  // ── Transactional operations ────────────────────────────────

  async resetPasswordTransaction(params: {
    franchisePartnerId: string;
    otpId: string;
    passwordHash: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.franchisePartner.update({
        where: { id: params.franchisePartnerId },
        data: { passwordHash: params.passwordHash },
      });

      await tx.franchisePasswordResetOtp.update({
        where: { id: params.otpId },
        data: { usedAt: new Date() },
      });

      // Invalidate all other unexpired OTPs for this franchise partner
      await tx.franchisePasswordResetOtp.updateMany({
        where: {
          franchisePartnerId: params.franchisePartnerId,
          id: { not: params.otpId },
          usedAt: null,
          expiresAt: { gte: new Date() },
        },
        data: { expiresAt: new Date() },
      });

      // Revoke all active sessions
      await tx.franchiseSession.updateMany({
        where: { franchisePartnerId: params.franchisePartnerId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async changePasswordTransaction(params: {
    franchisePartnerId: string;
    passwordHash: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.franchisePartner.update({
        where: { id: params.franchisePartnerId },
        data: {
          passwordHash: params.passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });

      await tx.franchiseSession.updateMany({
        where: { franchisePartnerId: params.franchisePartnerId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async verifyEmailTransaction(params: {
    franchisePartnerId: string;
    otpId: string;
  }): Promise<void> {
    // Phase 20 (2026-05-20) — same now() across both writes so the
    // boolean and the new timestamp column stay in lockstep.
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.franchisePasswordResetOtp.update({
        where: { id: params.otpId },
        data: { verifiedAt: now, usedAt: now },
      }),
      this.prisma.franchisePartner.update({
        where: { id: params.franchisePartnerId },
        data: {
          isEmailVerified: true,
          emailVerifiedAt: now,
        },
      }),
    ]);
  }

  // ── Admin operations ────────────────────────────────────────

  async findAll(params: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
    verificationStatus?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ records: FranchisePartner[]; total: number }> {
    const where: Record<string, unknown> = { isDeleted: false };

    if (params.search) {
      where.OR = [
        { ownerName: { contains: params.search, mode: 'insensitive' } },
        { businessName: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { franchiseCode: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.verificationStatus) {
      where.verificationStatus = params.verificationStatus;
    }

    const orderBy: Record<string, string> = {};
    orderBy[params.sortBy || 'createdAt'] = params.sortOrder || 'desc';

    const skip = (params.page - 1) * params.limit;

    const [records, total] = await this.prisma.$transaction([
      this.prisma.franchisePartner.findMany({
        where,
        orderBy,
        skip,
        take: params.limit,
      }),
      this.prisma.franchisePartner.count({ where }),
    ]);

    return { records, total };
  }

  async generateNextFranchiseCode(): Promise<string> {
    // Upsert-increment pattern (mirrors ProcurementSequence and PosSaleSequence).
    // Race-safe because the row-level lock taken by the UPDATE serialises
    // concurrent calls. Survives soft-deletes correctly because the sequence
    // is monotonic — never derived from current count.
    const sequence = await this.prisma.$transaction(
      async (tx) =>
        tx.franchiseCodeSequence.upsert({
          where: { id: 1 },
          update: { lastNumber: { increment: 1 } },
          create: { id: 1, lastNumber: 1 },
        }),
      { isolationLevel: 'Serializable' },
    );
    return `SM-FR-${String(sequence.lastNumber).padStart(6, '0')}`;
  }
}
