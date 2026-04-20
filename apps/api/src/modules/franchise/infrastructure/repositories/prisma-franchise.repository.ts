import { Injectable } from '@nestjs/common';
import {
  FranchisePartner,
  FranchiseSession,
  FranchisePasswordResetOtp,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
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
    return this.prisma.franchiseSession.create({ data });
  }

  async revokeAllSessions(franchisePartnerId: string): Promise<void> {
    await this.prisma.franchiseSession.updateMany({
      where: { franchisePartnerId, revokedAt: null },
      data: { revokedAt: new Date() },
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
    await this.prisma.$transaction([
      this.prisma.franchisePasswordResetOtp.update({
        where: { id: params.otpId },
        data: { verifiedAt: new Date(), usedAt: new Date() },
      }),
      this.prisma.franchisePartner.update({
        where: { id: params.franchisePartnerId },
        data: { isEmailVerified: true },
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
