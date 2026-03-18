import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';

interface VerifyResetOtpInput {
  email: string;
  otp: string;
}

export interface VerifyResetOtpResult {
  resetToken: string;
}

@Injectable()
export class VerifyResetOtpUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('VerifyResetOtpUseCase');
  }

  async execute(input: VerifyResetOtpInput): Promise<VerifyResetOtpResult> {
    const { email, otp } = input;

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedAppException('Invalid or expired OTP');
    }

    // Find the latest unexpired, unused OTP for this user
    const otpRecord = await this.prisma.passwordResetOtp.findFirst({
      where: {
        userId: user.id,
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
      // Expire this OTP
      await this.prisma.passwordResetOtp.update({
        where: { id: otpRecord.id },
        data: { expiresAt: new Date() },
      });
      throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
    }

    // Increment attempts
    await this.prisma.passwordResetOtp.update({
      where: { id: otpRecord.id },
      data: { attempts: { increment: 1 } },
    });

    // Compare OTP hash
    const otpHash = createHash('sha256').update(otp).digest('hex');
    if (otpHash !== otpRecord.otpHash) {
      const remainingAttempts = otpRecord.maxAttempts - (otpRecord.attempts + 1);
      if (remainingAttempts <= 0) {
        // Expire after last failed attempt
        await this.prisma.passwordResetOtp.update({
          where: { id: otpRecord.id },
          data: { expiresAt: new Date() },
        });
        throw new UnauthorizedAppException('Too many failed attempts. Please request a new OTP.');
      }
      throw new UnauthorizedAppException(`Invalid OTP. ${remainingAttempts} attempt(s) remaining.`);
    }

    // OTP is valid — generate reset token
    const resetToken = randomUUID();

    await this.prisma.passwordResetOtp.update({
      where: { id: otpRecord.id },
      data: {
        verifiedAt: new Date(),
        resetToken,
      },
    });

    this.logger.log(`OTP verified for user: ${user.id}`);

    return { resetToken };
  }
}
