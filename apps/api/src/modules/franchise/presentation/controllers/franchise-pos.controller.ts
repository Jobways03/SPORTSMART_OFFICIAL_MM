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
import { FranchisePosService } from '../../application/services/franchise-pos.service';
import { PosRecordSaleDto } from '../dtos/pos-record-sale.dto';
import { PosVoidSaleDto } from '../dtos/pos-void-sale.dto';
import { PosReturnSaleDto } from '../dtos/pos-return-sale.dto';

@ApiTags('Franchise POS')
@Controller('franchise/pos')
@UseGuards(FranchiseAuthGuard)
export class FranchisePosController {
  constructor(private readonly posService: FranchisePosService) {}

  @Post('sales')
  @HttpCode(HttpStatus.CREATED)
  async recordSale(@Req() req: Request, @Body() dto: PosRecordSaleDto) {
    const franchiseId = (req as any).franchiseId;
    const actorId = (req as any).franchiseId;

    const sale = await this.posService.recordSale(
      franchiseId,
      {
        saleType: dto.saleType,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        paymentMethod: dto.paymentMethod,
        items: dto.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineDiscount: item.lineDiscount,
        })),
      },
      actorId,
    );

    return {
      success: true,
      message: 'POS sale recorded successfully',
      data: sale,
    };
  }

  @Get('sales')
  async listSales(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('saleType') saleType?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('search') search?: string,
  ) {
    const franchiseId = (req as any).franchiseId;

    const data = await this.posService.listSales(franchiseId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      status,
      saleType,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      search,
    });

    return {
      success: true,
      message: 'POS sales fetched successfully',
      data,
    };
  }

  @Get('daily-report')
  async getDailyReport(
    @Req() req: Request,
    @Query('date') date?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const reportDate = date ? new Date(date) : new Date();

    const data = await this.posService.getDailyReport(franchiseId, reportDate);

    return {
      success: true,
      message: 'Daily POS report fetched successfully',
      data,
    };
  }

  @Get('reconciliation')
  async getDailyReconciliation(
    @Req() req: Request,
    @Query('date') date?: string,
  ) {
    const franchiseId = (req as any).franchiseId;
    const reportDate = date ? new Date(date) : new Date();

    const data = await this.posService.getDailyReconciliation(
      franchiseId,
      reportDate,
    );

    return {
      success: true,
      message: 'Daily POS reconciliation fetched successfully',
      data,
    };
  }

  @Get('sales/:saleId')
  async getSaleDetail(
    @Req() req: Request,
    @Param('saleId') saleId: string,
  ) {
    const franchiseId = (req as any).franchiseId;

    const data = await this.posService.getSaleDetail(franchiseId, saleId);

    return {
      success: true,
      message: 'POS sale detail fetched successfully',
      data,
    };
  }

  @Post('sales/:saleId/void')
  @HttpCode(HttpStatus.OK)
  async voidSale(
    @Req() req: Request,
    @Param('saleId') saleId: string,
    @Body() dto: PosVoidSaleDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const actorId = (req as any).franchiseId;

    const data = await this.posService.voidSale(
      franchiseId,
      saleId,
      dto.reason,
      actorId,
    );

    return {
      success: true,
      message: 'POS sale voided successfully',
      data,
    };
  }

  @Post('sales/:saleId/return')
  @HttpCode(HttpStatus.OK)
  async returnSale(
    @Req() req: Request,
    @Param('saleId') saleId: string,
    @Body() dto: PosReturnSaleDto,
  ) {
    const franchiseId = (req as any).franchiseId;
    const actorId = (req as any).franchiseId;

    const data = await this.posService.returnSale(
      franchiseId,
      saleId,
      dto.items.map((item) => ({
        itemId: item.itemId,
        returnQty: item.returnQty,
      })),
      actorId,
    );

    return {
      success: true,
      message: 'POS sale return processed successfully',
      data,
    };
  }
}
