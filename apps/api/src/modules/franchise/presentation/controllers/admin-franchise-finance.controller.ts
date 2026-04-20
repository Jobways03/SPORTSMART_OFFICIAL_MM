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
import { AdminAuthGuard } from '../../../../core/guards';
import { FranchiseCommissionService } from '../../application/services/franchise-commission.service';
import { FranchiseLedgerAdjustmentDto } from '../dtos/franchise-ledger-adjustment.dto';
import { FranchiseLedgerPenaltyDto } from '../dtos/franchise-ledger-penalty.dto';

@ApiTags('Admin Franchise Finance')
@Controller('admin/franchise-finance')
@UseGuards(AdminAuthGuard)
export class AdminFranchiseFinanceController {
  constructor(
    private readonly commissionService: FranchiseCommissionService,
  ) {}

  @Post(':franchiseId/adjustment')
  @HttpCode(HttpStatus.CREATED)
  async createAdjustment(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: FranchiseLedgerAdjustmentDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.commissionService.createManualAdjustment({
      franchiseId,
      amount: dto.amount,
      reason: dto.reason,
      adminId,
    });

    return {
      success: true,
      message: 'Manual ledger adjustment created successfully',
      data,
    };
  }

  @Post(':franchiseId/penalty')
  @HttpCode(HttpStatus.CREATED)
  async createPenalty(
    @Req() req: Request,
    @Param('franchiseId') franchiseId: string,
    @Body() dto: FranchiseLedgerPenaltyDto,
  ) {
    const adminId = (req as any).adminId;
    const data = await this.commissionService.createPenalty({
      franchiseId,
      amount: dto.amount,
      reason: dto.reason,
      adminId,
    });

    return {
      success: true,
      message: 'Penalty recorded successfully',
      data,
    };
  }

  @Get(':franchiseId/ledger')
  async getFranchiseLedger(
    @Param('franchiseId') franchiseId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sourceType') sourceType?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.commissionService.getLedgerHistory(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      sourceType,
      status,
    });

    return {
      success: true,
      message: 'Franchise ledger fetched successfully',
      data,
    };
  }
}
