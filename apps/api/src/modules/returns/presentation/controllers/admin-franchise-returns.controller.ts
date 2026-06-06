import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { ReturnService } from '../../application/services/return.service';

/**
 * Admin (oversight) view of a franchise partner's returns — the franchise-admin
 * counterpart of the seller-admin returns surface. The franchise PORTAL endpoint
 * (`/franchise/returns`, FranchiseAuthGuard) is scoped to req.franchiseId and so
 * is unusable by an admin picking a franchise; this controller is admin-scoped
 * and reuses ReturnService's node-scoped readers (same module, direct inject).
 *
 * Reuses the existing `returns.read` permission slug (read-only; lifecycle
 * actions stay on the admin/seller surfaces).
 */
@ApiTags('Admin Franchise Returns')
@Controller('admin/franchise-returns')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('returns.read')
export class AdminFranchiseReturnsController {
  constructor(private readonly returnService: ReturnService) {}

  @Get('franchises/:franchiseId')
  async listFranchiseReturns(
    @Param('franchiseId') franchiseId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.returnService.listReturnsForFulfillmentNode({
      nodeType: 'FRANCHISE',
      nodeId: franchiseId,
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20)),
      status,
    });
    return { success: true, message: 'Franchise returns retrieved', data };
  }

  @Get(':returnId')
  async getFranchiseReturnDetail(
    @Param('returnId') returnId: string,
    @Query('franchiseId') franchiseId: string,
  ) {
    if (!franchiseId) {
      throw new BadRequestAppException('franchiseId query param is required');
    }
    // Asserts the return actually belongs to this franchise before returning it.
    const data = await this.returnService.getReturnDetailForNode(
      returnId,
      'FRANCHISE',
      franchiseId,
    );
    return { success: true, message: 'Franchise return retrieved', data };
  }
}
