import { Injectable } from '@nestjs/common';
import { Seller, SellerSession, SellerPasswordResetOtp } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { hashRefreshToken } from '../../../../core/auth/refresh-token';
import {
  SellerRepository,
  OtpWithSeller,
} from '../../domain/repositories/seller.repository.interface';

@Injectable()
export class PrismaSellerRepository implements SellerRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Auth / Seller CRUD ──────────────────────────────────────
  //
  // All seller lookups exclude soft-deleted rows. A reused email or phone
  // after a soft-delete must NOT return the deleted seller — that would
  // both leak the old account's data and cause unique-constraint headaches.

  async findByEmail(email: string): Promise<Seller | null> {
    return this.prisma.seller.findFirst({
      where: { email, isDeleted: false },
    });
  }

  async findByPhone(phoneNumber: string): Promise<Seller | null> {
    return this.prisma.seller.findFirst({
      where: { phoneNumber, isDeleted: false },
    });
  }

  /**
   * Phase 19 (2026-05-20) — duplicate GSTIN pre-check for onboarding.
   * Excludes soft-deleted rows so a deleted seller's old GSTIN can be
   * re-claimed. Returns only the `id` — the caller's only decision is
   * "is this someone else's row?" so a wider select is wasted IO.
   */
  async findByGstin(gstin: string): Promise<{ id: string } | null> {
    return this.prisma.seller.findFirst({
      where: { gstin, isDeleted: false },
      select: { id: true },
    });
  }

  async findByPanNumber(panNumber: string): Promise<{ id: string } | null> {
    return this.prisma.seller.findFirst({
      where: { panNumber, isDeleted: false },
      select: { id: true },
    });
  }

  async findById(id: string): Promise<Seller | null> {
    return this.prisma.seller.findFirst({
      where: { id, isDeleted: false },
    });
  }

  async findByIdSelect<T extends Record<string, boolean>>(
    id: string,
    select: T,
  ): Promise<Pick<Seller, Extract<keyof T, keyof Seller>> | null> {
    return this.prisma.seller.findFirst({
      where: { id, isDeleted: false },
      select,
    }) as any;
  }

  async createSeller(data: {
    sellerName: string;
    sellerShopName: string;
    email: string;
    phoneNumber: string;
    passwordHash: string;
    sellerType?: 'D2C' | 'RETAIL';
  }): Promise<Seller> {
    return this.prisma.seller.create({ data: data as any });
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
    // Phase 3 (PR 3.2) — store SHA-256 of the refresh token. Raw token
    // is returned to the caller via the response body once at issue
    // time and never persisted.
    return this.prisma.sellerSession.create({
      data: { ...data, refreshToken: hashRefreshToken(data.refreshToken) },
    });
  }

  async revokeAllSessions(sellerId: string): Promise<void> {
    await this.prisma.sellerSession.updateMany({
      where: { sellerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.sellerSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async findSessionByRefreshToken(rawToken: string): Promise<{
    id: string;
    sellerId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
  } | null> {
    return this.prisma.sellerSession.findFirst({
      where: { refreshToken: hashRefreshToken(rawToken) },
      select: {
        id: true,
        sellerId: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Phase 1 / C6 — secondary lookup on the burned-hash slot. Hit
   * indicates the caller presented a token that was already rotated
   * out — i.e. the legitimate client has already exchanged it, and
   * what's arriving now is a stolen-token replay.
   */
  async findSessionByPreviousRefreshToken(rawToken: string): Promise<{
    id: string;
    sellerId: string;
  } | null> {
    return this.prisma.sellerSession.findFirst({
      where: { previousRefreshTokenHash: hashRefreshToken(rawToken) } as any,
      select: { id: true, sellerId: true },
    });
  }

  async rotateSession(
    sessionId: string,
    newRawRefreshToken: string,
    newExpiresAt: Date,
  ): Promise<void> {
    // Phase 1 / C6 — stash the burned hash so a future request
    // presenting the just-rotated token is recognisable as theft.
    const current = await this.prisma.sellerSession.findUnique({
      where: { id: sessionId },
      select: { refreshToken: true },
    });
    await this.prisma.sellerSession.update({
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

  /**
   * Phase 18 (2026-05-20) — atomic CAS attempt increment. The WHERE
   * clause asserts "still active AND below cap" inside the same
   * UPDATE statement so two parallel verify requests cannot both
   * pass the eligibility check. `updateMany` returns `count` so the
   * caller can tell whether the row was eligible; a follow-up
   * findUnique fetches the post-increment attempts value.
   */
  async incrementOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }> {
    const res = await this.prisma.sellerPasswordResetOtp.updateMany({
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
    const after = await this.prisma.sellerPasswordResetOtp.findUnique({
      where: { id: otpId },
      select: { attempts: true },
    });
    return { ok: true, attempts: after?.attempts ?? 0 };
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
    // Phase 18 (2026-05-20) — same now() across both writes so the
    // boolean flip and the timestamp stamp always agree to the ms.
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.sellerPasswordResetOtp.update({
        where: { id: params.otpId },
        data: { verifiedAt: now, usedAt: now },
      }),
      this.prisma.seller.update({
        where: { id: params.sellerId },
        data: {
          isEmailVerified: true,
          emailVerifiedAt: now,
        },
      }),
    ]);
  }
}
