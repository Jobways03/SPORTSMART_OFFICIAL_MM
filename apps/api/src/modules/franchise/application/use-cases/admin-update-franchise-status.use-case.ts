import { Injectable, Inject } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  NotFoundAppException,
  ForbiddenAppException,
  BadRequestAppException,
} from '../../../../core/exceptions';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['APPROVED', 'DEACTIVATED'],
  APPROVED: ['ACTIVE', 'DEACTIVATED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE'],
};

interface AdminUpdateFranchiseStatusInput {
  adminId: string;
  franchiseId: string;
  status: string;
  reason?: string;
}

@Injectable()
export class AdminUpdateFranchiseStatusUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('AdminUpdateFranchiseStatusUseCase');
  }

  async execute(input: AdminUpdateFranchiseStatusInput) {
    const { franchiseId, status, reason } = input;

    const franchise = await this.franchiseRepo.findById(franchiseId);

    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }

    const currentStatus = franchise.status;
    const allowedNextStatuses = ALLOWED_TRANSITIONS[currentStatus] || [];

    if (!allowedNextStatuses.includes(status)) {
      throw new ForbiddenAppException(
        `Cannot transition from ${currentStatus} to ${status}`,
      );
    }

    // Block deactivation/suspension when franchise has active orders
    if (['DEACTIVATED', 'SUSPENDED'].includes(status)) {
      const activeOrders = await this.prisma.subOrder.count({
        where: {
          franchiseId,
          fulfillmentNodeType: 'FRANCHISE',
          fulfillmentStatus: { in: ['UNFULFILLED', 'PACKED', 'SHIPPED'] },
          acceptStatus: { in: ['OPEN', 'ACCEPTED'] },
        },
      });
      if (activeOrders > 0) {
        throw new BadRequestAppException(
          `Cannot ${status.toLowerCase()} franchise — ${activeOrders} active order(s) still in progress`,
        );
      }
    }

    const updated = await this.franchiseRepo.updateFranchise(franchiseId, {
      status,
    });

    this.eventBus
      .publish({
        eventName: 'franchise.status_updated',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: {
          franchiseId,
          previousStatus: currentStatus,
          newStatus: status,
          reason: reason || null,
        },
      })
      .catch((err) => {
        this.logger.error(`Failed to publish franchise status update event: ${err}`);
      });

    this.logger.log(
      `Franchise status updated: ${franchiseId} from ${currentStatus} to ${status}`,
    );

    return {
      franchiseId: updated.id,
      status: updated.status,
    };
  }
}
