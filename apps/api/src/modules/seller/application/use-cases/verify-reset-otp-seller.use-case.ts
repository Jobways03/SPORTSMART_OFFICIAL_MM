import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';

interface VerifyResetOtpSellerInput {
  email: string;
  otp: string;
}

export interface VerifyResetOtpSellerResult {
  resetToken: string;
}

@Injectable()
export class VerifyResetOtpSellerUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifyResetOtpSellerUseCase');
  }

  async execute(input: VerifyResetOtpSellerInput): Promise<VerifyResetOtpSellerResult> {
    const { email, otp } = input;

    const seller = await this.prisma.seller.findUnique({ where: { email } });
    if (!seller) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Find latest unexpired, unused, unverified OTP
    const otpRecord = await this.prisma.sellerPasswordResetOtp.findFirst({
      where: {
        sellerId: seller.id,
        purpose: 'PASSWORD_RESET',
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Check max attempts
    if (otpRecord.attempts >= otpRecord.maxAttempts) {
      await this.prisma.sellerPasswordResetOtp.update({
        where: { id: otpRecord.id },
        data: { expiresAt: new Date() },
      });
      throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
    }

    // Increment attempts
    await this.prisma.sellerPasswordResetOtp.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });

    // Compare OTP hash
    const otpHash = createHash('sha256').update(otp).digest('hex');
    if (otpHash !== otpRecord.otpHash) {
      const remainingAttempts = otpRecord.maxAttempts - (otpRecord.attempts + 1);
      if (remainingAttempts <= 0) {
        await this.prisma.sellerPasswordResetOtp.update({
          where: { id: otpRecord.id },
          data: { expiresAt: new Date() },
        });
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP valid — generate reset token
    const resetToken = randomUUID();

    await this.prisma.sellerPasswordResetOtp.update({
      where: { id: otpRecord.id },
      data: {
        verifiedAt: new Date(),
        resetToken,
      },
    });

    this.logger.log(`Seller OTP verified for: ${seller.id}`);

    return { resetToken };
  }
}
