import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, BadRequestAppException } from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface ChangePasswordInput {
  adminId: string;
  sellerId: string;
  newPassword: string;
  ipAddress?: string;
  userAgent?: string;
}

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;

@Injectable()
export class AdminChangeSellerPasswordUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminChangeSellerPasswordUseCase');
  }

  async execute(input: ChangePasswordInput) {
    const { adminId, sellerId, newPassword, ipAddress, userAgent } = input;

    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestAppException('Password must be at least 8 characters');
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      throw new BadRequestAppException(
        'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character',
      );
    }

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      isDeleted: true,
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Update password and revoke all sessions
    await this.adminRepo.changeSellerPasswordAndRevokeSessions(sellerId, passwordHash);

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_PASSWORD_CHANGED',
      metadata: { sessionsRevoked: true },
      ipAddress,
      userAgent,
    });

    this.logger.log(`Admin ${adminId} changed password for seller ${sellerId}`);

    return { sellerId, passwordChanged: true, sessionsRevoked: true };
  }
}
