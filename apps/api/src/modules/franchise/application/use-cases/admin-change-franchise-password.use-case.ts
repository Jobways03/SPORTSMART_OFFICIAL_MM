import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, BadRequestAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface ChangePasswordInput {
  adminId: string;
  franchiseId: string;
  newPassword: string;
}

@Injectable()
export class AdminChangeFranchisePasswordUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminChangeFranchisePasswordUseCase');
  }

  async execute(input: ChangePasswordInput) {
    const { adminId, franchiseId, newPassword } = input;

    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestAppException('Password must be at least 8 characters');
    }

    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.franchiseRepo.changePasswordTransaction({
      franchisePartnerId: franchiseId,
      passwordHash,
    });

    this.logger.log(`Admin ${adminId} changed password for franchise ${franchiseId}`);

    return { franchiseId, passwordChanged: true };
  }
}
