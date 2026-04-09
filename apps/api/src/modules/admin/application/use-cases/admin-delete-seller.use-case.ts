import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, BadRequestAppException } from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface DeleteSellerInput {
  adminId: string;
  adminRole: string;
  sellerId: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminDeleteSellerUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminDeleteSellerUseCase');
  }

  async execute(input: DeleteSellerInput) {
    const { adminId, adminRole, sellerId, reason, ipAddress, userAgent } = input;

    // Only SUPER_ADMIN and SELLER_ADMIN can delete
    if (!['SUPER_ADMIN', 'SELLER_ADMIN'].includes(adminRole)) {
      throw new BadRequestAppException('You do not have permission to delete sellers');
    }

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      sellerName: true,
      sellerShopName: true,
      email: true,
      status: true,
      isDeleted: true,
    });

    if (!seller) {
      throw new NotFoundAppException('Seller not found');
    }

    if (seller.isDeleted) {
      throw new BadRequestAppException('Seller is already deleted');
    }

    // Soft delete: mark as deleted, disable login, revoke sessions
    await this.adminRepo.softDeleteSellerAndRevokeSessions(sellerId);

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_DELETED',
      oldValue: {
        sellerName: seller.sellerName,
        sellerShopName: seller.sellerShopName,
        email: seller.email,
        status: seller.status,
      },
      reason,
      ipAddress,
      userAgent,
    });

    this.logger.log(`Admin ${adminId} soft-deleted seller ${sellerId}`);

    return { sellerId, deleted: true };
  }
}
