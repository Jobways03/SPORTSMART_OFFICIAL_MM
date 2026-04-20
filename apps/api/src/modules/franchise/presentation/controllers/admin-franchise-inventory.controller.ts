import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { FranchiseInventoryService } from '../../application/services/franchise-inventory.service';

@ApiTags('Admin Franchise Inventory')
@Controller('admin/franchises')
@UseGuards(AdminAuthGuard)
export class AdminFranchiseInventoryController {
  constructor(
    private readonly inventoryService: FranchiseInventoryService,
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
}
