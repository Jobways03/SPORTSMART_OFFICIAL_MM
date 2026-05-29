import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { WalletService } from '../../application/services/wallet.service';
import {
  InitiateTopupDto,
  VerifyTopupDto,
} from '../dtos/wallet.dtos';

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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.wallet.listTransactions(
      req.userId,
      parseInt(page || '1', 10) || 1,
      parseInt(limit || '20', 10) || 20,
    );
    return { success: true, message: 'Transactions retrieved', data };
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
        transaction: result.transaction,
      },
    };
  }
}
