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
import { RejectSellerUseCase } from '../../application/use-cases/reject-seller.use-case';
import { RejectSellerDto } from '../dtos/reject-seller.dto';

/**
 * Admin endpoint for rejecting a seller's onboarding submission.
 * Sits under /admin/sellers/:sellerId/reject. The reason is captured
 * in the request body, surfaced to the seller, and recorded in the
 * audit trail via the seller.rejected event.
 */
@ApiTags('Admin Sellers')
@Controller('admin/sellers')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class RejectSellerController {
  constructor(private readonly rejectSellerUseCase: RejectSellerUseCase) {}

  @Post(':sellerId/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('sellers.approve')
  async reject(
    @Param('sellerId') sellerId: string,
    @Body() dto: RejectSellerDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    const adminId = (req as unknown as { adminId?: string }).adminId;
    if (!adminId) {
      throw new Error('Admin session not found on request');
    }

    const userAgentHeader = req.headers['user-agent'];
    const data = await this.rejectSellerUseCase.execute({
      sellerId,
      adminId,
      reason: dto.reason,
      ipAddress: ip || req.socket.remoteAddress || undefined,
      userAgent:
        typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
    });

    return {
      success: true,
      message: 'Seller onboarding rejected. The seller can re-submit after fixing the issue.',
      data,
    };
  }
}
