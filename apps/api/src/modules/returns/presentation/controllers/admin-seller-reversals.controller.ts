import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { SellerReversalService } from '../../application/services/seller-reversal.service';
import { RejectSellerReversalDto } from '../dtos/reject-seller-reversal.dto';

/**
 * Admin approval queue for seller B2B / off-platform reversals (Phase 108).
 * Approval applies all financial + inventory effects atomically; rejection
 * applies none. Gated by the dedicated `sellerReversals.*` permissions.
 */
@ApiTags('Admin Seller Reversals')
@Controller('admin/seller-reversals')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminSellerReversalsController {
  constructor(private readonly service: SellerReversalService) {}

  @Get()
  @Permissions('sellerReversals.read')
  async list(
    @Query('status') status?: string,
    @Query('sellerId') sellerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.list({
      status,
      sellerId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, message: 'Seller reversals retrieved', data };
  }

  @Get(':id')
  @Permissions('sellerReversals.read')
  async getOne(@Param('id') id: string) {
    const data = await this.service.getForAdmin(id);
    return { success: true, message: 'Seller reversal retrieved', data };
  }

  @Patch(':id/approve')
  @Permissions('sellerReversals.approve')
  @Idempotent()
  async approve(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.approve({
      reversalId: id,
      adminId: req.adminId,
      adminRole: req.adminRole,
    });
    return { success: true, message: 'Reversal approved', data };
  }

  @Patch(':id/reject')
  @Permissions('sellerReversals.approve')
  @Idempotent()
  async reject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: RejectSellerReversalDto,
  ) {
    const data = await this.service.reject({
      reversalId: id,
      adminId: req.adminId,
      adminRole: req.adminRole,
      rejectionReason: body.rejectionReason,
    });
    return { success: true, message: 'Reversal rejected', data };
  }
}
