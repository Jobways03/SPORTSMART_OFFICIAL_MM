import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { FranchiseInventoryService } from '../../application/services/franchise-inventory.service';
import { FranchiseAdjustStockDto } from '../dtos/franchise-adjust-stock.dto';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

@ApiTags('Admin Franchise Inventory')
@Controller('admin/franchises')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('franchise.inventory')
export class AdminFranchiseInventoryController {
  constructor(
    private readonly inventoryService: FranchiseInventoryService,
    private readonly audit: AuditPublicFacade,
  ) {}

  @Get(':franchiseId/inventory')
  async viewFranchiseStock(
    @Param('franchiseId') franchiseId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
  ) {
    const data = await this.inventoryService.getStockOverview(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
      lowStockOnly: lowStockOnly === 'true',
    });

    return {
      success: true,
      message: 'Franchise stock fetched successfully',
      data,
    };
  }

  @Get(':franchiseId/inventory/ledger')
  async viewFranchiseLedger(
    @Param('franchiseId') franchiseId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('productId') productId?: string,
    @Query('movementType') movementType?: string,
    @Query('referenceType') referenceType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.inventoryService.getMovementHistory(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      productId,
      movementType,
      referenceType,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });

    return {
      success: true,
      message: 'Franchise inventory ledger fetched successfully',
      data,
    };
  }

  /**
   * Phase 159o (audit #10) — admin-initiated stock correction.
   *
   * Previously the admin surface was read-only: the only way to correct a
   * franchise's stock was for the franchise owner to do it themselves — the
   * same party that may have caused the discrepancy (a segregation-of-duties
   * gap). This endpoint lets a permissioned admin post a DAMAGE / LOSS /
   * ADJUSTMENT / AUDIT_CORRECTION against any franchise, attributing the
   * ledger row to the admin (actorType 'ADMIN') and writing an audit_log so
   * the correction is independently traceable.
   */
  @Post(':franchiseId/inventory/adjust')
  @HttpCode(HttpStatus.OK)
  async adjustFranchiseStock(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: FranchiseAdjustStockDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;

    const data = await this.inventoryService.adjustStock(franchiseId, {
      productId: dto.productId,
      variantId: dto.variantId,
      adjustmentType: dto.adjustmentType,
      quantity: dto.quantity,
      reason: dto.reason,
      actorType: 'ADMIN',
      actorId: adminId ?? 'unknown',
    });

    const ua = req.headers['user-agent'];
    this.audit
      .writeAuditLog({
        actorId: adminId ?? 'unknown',
        actorRole: 'ADMIN',
        action: 'FRANCHISE_INVENTORY_ADJUST',
        module: 'franchise',
        resource: 'FranchiseStock',
        resourceId: `${franchiseId}:${dto.productId}:${dto.variantId ?? ''}`,
        oldValue: null,
        newValue: {
          adjustmentType: dto.adjustmentType,
          quantity: dto.quantity,
        },
        metadata: {
          franchiseId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
          reason: dto.reason,
        },
        ipAddress: req.ip || req.socket?.remoteAddress || undefined,
        userAgent: typeof ua === 'string' ? ua : undefined,
      })
      .catch(() => undefined);

    return {
      success: true,
      message: 'Franchise stock adjusted successfully',
      data,
    };
  }
}
