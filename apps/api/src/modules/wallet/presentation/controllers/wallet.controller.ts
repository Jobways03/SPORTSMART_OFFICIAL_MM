import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';
import { WalletService } from '../../application/services/wallet.service';
import {
  InitiateTopupDto,
  VerifyTopupDto,
  WalletTransactionsQueryDto,
} from '../dtos/wallet.dtos';

/**
 * Phase 182 (#11) — the customer view of a wallet transaction NEVER includes
 * `internalNotes` (admin-only) or `createdByAdminId` (who adjusted it). Strip
 * them at the presentation boundary regardless of what the entity carries.
 */
function customerSafeTx(t: any) {
  const {
    internalNotes: _i, createdByAdminId: _a, walletId: _w, reason: _r, ...safe
  } = t ?? {};
  return safe;
}

@ApiTags('Wallet')
@Controller('customer/wallet')
@UseGuards(UserAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  // Phase 70 (2026-05-22) — Phase 66 audit Gap #19. Customer-facing
  // wallet reads are now rate-limited. 60/min covers normal usage
  // (cart page poll, checkout summary) without enabling a balance-
  // probing scraper.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getWallet(@Req() req: any) {
    const data = await this.wallet.getBalance(req.userId);
    return { success: true, message: 'Wallet retrieved', data };
  }

  @Get('transactions')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async listTransactions(
    @Req() req: any,
    @Query() query: WalletTransactionsQueryDto, // #12 — validated page/limit
  ) {
    const data = await this.wallet.listTransactions(
      req.userId,
      query.page ?? 1,
      query.limit ?? 20,
    );
    // #11 — strip admin-only fields from each row.
    return { success: true, message: 'Transactions retrieved', data: { ...data, items: data.items.map(customerSafeTx) } };
  }

  /* #10 — GET /customer/wallet/transactions/export.csv (statement of account). */
  @Get('transactions/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async exportTransactionsCsv(@Req() req: any, @Res() res: Response) {
    const { items } = await this.wallet.listTransactions(req.userId, 1, 10000);
    const headers = ['date', 'type', 'direction', 'description', 'reference', 'amount', 'balanceAfter', 'status'];
    const rupees = (n: number) => (n / 100).toFixed(2);
    const rows = items.map((t: any) => ({
      date: t.createdAt ? new Date(t.createdAt).toISOString() : '',
      type: t.type,
      direction: t.direction ?? (t.amountInPaise >= 0 ? 'CREDIT' : 'DEBIT'),
      description: t.description,
      reference: t.referenceNumber ?? '',
      amount: rupees(t.amountInPaise),
      balanceAfter: rupees(t.balanceAfterInPaise),
      status: t.status,
    }));
    const csv = toCsv(rows, headers, { bom: true });
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilenameSlug(['wallet_statement', new Date().toISOString().slice(0, 10)])}.csv"`);
    res.send(csv);
  }

  // Phase 1 (PR 1.3) — @Idempotent: a retried top-up POST must not
  // create a second Razorpay order + second pending WalletTransaction.
  // Phase 70 — @Throttle caps the burst on a customer-facing
  // money-mutation endpoint (audit Gap #19).
  @Post('topup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async initiateTopup(@Req() req: any, @Body() body: InitiateTopupDto) {
    // Phase 70 — DTO validation is now class-validator-driven;
    // amountInPaise is guaranteed integer + bounded at the pipe.
    // The Number() coerce is redundant but kept defensive in case
    // a future caller passes a Decimal.
    const data = await this.wallet.initiateTopup({
      userId: req.userId,
      amountInPaise: Number(body.amountInPaise),
    });
    return { success: true, message: 'Top-up initiated', data };
  }

  // Phase 1 (PR 1.3) — @Idempotent: layered with PR 0.2's amount-check.
  // A retried verify must not double-credit the wallet.
  // Phase 70 — manual presence-check block removed; DTO @IsString
  // enforces the same invariant at the pipe layer with a structured
  // 400 instead of the ad-hoc success:false response (Gap #19).
  @Post('topup/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async verifyTopup(@Req() req: any, @Body() body: VerifyTopupDto) {
    const result = await this.wallet.verifyTopup({
      userId: req.userId,
      walletTransactionId: body.walletTransactionId,
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
    });
    return {
      success: true,
      message: 'Top-up completed',
      data: {
        balanceInPaise: result.wallet.balanceInPaise,
        transaction: customerSafeTx(result.transaction), // #11
      },
    };
  }
}
