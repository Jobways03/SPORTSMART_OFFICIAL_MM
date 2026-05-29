import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import {
  AdminAuthGuard,
  PermissionsGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { ApproveSellerUseCase } from '../../application/use-cases/approve-seller.use-case';
import { ApproveSellerDto } from '../dtos/approve-seller.dto';

/**
 * Admin endpoint for approving a seller's onboarding submission.
 * Sits under /admin/sellers/:sellerId/approve and requires the
 * `sellers.approve` permission (granted to SUPER_ADMIN + SELLER_ADMIN
 * by default).
 */
@ApiTags('Admin Sellers')
@Controller('admin/sellers')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class ApproveSellerController {
  constructor(private readonly approveSellerUseCase: ApproveSellerUseCase) {}

  @Post(':sellerId/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.approve')
  async approve(
    @Param('sellerId') sellerId: string,
    @Body() dto: ApproveSellerDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    if (!adminId) {
      throw new Error('Admin session not found on request');
    }

    const userAgentHeader = req.headers['user-agent'];
    const data = await this.approveSellerUseCase.execute({
      sellerId,
      adminId,
      notes: dto.notes,
      ipAddress: ip || req.socket.remoteAddress || undefined,
      userAgent:
        typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
    });

    return {
      success: true,
      message: 'Seller approved and activated',
      data,
    };
  }
}
