import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { NotFoundAppException } from '../../../../core/exceptions';
import { FranchiseCommissionService } from '../../application/services/franchise-commission.service';
import { FranchiseSettlementService } from '../../application/services/franchise-settlement.service';

@ApiTags('Franchise Earnings')
@Controller('franchise/earnings')
@UseGuards(FranchiseAuthGuard)
export class FranchiseEarningsController {
  constructor(
    private readonly commissionService: FranchiseCommissionService,
    private readonly settlementService: FranchiseSettlementService,
  ) {}

  @Get()
  async getEarningsSummary(@Req() req: Request) {
    const franchiseId = (req as any).franchiseId;

    const data = await this.commissionService.getEarningsSummary(franchiseId);

    return {
      success: true,
      message: 'Earnings summary fetched successfully',
      data,
    };
  }

  @Get('history')
  async getLedgerHistory(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sourceType') sourceType?: string,
    @Query('status') status?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const franchiseId = (req as any).franchiseId;

    const data = await this.commissionService.getLedgerHistory(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      sourceType,
      status,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });

    return {
      success: true,
      message: 'Ledger history fetched successfully',
      data,
    };
  }

  @Get('settlements')
  async getMySettlements(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const franchiseId = (req as any).franchiseId;

    const data = await this.settlementService.listSettlements({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      franchiseId,
      status,
    });

    return {
      success: true,
      message: 'Franchise settlements fetched successfully',
      data,
    };
  }

  @Get('settlements/:id')
  async getSettlementDetail(@Req() req: Request, @Param('id') id: string) {
    const franchiseId = (req as any).franchiseId;
    const data = await this.settlementService.getSettlementDetail(id);

    // Critical: verify ownership. Without this check, any authenticated
    // franchise could read any other franchise's settlement (including
    // netPayableToFranchise and full ledger breakdown) by guessing or
    // iterating UUIDs. Classic IDOR. The list endpoint above scopes
    // by franchiseId in the service call, so it was always safe; the
    // by-id endpoint forwarded the raw id with no owner check.
    //
    // Throw NotFound (not Forbidden) so an attacker can't enumerate
    // existence of settlements they don't own.
    if (!data || data.franchiseId !== franchiseId) {
      throw new NotFoundAppException('Franchise settlement not found');
    }

    return {
      success: true,
      message: 'Settlement detail fetched successfully',
      data,
    };
  }

  // Per-order commission records — parallel to the seller's
  // `/seller/earnings/records`. Each row is one ONLINE_ORDER ledger entry
  // hydrated with its SubOrder and OrderItem details.
  @Get('commission')
  async getCommissionRecords(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const franchiseId = (req as any).franchiseId;

    const data = await this.commissionService.getCommissionRecords(
      franchiseId,
      {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
        status,
        search,
        fromDate: fromDate ? new Date(fromDate) : undefined,
        toDate: toDate ? new Date(toDate) : undefined,
      },
    );

    return {
      success: true,
      message: 'Commission records fetched successfully',
      data,
    };
  }
}
