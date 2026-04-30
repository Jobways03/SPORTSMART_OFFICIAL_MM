import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import { UnauthorizedAppException } from '../../../../core/exceptions';

/**
 * Password reset for affiliates — mirrors the seller / franchise OTP flow.
 *
 * Flow:
 *   1. forgotPassword(email)        → emails a 6-digit OTP (silently no-ops on
 *                                     unknown email, prevents account enumeration)
 *   2. verifyOtp(email, otp)        → on success returns a UUID resetToken
 *   3. resendOtp(email)             → invalidates the active OTP and emails a fresh one
 *   4. resetPassword(resetToken, …) → swaps the password hash atomically
 *
 * Affiliates use a single-JWT (no sessions table), so we don't revoke sessions
 * on reset — the existing tokens age out naturally on their 24 h TTL. The brute-
 * force lock counters (failedLoginAttempts / lockUntil) ARE cleared so the
 * affiliate isn't locked out after a successful reset.
 */
@Injectable()
export class AffiliatePasswordResetService {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;
  private static readonly MAX_RESENDS_PER_HOUR = 5;
  private static readonly RESET_TOKEN_TTL_MINUTES = 15;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AffiliatePasswordResetService');
  }

  // ── public API ────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const affiliate = await this.findEligibleByEmail(email);
    if (!affiliate) {
      // Constant-ish delay so unknown-email and rate-limited paths are
      // indistinguishable from the outside.
      await this.simulateDelay();
      return;
    }

    if (await this.isWithinCooldown(affiliate.id)) return;

    await this.prisma.affiliatePasswordResetOtp.updateMany({
      where: { affiliateId: affiliate.id, verifiedAt: null, usedAt: null },
      data: { expiresAt: new Date() }, // expire immediately
    });

    const otp = String(randomInt(100000, 999999));
    await this.persistAndEmail(affiliate.id, email, otp);
    this.logger.log(`Affiliate password reset OTP sent for: ${affiliate.id}`);
  }

  async resendOtp(email: string): Promise<void> {
    const affiliate = await this.findEligibleByEmail(email);
    if (!affiliate) {
      await this.simulateDelay();
      return;
    }

    if (await this.isWithinCooldown(affiliate.id)) return;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.affiliatePasswordResetOtp.count({
      where: { affiliateId: affiliate.id, createdAt: { gte: oneHourAgo } },
    });
    if (recentCount >= AffiliatePasswordResetService.MAX_RESENDS_PER_HOUR) return;

    await this.prisma.affiliatePasswordResetOtp.updateMany({
      where: { affiliateId: affiliate.id, verifiedAt: null, usedAt: null },
      data: { expiresAt: new Date() },
    });

    const otp = String(randomInt(100000, 999999));
    await this.persistAndEmail(affiliate.id, email, otp);
    this.logger.log(`Affiliate password reset OTP resent for: ${affiliate.id}`);
  }

  async verifyOtp(email: string, otp: string): Promise<{ resetToken: string }> {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!affiliate) throw new UnauthorizedAppException('Invalid or expired OTP');

    const record = await this.prisma.affiliatePasswordResetOtp.findFirst({
      where: {
        affiliateId: affiliate.id,
        purpose: 'PASSWORD_RESET',
        verifiedAt: null,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new UnauthorizedAppException('Invalid or expired OTP');

    if (record.attempts >= record.maxAttempts) {
      await this.prisma.affiliatePasswordResetOtp.update({
        where: { id: record.id },
        data: { expiresAt: new Date() },
      });
      throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
    }

    await this.prisma.affiliatePasswordResetOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });

    // Constant-time compare (don't leak match-length info via early return).
    const submitted = Buffer.from(createHash('sha256').update(otp).digest('hex'), 'utf8');
    const expected = Buffer.from(record.otpHash, 'utf8');
    const isMatch = submitted.length === expected.length && timingSafeEqual(submitted, expected);

    if (!isMatch) {
      const remaining = record.maxAttempts - (record.attempts + 1);
      if (remaining <= 0) {
        await this.prisma.affiliatePasswordResetOtp.update({
          where: { id: record.id },
          data: { expiresAt: new Date() },
        });
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remaining} attempt(s) remaining.`);
    }

    const resetToken = randomUUID();
    await this.prisma.affiliatePasswordResetOtp.update({
      where: { id: record.id },
      data: { verifiedAt: new Date(), resetToken },
    });

    this.logger.log(`Affiliate OTP verified for: ${affiliate.id}`);
    return { resetToken };
  }

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    const record = await this.prisma.affiliatePasswordResetOtp.findUnique({
      where: { resetToken },
    });
    if (!record || !record.verifiedAt) {
      throw new UnauthorizedAppException('Invalid or expired reset token');
    }
    if (record.usedAt) {
      throw new UnauthorizedAppException('This reset token has already been used');
    }

    const tokenAgeMs = Date.now() - record.verifiedAt.getTime();
    if (tokenAgeMs > AffiliatePasswordResetService.RESET_TOKEN_TTL_MINUTES * 60 * 1000) {
      throw new UnauthorizedAppException('Reset token has expired. Please start over.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction([
      this.prisma.affiliate.update({
        where: { id: record.affiliateId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      }),
      this.prisma.affiliatePasswordResetOtp.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Belt-and-braces: invalidate any other unused OTPs for this affiliate.
      this.prisma.affiliatePasswordResetOtp.updateMany({
        where: {
          affiliateId: record.affiliateId,
          id: { not: record.id },
          verifiedAt: null,
          usedAt: null,
        },
        data: { expiresAt: new Date() },
      }),
    ]);

    this.logger.log(`Affiliate password reset completed for: ${record.affiliateId}`);
  }

  // ── helpers ───────────────────────────────────────────────────

  /** Returns the affiliate iff they're allowed to reset (not REJECTED/SUSPENDED). */
  private async findEligibleByEmail(email: string) {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, status: true },
    });
    if (!affiliate) return null;
    if (affiliate.status === 'REJECTED' || affiliate.status === 'SUSPENDED') return null;
    return affiliate;
  }

  private async isWithinCooldown(affiliateId: string): Promise<boolean> {
    const cooldownStart = new Date(
      Date.now() - AffiliatePasswordResetService.COOLDOWN_SECONDS * 1000,
    );
    const recent = await this.prisma.affiliatePasswordResetOtp.findFirst({
      where: {
        affiliateId,
        usedAt: null,
        createdAt: { gte: cooldownStart },
      },
    });
    return !!recent;
  }

  private async persistAndEmail(affiliateId: string, email: string, otp: string): Promise<void> {
    const otpHash = createHash('sha256').update(otp).digest('hex');
    await this.prisma.affiliatePasswordResetOtp.create({
      data: {
        affiliateId,
        otpHash,
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(
          Date.now() + AffiliatePasswordResetService.OTP_EXPIRY_MINUTES * 60 * 1000,
        ),
      },
    });
    await this.emailOtp.sendOtp(email, otp);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
