import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EmailOtpAdapter } from '../../infrastructure/adapters/email-otp.adapter';

interface ResendResetOtpInput {
  email: string;
}

@Injectable()
export class ResendResetOtpUseCase {
  private static readonly OTP_EXPIRY_MINUTES = 10;
  private static readonly COOLDOWN_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailOtp: EmailOtpAdapter,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResendResetOtpUseCase');
  }

  async execute(input: ResendResetOtpInput): Promise<void> {
    const { email } = input;

    // Always return success to prevent email enumeration
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.status !== 'ACTIVE') {
      await this.simulateDelay();
      return;
    }

    // Check cooldown
    const recentOtp = await this.prisma.passwordResetOtp.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        createdAt: {
          gte: new Date(Date.now() - ResendResetOtpUseCase.COOLDOWN_SECONDS * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      return;
    }

    // Invalidate existing OTPs
    await this.prisma.passwordResetOtp.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { expiresAt: new Date() },
    });

    // Generate new OTP
    const otp = String(randomInt(100000, 999999));
    const otpHash = createHash('sha256').update(otp).digest('hex');

    await this.prisma.passwordResetOtp.create({
      data: {
        userId: user.id,
        otpHash,
        expiresAt: new Date(Date.now() + ResendResetOtpUseCase.OTP_EXPIRY_MINUTES * 60 * 1000),
      },
    });

    await this.emailOtp.sendOtp(email, otp);

    this.logger.log(`Password reset OTP resent for user: ${user.id}`);
  }

  private simulateDelay(): Promise<void> {
    const delay = 100 + Math.random() * 200;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
