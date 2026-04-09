import { Injectable } from '@nestjs/common';
import { Seller, SellerSession, SellerPasswordResetOtp } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  SellerRepository,
  OtpWithSeller,
} from '../../domain/repositories/seller.repository.interface';

@Injectable()
export class PrismaSellerRepository implements SellerRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Auth / Seller CRUD ──────────────────────────────────────

  async findByEmail(email: string): Promise<Seller | null> {
    return this.prisma.seller.findUnique({ where: { email } });
  }

  async findByPhone(phoneNumber: string): Promise<Seller | null> {
    return this.prisma.seller.findUnique({ where: { phoneNumber } });
  }

  async findById(id: string): Promise<Seller | null> {
    return this.prisma.seller.findUnique({ where: { id } });
  }

  async findByIdSelect<T extends Record<string, boolean>>(
    id: string,
    select: T,
  ): Promise<Pick<Seller, Extract<keyof T, keyof Seller>> | null> {
    return this.prisma.seller.findUnique({ where: { id }, select }) as any;
  }

  async createSeller(data: {
    sellerName: string;
    sellerShopName: string;
    email: string;
    phoneNumber: string;
    passwordHash: string;
  }): Promise<Seller> {
    return this.prisma.seller.create({ data });
  }

  async updateSeller(
    id: string,
    data: Record<string, unknown>,
  ): Promise<Seller> {
    return this.prisma.seller.update({ where: { id }, data });
  }

  async updateSellerSelect<T extends Record<string, boolean>>(
    id: string,
    data: Record<string, unknown>,
    select: T,
  ): Promise<Pick<Seller, Extract<keyof T, keyof Seller>>> {
    return this.prisma.seller.update({ where: { id }, data, select }) as any;
  }

  // ── Session operations ──────────────────────────────────────

  async createSession(data: {
    sellerId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<SellerSession> {
    return this.prisma.sellerSession.create({ data });
  }

  async revokeAllSessions(sellerId: string): Promise<void> {
    await this.prisma.sellerSession.updateMany({
      where: { sellerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── OTP operations ──────────────────────────────────────────

  async findRecentOtp(params: {
    sellerId: string;
    purpose?: string;
    unusedOnly: boolean;
    createdAfter?: Date;
  }): Promise<SellerPasswordResetOtp | null> {
    const where: Record<string, unknown> = { sellerId: params.sellerId };
    if (params.purpose) where.purpose = params.purpose;
    if (params.unusedOnly) where.usedAt = null;
    if (params.createdAfter) where.createdAt = { gte: params.createdAfter };

    return this.prisma.sellerPasswordResetOtp.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOtpByResetToken(
    resetToken: string,
  ): Promise<OtpWithSeller | null> {
    return this.prisma.sellerPasswordResetOtp.findUnique({
      where: { resetToken },
      include: { seller: true },
    });
  }

  async findLatestValidOtp(
    sellerId: string,
    purpose?: string,
  ): Promise<SellerPasswordResetOtp | null> {
    const where: Record<string, unknown> = {
      sellerId,
      usedAt: null,
      verifiedAt: null,
      expiresAt: { gte: new Date() },
    };
    if (purpose) where.purpose = purpose;

    return this.prisma.sellerPasswordResetOtp.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async countOtpsSince(sellerId: string, since: Date): Promise<number> {
    return this.prisma.sellerPasswordResetOtp.count({
      where: { sellerId, createdAt: { gte: since } },
    });
  }

  async invalidateActiveOtps(
    sellerId: string,
    purpose?: string,
  ): Promise<void> {
    const where: Record<string, unknown> = {
      sellerId,
      usedAt: null,
      verifiedAt: null,
      expiresAt: { gte: new Date() },
    };
    if (purpose) where.purpose = purpose;

    await this.prisma.sellerPasswordResetOtp.updateMany({
      where,
      data: { expiresAt: new Date() },
    });
  }

  async createOtp(data: {
    sellerId: string;
    otpHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<SellerPasswordResetOtp> {
    return this.prisma.sellerPasswordResetOtp.create({ data });
  }

  async updateOtp(
    id: string,
    data: Record<string, unknown>,
  ): Promise<SellerPasswordResetOtp> {
    return this.prisma.sellerPasswordResetOtp.update({
      where: { id },
      data,
    });
  }

  async expireOtp(id: string): Promise<void> {
    await this.prisma.sellerPasswordResetOtp.update({
      where: { id },
      data: { expiresAt: new Date() },
    });
  }

  async incrementOtpAttempts(id: string): Promise<void> {
    await this.prisma.sellerPasswordResetOtp.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  // ── Transactional operations ────────────────────────────────

  async resetPasswordTransaction(params: {
    sellerId: string;
    otpId: string;
    passwordHash: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: params.sellerId },
        data: { passwordHash: params.passwordHash },
      });

      await tx.sellerPasswordResetOtp.update({
        where: { id: params.otpId },
        data: { usedAt: new Date() },
      });

      // Invalidate all other unexpired OTPs for this seller
      await tx.sellerPasswordResetOtp.updateMany({
        where: {
          sellerId: params.sellerId,
          id: { not: params.otpId },
          usedAt: null,
          expiresAt: { gte: new Date() },
        },
        data: { expiresAt: new Date() },
      });

      // Revoke all active sessions
      await tx.sellerSession.updateMany({
        where: { sellerId: params.sellerId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async changePasswordTransaction(params: {
    sellerId: string;
    passwordHash: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: params.sellerId },
        data: {
          passwordHash: params.passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });

      await tx.sellerSession.updateMany({
        where: { sellerId: params.sellerId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async verifyEmailTransaction(params: {
    sellerId: string;
    otpId: string;
  }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.sellerPasswordResetOtp.update({
        where: { id: params.otpId },
        data: { verifiedAt: new Date(), usedAt: new Date() },
      }),
      this.prisma.seller.update({
        where: { id: params.sellerId },
        data: { isEmailVerified: true },
      }),
    ]);
  }
}
