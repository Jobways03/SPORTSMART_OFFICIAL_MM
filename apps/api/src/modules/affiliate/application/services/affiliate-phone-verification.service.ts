import { Injectable } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../../../integrations/email/adapters/email-otp.adapter';
import { WhatsAppAdapter } from '../../../../integrations/whatsapp/adapters/whatsapp.adapter';
import { WhatsAppClient } from '../../../../integrations/whatsapp/clients/whatsapp.client';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';

/**
 * Phone verification for the authenticated affiliate.
 *
 * Flow:
 *   1. sendOtp(affiliateId, phoneCandidate?)  → emails / WhatsApps a 6-digit code.
 *      - If `phoneCandidate` is omitted, verifies the affiliate's current `phone` field.
 *      - If supplied, checks uniqueness against other affiliates first; the candidate
 *        is stored on the OTP row so verify-time can atomically swap it in.
 *   2. verifyOtp(affiliateId, otp)            → marks the affiliate `phoneVerified=true`
 *      and (if a candidate was used) atomically replaces the phone.
 *
 * Delivery: prefers WhatsApp when configured (WHATSAPP_API_TOKEN +
 * PHONE_NUMBER_ID env vars set), falls back to email via the
 * affiliate's verified email address. The fallback exists so dev
 * environments without WhatsApp credentials can still complete the
 * flow — the affiliate's email is already known-good (they used it
 * to log in).
 */
@Injectable()
export class AffiliatePhoneVerificationService {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;
  private static readonly MAX_PER_HOUR = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
    private readonly whatsapp: WhatsAppAdapter,
    private readonly whatsappClient: WhatsAppClient,
    private readonly emailOtp: EmailOtpAdapter,
  ) {
    this.logger.setContext('AffiliatePhoneVerificationService');
  }

  async sendOtp(affiliateId: string, phoneCandidate?: string): Promise<{ phone: string }> {
    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: affiliateId },
      select: { id: true, email: true, phone: true, phoneVerified: true },
    });
    if (!affiliate) throw new NotFoundAppException('Affiliate not found');

    const phone = (phoneCandidate ?? affiliate.phone ?? '').trim();
    if (!phone) {
      throw new BadRequestAppException(
        'No phone number on file. Add one via your profile, then try again.',
      );
    }

    // Already verified for the same number? No-op so callers can
    // be idempotent without checking phoneVerified themselves.
    if (affiliate.phoneVerified && phone === affiliate.phone) {
      return { phone };
    }

    if (phone !== affiliate.phone) {
      const taken = await this.prisma.affiliate.findFirst({
        where: { phone, id: { not: affiliateId } },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictAppException(
          'That phone number is already registered to another affiliate.',
        );
      }
    }

    // Cooldown — same as the password reset flow.
    const cooldownStart = new Date(
      Date.now() - AffiliatePhoneVerificationService.COOLDOWN_SECONDS * 1000,
    );
    const recent = await this.prisma.affiliatePhoneVerificationOtp.findFirst({
      where: { affiliateId, createdAt: { gte: cooldownStart } },
    });
    if (recent) {
      throw new BadRequestAppException(
        'Please wait a moment before requesting another OTP.',
      );
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.affiliatePhoneVerificationOtp.count({
      where: { affiliateId, createdAt: { gte: oneHourAgo } },
    });
    if (recentCount >= AffiliatePhoneVerificationService.MAX_PER_HOUR) {
      throw new BadRequestAppException(
        'Too many OTP requests in the last hour. Please try again later.',
      );
    }

    // Invalidate any active OTPs (different candidate phone counts as superseded).
    await this.prisma.affiliatePhoneVerificationOtp.updateMany({
      where: { affiliateId, verifiedAt: null },
      data: { expiresAt: new Date() },
    });

    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.prisma.affiliatePhoneVerificationOtp.create({
      data: {
        affiliateId,
        phoneCandidate: phone,
        otpHash,
        expiresAt: new Date(
          Date.now() + AffiliatePhoneVerificationService.OTP_EXPIRY_MINUTES * 60 * 1000,
        ),
      },
    });

    await this.deliver(phone, affiliate.email, otp);
    this.logger.log(`Phone-verification OTP sent for affiliate ${affiliateId}`);
    return { phone };
  }

  async verifyOtp(affiliateId: string, otp: string): Promise<void> {
    const record = await this.prisma.affiliatePhoneVerificationOtp.findFirst({
      where: {
        affiliateId,
        verifiedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new UnauthorizedAppException('Invalid or expired OTP');

    if (record.attempts >= record.maxAttempts) {
      await this.prisma.affiliatePhoneVerificationOtp.update({
        where: { id: record.id },
        data: { expiresAt: new Date() },
      });
      throw new UnauthorizedAppException(
        'Too many failed attempts. Please request a new OTP.',
      );
    }

    await this.prisma.affiliatePhoneVerificationOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });

    const submitted = Buffer.from(createHash('sha256').update(otp).digest('hex'), 'utf8');
    const expected = Buffer.from(record.otpHash, 'utf8');
    const isMatch = submitted.length === expected.length && timingSafeEqual(submitted, expected);
    if (!isMatch) {
      const remaining = record.maxAttempts - (record.attempts + 1);
      if (remaining <= 0) {
        await this.prisma.affiliatePhoneVerificationOtp.update({
          where: { id: record.id },
          data: { expiresAt: new Date() },
        });
        throw new UnauthorizedAppException(
          'Too many failed attempts. Please request a new OTP.',
        );
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remaining} attempt(s) remaining.`);
    }

    // Atomic: mark OTP used, update affiliate's phone (if it was a candidate)
    // and flip phoneVerified=true.
    await this.prisma.$transaction([
      this.prisma.affiliatePhoneVerificationOtp.update({
        where: { id: record.id },
        data: { verifiedAt: new Date() },
      }),
      this.prisma.affiliate.update({
        where: { id: affiliateId },
        data: {
          phone: record.phoneCandidate,
          phoneVerified: true,
          phoneVerifiedAt: new Date(),
        },
      }),
    ]);

    this.logger.log(`Phone verified for affiliate ${affiliateId}`);
  }

  // ── delivery ──────────────────────────────────────────────────

  private async deliver(phone: string, email: string, otp: string): Promise<void> {
    if (this.whatsappClient.isConfigured) {
      await this.whatsapp.sendOtp(phone, otp);
      return;
    }
    // Fallback: dev environments without WhatsApp credentials. The
    // affiliate's email is already verified, so we ship the OTP there
    // and prefix the subject so they understand it's a phone-verify.
    this.logger.warn(
      'WhatsApp not configured — sending phone-verification OTP via email fallback.',
    );
    await this.emailOtp.sendOtp(email, otp);
  }
}
