import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface ImpersonateInput {
  adminId: string;
  franchiseId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminImpersonateFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminImpersonateFranchiseUseCase');
  }

  async execute(input: ImpersonateInput) {
    const { adminId, franchiseId } = input;

    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    // Generate a short-lived franchise token (30 minutes)
    const accessToken = jwt.sign(
      {
        sub: franchise.id,
        email: franchise.email,
        roles: ['FRANCHISE'],
        sessionId: `impersonation-${adminId}`,
        impersonatedBy: adminId,
      },
      this.envService.getString('JWT_FRANCHISE_SECRET'),
      { expiresIn: 1800 },
    );

    this.logger.log(`Admin ${adminId} impersonating franchise ${franchiseId}`);

    return {
      accessToken,
      expiresIn: 1800,
      franchise: {
        franchiseId: franchise.id,
        franchiseCode: franchise.franchiseCode,
        ownerName: franchise.ownerName,
        businessName: franchise.businessName,
        email: franchise.email,
      },
    };
  }
}
