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
  async getWallet(@Req() req: any) {
    const data = await this.wallet.getBalance(req.userId);
    return { success: true, message: 'Wallet retrieved', data };
  }

  @Get('transactions')
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
  @Post('topup')
  @Idempotent()
  async initiateTopup(@Req() req: any, @Body() body: InitiateTopupDto) {
    const data = await this.wallet.initiateTopup({
      userId: req.userId,
      amountInPaise: Number(body?.amountInPaise),
    });
    return { success: true, message: 'Top-up initiated', data };
  }

  // Phase 1 (PR 1.3) — @Idempotent: layered with PR 0.2's amount-check.
  // A retried verify must not double-credit the wallet.
  @Post('topup/verify')
  @Idempotent()
  async verifyTopup(@Req() req: any, @Body() body: VerifyTopupDto) {
    if (
      !body?.walletTransactionId ||
      !body?.razorpayOrderId ||
      !body?.razorpayPaymentId ||
      !body?.razorpaySignature
    ) {
      return {
        success: false,
        message:
          'walletTransactionId, razorpayOrderId, razorpayPaymentId, and razorpaySignature are required',
      };
    }
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
