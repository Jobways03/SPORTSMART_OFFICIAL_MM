import { Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { NotFoundAppException, ForbiddenAppException } from '../../../../core/exceptions';
import { AdminAuditService } from '../services/admin-audit.service';

interface ImpersonateInput {
  adminId: string;
  adminRole: string;
  sellerId: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminImpersonateSellerUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminImpersonateSellerUseCase');
  }

  async execute(input: ImpersonateInput) {
    const { adminId, adminRole, sellerId, ipAddress, userAgent } = input;

    // Only SUPER_ADMIN and SELLER_ADMIN can impersonate
    if (!['SUPER_ADMIN', 'SELLER_ADMIN'].includes(adminRole)) {
      throw new ForbiddenAppException('You do not have permission to impersonate sellers');
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, email: true, sellerName: true, sellerShopName: true, phoneNumber: true, status: true, isDeleted: true },
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }

    // Generate a short-lived seller token (30 minutes)
    const accessToken = jwt.sign(
      {
        sub: seller.id,
        email: seller.email,
        roles: ['SELLER'],
        sessionId: `impersonation-${adminId}`,
        impersonatedBy: adminId,
      },
      this.envService.getString('JWT_ACCESS_SECRET'),
      { expiresIn: 1800 }, // 30 minutes
    );

    // Log impersonation
    const impersonationLog = await this.prisma.adminImpersonationLog.create({
      data: {
        adminId,
        sellerId,
        tokenId: `impersonation-${adminId}`,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_IMPERSONATED',
      metadata: { impersonationLogId: impersonationLog.id },
      ipAddress,
      userAgent,
    });

    this.logger.log(`Admin ${adminId} impersonating seller ${sellerId}`);

    return {
      accessToken,
      expiresIn: 1800,
      seller: {
        sellerId: seller.id,
        sellerName: seller.sellerName,
        sellerShopName: seller.sellerShopName,
        email: seller.email,
        phoneNumber: seller.phoneNumber,
      },
    };
  }
}
