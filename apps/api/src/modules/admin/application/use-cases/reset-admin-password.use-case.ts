import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface ResetAdminPasswordInput {
  resetToken: string;
  newPassword: string;
}

@Injectable()
export class ResetAdminPasswordUseCase {
  private static readonly RESET_TOKEN_TTL_MINUTES = 15;

  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ResetAdminPasswordUseCase');
  }

  async execute(input: ResetAdminPasswordInput): Promise<void> {
    const { resetToken, newPassword } = input;

    if (!resetToken) {
      throw new BadRequestAppException('resetToken is required');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestAppException(
        'New password must be at least 8 characters long',
      );
    }

    const otpRecord = await this.adminRepo.findAdminOtpByResetToken(resetToken);
    if (!otpRecord) {
      throw new UnauthorizedAppException('Invalid or expired reset token');
    }

    if (otpRecord.usedAt) {
      throw new UnauthorizedAppException(
        'This reset token has already been used',
      );
    }

    if (!otpRecord.verifiedAt) {
      throw new UnauthorizedAppException('OTP has not been verified yet');
    }

    // Reset token TTL — calculated from the verifiedAt timestamp.
    const ttlMs =
      ResetAdminPasswordUseCase.RESET_TOKEN_TTL_MINUTES * 60 * 1000;
    if (otpRecord.verifiedAt.getTime() + ttlMs < Date.now()) {
      throw new UnauthorizedAppException(
        'Reset token has expired. Please request a new OTP.',
      );
    }

    if (!otpRecord.admin) {
      throw new UnauthorizedAppException('Admin account not found');
    }
    if (otpRecord.admin.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Admin account is not active');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.adminRepo.resetAdminPasswordTransaction({
      adminId: otpRecord.admin.id,
      passwordHash,
      otpId: otpRecord.id,
    });

    this.logger.log(`Admin password reset for: ${otpRecord.admin.id}`);
  }
}
