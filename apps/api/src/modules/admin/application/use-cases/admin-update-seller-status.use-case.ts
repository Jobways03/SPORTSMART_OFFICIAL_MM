import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, BadRequestAppException, ForbiddenAppException } from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';

// Allowed status transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING_APPROVAL: ['ACTIVE', 'DEACTIVATED'],
  ACTIVE: ['INACTIVE', 'SUSPENDED', 'DEACTIVATED'],
  INACTIVE: ['ACTIVE', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: ['ACTIVE'],
};

interface UpdateStatusInput {
  adminId: string;
  sellerId: string;
  status: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminUpdateSellerStatusUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminUpdateSellerStatusUseCase');
  }

  async execute(input: UpdateStatusInput) {
    const { adminId, sellerId, status, reason, ipAddress, userAgent } = input;

    const validStatuses = ['PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'DEACTIVATED'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestAppException(`Invalid status: ${status}`);
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, status: true, isDeleted: true },
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    if (seller.status === status) {
      throw new BadRequestAppException(`Seller is already ${status}`);
    }

    const allowed = ALLOWED_TRANSITIONS[seller.status] || [];
    if (!allowed.includes(status)) {
      throw new ForbiddenAppException(
        `Cannot transition from ${seller.status} to ${status}`,
      );
    }

    const updated = await this.prisma.seller.update({
      where: { id: sellerId },
      data: { status: status as any },
      select: { id: true, status: true },
    });

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: status === 'ACTIVE' ? 'SELLER_ENABLED' : 'SELLER_DISABLED',
      oldValue: { status: seller.status },
      newValue: { status },
      reason,
      ipAddress,
      userAgent,
    });

    this.logger.log(`Admin ${adminId} changed seller ${sellerId} status: ${seller.status} -> ${status}`);

    return { sellerId: updated.id, status: updated.status };
  }
}
