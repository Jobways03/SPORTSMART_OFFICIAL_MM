import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, BadRequestAppException } from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

const VALID_VERIFICATION_STATUSES = ['NOT_VERIFIED', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW'];

interface UpdateVerificationInput {
  adminId: string;
  sellerId: string;
  verificationStatus: string;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminUpdateSellerVerificationUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminUpdateSellerVerificationUseCase');
  }

  async execute(input: UpdateVerificationInput) {
    const { adminId, sellerId, verificationStatus, reason, ipAddress, userAgent } = input;

    if (!VALID_VERIFICATION_STATUSES.includes(verificationStatus)) {
      throw new BadRequestAppException(`Invalid verification status: ${verificationStatus}`);
    }

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      verificationStatus: true,
      isDeleted: true,
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    if (seller.verificationStatus === verificationStatus) {
      throw new BadRequestAppException(`Seller verification is already ${verificationStatus}`);
    }

    const updated = await this.adminRepo.updateSeller(
      sellerId,
      { verificationStatus: verificationStatus as any },
      { id: true, verificationStatus: true },
    );

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_VERIFICATION_UPDATED',
      oldValue: { verificationStatus: seller.verificationStatus },
      newValue: { verificationStatus },
      reason,
      ipAddress,
      userAgent,
    });

    this.logger.log(`Admin ${adminId} updated seller ${sellerId} verification: ${seller.verificationStatus} -> ${verificationStatus}`);

    return { sellerId: updated.id, verificationStatus: updated.verificationStatus };
  }
}
