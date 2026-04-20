import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface ChangePasswordInput {
  franchiseId: string;
  currentPassword: string;
  newPassword: string;
}

@Injectable()
export class ChangePasswordFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ChangePasswordFranchiseUseCase');
  }

  async execute(input: ChangePasswordInput): Promise<void> {
    const { franchiseId, currentPassword, newPassword } = input;

    if (currentPassword === newPassword) {
      throw new BadRequestAppException(
        'New password must be different from the current password',
      );
    }

    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise) {
      throw new NotFoundAppException('Franchise not found');
    }

    const currentMatches = await bcrypt.compare(
      currentPassword,
      franchise.passwordHash,
    );
    if (!currentMatches) {
      throw new UnauthorizedAppException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.franchiseRepo.updateFranchise(franchiseId, { passwordHash });

    this.eventBus
      .publish({
        eventName: 'franchise.password_changed',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: { franchiseId },
      })
      .catch(() => {});

    this.logger.log(`Franchise password changed: ${franchiseId}`);
  }
}
