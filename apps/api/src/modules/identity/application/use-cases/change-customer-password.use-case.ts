import { Injectable, Inject } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  USER_REPOSITORY,
  UserRepository,
} from '../../domain/repositories/user.repository';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

interface ChangeCustomerPasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

@Injectable()
export class ChangeCustomerPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ChangeCustomerPasswordUseCase');
  }

  async execute(input: ChangeCustomerPasswordInput): Promise<void> {
    const { userId, currentPassword, newPassword, confirmPassword } = input;

    if (!currentPassword || !newPassword) {
      throw new BadRequestAppException(
        'currentPassword and newPassword are required',
      );
    }

    if (newPassword !== confirmPassword) {
      throw new BadRequestAppException(
        'New password and confirm password do not match',
      );
    }

    if (newPassword.length < 8) {
      throw new BadRequestAppException(
        'New password must be at least 8 characters long',
      );
    }

    const user = await this.userRepo.findCustomerProfileWithPassword(userId);
    if (!user) {
      throw new UnauthorizedAppException('Account not found');
    }

    // OAuth-only account ("Sign in with Google"): no password is set, so
    // there is no current password to verify and nothing to "change".
    // Guard before bcrypt.compare — comparing against a null hash throws
    // "Illegal arguments" (a 500). Surface a clear 400 instead.
    if (!user.passwordHash) {
      // Default 'BAD_REQUEST' code → 400 (the global filter maps unknown
      // codes to 500, so we do not invent a new one here).
      throw new BadRequestAppException(
        'This account signs in with Google and has no password to change.',
      );
    }

    const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      throw new BadRequestAppException('Current password is incorrect');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new BadRequestAppException(
        'New password must be different from current password',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.changePasswordAndRevokeSessions(userId, passwordHash);

    this.logger.log(`Customer password changed: ${userId}`);
  }
}
