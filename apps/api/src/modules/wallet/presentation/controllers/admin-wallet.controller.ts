import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { NotFoundAppException } from '../../../../core/exceptions';
import { WalletService } from '../../application/services/wallet.service';
import {
  WalletRepository,
  WALLET_REPOSITORY,
} from '../../domain/repositories/wallet.repository.interface';
import { AdminCreditDto, AdminDebitDto } from '../dtos/wallet.dtos';

@ApiTags('Admin Wallets')
@Controller('admin/wallets')
@UseGuards(AdminAuthGuard)
export class AdminWalletController {
  constructor(
    private readonly wallet: WalletService,
    @Inject(WALLET_REPOSITORY) private readonly repo: WalletRepository,
  ) {}

  @Get()
  async listWallets(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('minBalance') minBalance?: string,
    @Query('maxBalance') maxBalance?: string,
    @Query('blocked') blocked?: string,
  ) {
    const minPaise = minBalance ? Math.round(parseFloat(minBalance) * 100) : undefined;
    const maxPaise = maxBalance ? Math.round(parseFloat(maxBalance) * 100) : undefined;
    const blockedFlag =
      blocked === 'true' ? true : blocked === 'false' ? false : undefined;
    const data = await this.repo.listWallets({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      search: search?.trim() || undefined,
      minBalanceInPaise: Number.isFinite(minPaise) ? minPaise : undefined,
      maxBalanceInPaise: Number.isFinite(maxPaise) ? maxPaise : undefined,
      blocked: blockedFlag,
    });
    return { success: true, message: 'Wallets retrieved', data };
  }

  @Get(':userId')
  async getWalletDetail(@Param('userId') userId: string) {
    const wallet = await this.repo.findByUserId(userId);
    if (!wallet) throw new NotFoundAppException('Wallet not found');
    const transactions = await this.wallet.listTransactions(userId, 1, 50);
    return {
      success: true,
      message: 'Wallet retrieved',
      data: {
        wallet,
        transactions: transactions.items,
      },
    };
  }

  @Post(':userId/credit')
  async creditWallet(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: AdminCreditDto,
  ) {
    const result = await this.wallet.credit({
      userId,
      amountInPaise: Number(body?.amountInPaise),
      type: 'CREDIT_ADJUSTMENT',
      description: body.description,
      internalNotes: body.internalNotes,
      createdByAdminId: req.adminUserId ?? req.userId,
    });
    return {
      success: true,
      message: 'Wallet credited',
      data: {
        balanceInPaise: result.wallet.balanceInPaise,
        transaction: result.transaction,
      },
    };
  }

  @Post(':userId/debit')
  async debitWallet(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: AdminDebitDto,
  ) {
    const result = await this.wallet.debit({
      userId,
      amountInPaise: Number(body?.amountInPaise),
      type: 'DEBIT_ADJUSTMENT',
      description: body.description,
      internalNotes: body.internalNotes,
      createdByAdminId: req.adminUserId ?? req.userId,
    });
    return {
      success: true,
      message: 'Wallet debited',
      data: {
        balanceInPaise: result.wallet.balanceInPaise,
        transaction: result.transaction,
      },
    };
  }

  @Patch(':userId/block')
  @HttpCode(HttpStatus.OK)
  async blockWallet(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
  ) {
    const wallet = await this.wallet.setBlocked({
      userId,
      isBlocked: true,
      reason: body?.reason,
      adminId: req.adminId ?? req.adminUserId ?? req.userId,
    });
    return { success: true, message: 'Wallet blocked', data: wallet };
  }

  @Patch(':userId/unblock')
  @HttpCode(HttpStatus.OK)
  async unblockWallet(
    @Req() req: any,
    @Param('userId') userId: string,
  ) {
    const wallet = await this.wallet.setBlocked({
      userId,
      isBlocked: false,
      adminId: req.adminId ?? req.adminUserId ?? req.userId,
    });
    return { success: true, message: 'Wallet unblocked', data: wallet };
  }
}
