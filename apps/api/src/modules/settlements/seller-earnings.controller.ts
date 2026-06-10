import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SellerAuthGuard } from '../../core/guards';
import { SettlementService } from './settlement.service';
import { CommissionInvoiceUnavailableError } from '../tax/application/services/commission-invoice.service';

@ApiTags('Seller Earnings')
@Controller('seller/earnings')
@UseGuards(SellerAuthGuard)
export class SellerEarningsController {
  constructor(private readonly settlementService: SettlementService) {}

  /* ── GET /seller/earnings/summary ── */
  @Get('summary')
  async getSummary(@Req() req: any) {
    const data = await this.settlementService.getSellerEarningsSummary(req.sellerId);

    return {
      success: true,
      message: 'Earnings summary retrieved',
      data,
    };
  }

  /* ── GET /seller/earnings/records ── */
  @Get('records')
  async getRecords(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const data = await this.settlementService.getSellerCommissionRecords(
      req.sellerId,
      pageNum,
      limitNum,
      search,
      status,
    );

    return {
      success: true,
      message: 'Commission records retrieved',
      data,
    };
  }

  /* ── GET /seller/earnings/settlements ── */
  @Get('settlements')
  async getSettlements(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));

    const data = await this.settlementService.getSellerSettlementHistory(
      req.sellerId,
      pageNum,
      limitNum,
    );

    return {
      success: true,
      message: 'Settlement history retrieved',
      data,
    };
  }

  /* ── GET /seller/earnings/settlements/:settlementId/commission-invoice ──
   * The seller's own copy of the marketplace commission tax invoice (SAC
   * 9985) for one settlement, served inline as HTML to view / print /
   * save. Ownership is enforced in the service (a seller can only fetch
   * their own settlement); 404 if it isn't theirs or the invoice hasn't
   * been issued yet (invoices are issued at cycle approval). */
  @Get('settlements/:settlementId/commission-invoice')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getCommissionInvoice(
    @Req() req: any,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Res() res: any,
  ) {
    let result: { documentNumber: string; html: string };
    try {
      result = await this.settlementService.getSellerCommissionInvoiceHtml(
        req.sellerId,
        settlementId,
      );
    } catch (err) {
      if (err instanceof CommissionInvoiceUnavailableError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${result.documentNumber}.html"`,
    );
    res.send(result.html);
  }

  /* ── GET /seller/earnings/settlements/:settlementId/settlement-statement ──
   * The seller's own settlement / payout statement (full breakdown) for
   * one settlement, served inline as HTML. Ownership enforced in the
   * service. Remittance advice, not a tax invoice. */
  @Get('settlements/:settlementId/settlement-statement')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async getSettlementStatement(
    @Req() req: any,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Res() res: any,
  ) {
    let result: { documentNumber: string; html: string };
    try {
      result = await this.settlementService.getSellerSettlementStatementHtml(
        req.sellerId,
        settlementId,
      );
    } catch (err) {
      if (err instanceof CommissionInvoiceUnavailableError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${result.documentNumber}.html"`,
    );
    res.send(result.html);
  }

  /* ── Phase B (P0.5) — GET /seller/earnings/discount-deductions ──
   *
   * Paginated list of seller-funded discount deductions for the
   * authenticated seller. Each row records an amount the seller
   * has agreed to absorb (one liability ledger entry per
   * (order × discount) pair). Platform-funded discounts do NOT
   * appear here. */
  @Get('discount-deductions')
  async getDiscountDeductions(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20));
    const data = await this.settlementService.getSellerDiscountDeductions(
      req.sellerId,
      pageNum,
      limitNum,
    );
    return {
      success: true,
      message: 'Discount deductions retrieved',
      data,
    };
  }
}
