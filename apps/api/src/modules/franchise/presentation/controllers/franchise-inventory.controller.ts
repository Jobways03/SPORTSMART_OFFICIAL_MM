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
import { FranchiseAuthGuard } from '../../../../core/guards';
import { FranchiseInventoryService } from '../../application/services/franchise-inventory.service';
import { FranchiseAdjustStockDto } from '../dtos/franchise-adjust-stock.dto';

@ApiTags('Franchise Inventory')
@Controller('franchise/inventory')
@UseGuards(FranchiseAuthGuard)
export class FranchiseInventoryController {
  constructor(
    private readonly inventoryService: FranchiseInventoryService,
  ) {}

  @Get()
  async getStockOverview(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.inventoryService.getStockOverview(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      search,
      lowStockOnly: lowStockOnly === 'true',
    });

    return {
      success: true,
      message: 'Stock overview fetched successfully',
      data,
    };
  }

  @Get('low-stock')
  async getLowStockAlerts(@Req() req: Request) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.inventoryService.getLowStockAlerts(franchiseId);

    return {
      success: true,
      message: 'Low stock alerts fetched successfully',
      data,
    };
  }

  @Get('ledger')
  async getMovementHistory(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('productId') productId?: string,
    @Query('movementType') movementType?: string,
    @Query('referenceType') referenceType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
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
      message: 'Movement history fetched successfully',
      data,
    };
  }

  @Get(':productId')
  async getStockDetail(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Query('variantId') variantId?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.inventoryService.getStockDetail(
      franchiseId,
      productId,
      variantId,
    );

    return {
      success: true,
      message: 'Stock detail fetched successfully',
      data,
    };
  }

  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  async adjustStock(
    @Req() req: Request,
    @Body() dto: FranchiseAdjustStockDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const franchiseOwnerId = (req as any).franchiseOwnerId || franchiseId;

    const data = await this.inventoryService.adjustStock(franchiseId, {
      productId: dto.productId,
      variantId: dto.variantId,
      adjustmentType: dto.adjustmentType,
      quantity: dto.quantity,
      reason: dto.reason,
      actorType: 'FRANCHISE_OWNER',
      actorId: franchiseOwnerId,
    });

    return {
      success: true,
      message: 'Stock adjusted successfully',
      data,
    };
  }
}
