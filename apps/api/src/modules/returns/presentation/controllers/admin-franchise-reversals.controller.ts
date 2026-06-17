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
import { FranchiseReversalService } from '../../application/services/franchise-reversal.service';
import { RejectFranchiseReversalDto } from '../dtos/reject-franchise-reversal.dto';

/**
 * Admin approval queue for franchise B2B / off-platform reversals — mirror of
 * the seller admin controller. Approval applies the franchise inventory restock
 * + finance-ledger reversal; rejection applies none.
 *
 * Reuses the existing `sellerReversals.*` permissions (an admin who manages
 * off-platform reversals manages both node types). A dedicated
 * `franchiseReversals.*` permission can be split out later if needed.
 */
@ApiTags('Admin Franchise Reversals')
@Controller('admin/franchise-reversals')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminFranchiseReversalsController {
  constructor(private readonly service: FranchiseReversalService) {}

  @Get()
  @Permissions('sellerReversals.read')
  async list(
    @Query('status') status?: string,
    @Query('franchiseId') franchiseId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.list({
      status,
      franchiseId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, message: 'Franchise reversals retrieved', data };
  }

  @Get(':id')
  @Permissions('sellerReversals.read')
  async getOne(@Param('id') id: string) {
    const data = await this.service.getForAdmin(id);
    return { success: true, message: 'Franchise reversal retrieved', data };
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
    @Body() body: RejectFranchiseReversalDto,
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
