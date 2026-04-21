import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { FranchiseSettlementService } from '../../application/services/franchise-settlement.service';
import { FranchiseSettlementCreateDto } from '../dtos/franchise-settlement-create.dto';
import { FranchiseSettlementPayDto } from '../dtos/franchise-settlement-pay.dto';
import { FranchiseSettlementFailDto } from '../dtos/franchise-settlement-fail.dto';

@ApiTags('Admin Franchise Settlements')
@Controller('admin/franchise-settlements')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminFranchiseSettlementsController {
  constructor(
    private readonly settlementService: FranchiseSettlementService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSettlementCycle(@Body() dto: FranchiseSettlementCreateDto) {
    const data = await this.settlementService.createSettlementCycle(
      new Date(dto.periodStart),
      new Date(dto.periodEnd),
    );

    return {
      success: true,
      message: 'Franchise settlement cycle created successfully',
      data,
    };
  }

  @Get()
  async listSettlements(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('cycleId') cycleId?: string,
    @Query('franchiseId') franchiseId?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;

    const { settlements, total } = await this.settlementService.listSettlements({
      page: pageNum,
      limit: limitNum,
      cycleId,
      franchiseId,
      status,
    });

    // Wrap in the pagination envelope used by every other list
    // endpoint in this codebase — admin-products, admin-categories,
    // storefront-products, admin-procurement (fixed in this pass),
    // franchise-procurement (fixed in this pass). The franchise-admin
    // dashboard reads `data.pagination.total` for its "Pending
    // Settlements" KPI; without this wrapper the tile stays at "--".
    return {
      success: true,
      message: 'Franchise settlements fetched successfully',
      data: {
        settlements,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  @Get(':id')
  async getSettlementDetail(@Param('id') id: string) {
    const data = await this.settlementService.getSettlementDetail(id);

    return {
      success: true,
      message: 'Franchise settlement detail fetched successfully',
      data,
    };
  }

  @Patch(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  async approveSettlement(@Param('id') id: string) {
    const data = await this.settlementService.approveSettlement(id);

    return {
      success: true,
      message: 'Franchise settlement approved successfully',
      data,
    };
  }

  @Patch(':id/fail')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  async markSettlementFailed(
    @Param('id') id: string,
    @Body() dto: FranchiseSettlementFailDto,
  ) {
    const data = await this.settlementService.markSettlementFailed(
      id,
      dto.reason,
    );

    return {
      success: true,
      message: 'Franchise settlement marked as failed',
      data,
    };
  }

  @Patch(':id/pay')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN')
  async markSettlementPaid(
    @Param('id') id: string,
    @Body() dto: FranchiseSettlementPayDto,
  ) {
    const data = await this.settlementService.markSettlementPaid(
      id,
      dto.paymentReference,
    );

    return {
      success: true,
      message: 'Franchise settlement marked as paid',
      data,
    };
  }
}
