import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface DeleteFranchiseInput {
  adminId: string;
  franchiseId: string;
  reason?: string;
}

@Injectable()
export class AdminDeleteFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminDeleteFranchiseUseCase');
  }

  async execute(input: DeleteFranchiseInput) {
    const { adminId, franchiseId, reason } = input;

    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    // Soft delete
    await this.franchiseRepo.updateFranchise(franchiseId, {
      isDeleted: true,
      deletedAt: new Date(),
      status: 'DEACTIVATED',
    });

    // Revoke all sessions
    await this.franchiseRepo.revokeAllSessions(franchiseId);

    this.logger.log(
      `Admin ${adminId} deleted franchise ${franchiseId}. Reason: ${reason || 'N/A'}`,
    );

    return { franchiseId, deleted: true };
  }
}
