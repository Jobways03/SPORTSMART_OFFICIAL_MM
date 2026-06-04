import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { toCsv, csvFilenameSlug } from '../../../../core/utils';
import {
  AdminAuthGuard,
  PermissionsGuard,
  PolicyGuard,
  RequiresStepUp,
  StepUpGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Policy } from '../../../../core/decorators/policy.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { NotFoundAppException } from '../../../../core/exceptions';
import { WalletService } from '../../application/services/wallet.service';
import {
  WalletRepository,
  WALLET_REPOSITORY,
} from '../../domain/repositories/wallet.repository.interface';
import { AdminCreditDto, AdminDebitDto } from '../dtos/wallet.dtos';

@ApiTags('Admin Wallets')
@Controller('admin/wallets')
@UseGuards(AdminAuthGuard, PermissionsGuard, PolicyGuard, StepUpGuard)
export class AdminWalletController {
  constructor(
    private readonly wallet: WalletService,
    @Inject(WALLET_REPOSITORY) private readonly repo: WalletRepository,
  ) {}

  @Get()
  @Permissions('wallets.read')
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
  @Permissions('wallets.read')
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

  // Phase 182 (#10) — admin statement-of-account CSV (full columns incl.
  // internalNotes + actor, which the customer export omits).
  @Get(':userId/transactions/export.csv')
  @Permissions('wallets.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportTransactionsCsv(@Param('userId') userId: string, @Res() res: Response) {
    const { items } = await this.wallet.listTransactions(userId, 1, 50000);
    const headers = ['date', 'type', 'direction', 'status', 'description', 'referenceType', 'referenceNumber', 'amount', 'balanceBefore', 'balanceAfter', 'creditType', 'createdByAdminId', 'internalNotes'];
    const rupees = (n: number) => (n / 100).toFixed(2);
    const rows = items.map((t: any) => ({
      date: t.createdAt ? new Date(t.createdAt).toISOString() : '',
      type: t.type,
      direction: t.direction ?? (t.amountInPaise >= 0 ? 'CREDIT' : 'DEBIT'),
      status: t.status,
      description: t.description,
      referenceType: t.referenceType ?? '',
      referenceNumber: t.referenceNumber ?? '',
      amount: rupees(t.amountInPaise),
      balanceBefore: rupees(t.balanceBeforeInPaise ?? 0),
      balanceAfter: rupees(t.balanceAfterInPaise),
      creditType: t.creditType ?? '',
      createdByAdminId: t.createdByAdminId ?? '',
      internalNotes: t.internalNotes ?? '',
    }));
    const csv = toCsv(rows, headers, { bom: true });
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilenameSlug(['wallet', userId, new Date().toISOString().slice(0, 10)])}.csv"`);
    res.send(csv);
  }

  // Phase 1 (PR 1.3) — @Idempotent: admin manual credit adjustments
  // are money-moving and ops-visible. A double-click on the adjust
  // button must not write the credit twice. (WalletService already
  // has a UNIQUE (referenceType, referenceId, type) backstop for the
  // refund path; this decorator catches CREDIT_ADJUSTMENT too.)
  // Phase 183 (#4) — the actor of a CRITICAL money action is the AUTHENTICATED
  // admin id (AdminAuthGuard sets req.adminId). NEVER fall back to req.userId
  // (a customer id) — that would mis-attribute the adjustment. Throw if absent.
  private adminActorId(req: any): string {
    const adminId = req?.adminId ?? req?.adminUserId;
    if (!adminId) {
      throw new UnauthorizedException('Admin actor could not be resolved for this wallet adjustment');
    }
    return adminId;
  }

  @Post(':userId/credit')
  @Idempotent()
  @Permissions('wallets.adjust')
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // #7
  @Policy({
    resourceType: 'wallet',
    action: 'credit',
    context: { amountInPaise: 'body.amountInPaise' },
  })
  // Phase 26 — credit adjustments move customer-visible money; tight
  // 1-min window.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async creditWallet(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: AdminCreditDto,
  ) {
    const adminId = this.adminActorId(req); // #4
    // #3 — give every manual adjustment a (referenceType, referenceId) so the DB
    // @@unique deduplicates it (not just the 24h Redis @Idempotent). The admin
    // may supply a stable referenceNumber (ticket/dispute id); else we mint one.
    const referenceId = body.referenceNumber ?? randomUUID();
    const result = await this.wallet.credit({
      userId,
      amountInPaise: body.amountInPaise,
      type: 'MANUAL_CREDIT', // #5 — distinct from goodwill/refund/loyalty
      creditType: 'MANUAL',
      reason: body.reason, // #2 — audit-grade
      description: body.description,
      internalNotes: body.internalNotes,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId,
      referenceNumber: body.referenceNumber,
      createdByAdminId: adminId,
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

  // Phase 1 (PR 1.3) — @Idempotent: same shape as creditWallet.
  @Post(':userId/debit')
  @Idempotent()
  @Permissions('wallets.adjust')
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // #7
  @Policy({
    resourceType: 'wallet',
    action: 'debit',
    context: { amountInPaise: 'body.amountInPaise' },
  })
  // Phase 26 — debit adjustments remove customer-visible money. Tight 1-min.
  @RequiresStepUp({ maxAgeMs: 60_000 })
  async debitWallet(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: AdminDebitDto,
  ) {
    const adminId = this.adminActorId(req); // #4
    const referenceId = body.referenceNumber ?? randomUUID(); // #3
    const result = await this.wallet.debit({
      userId,
      amountInPaise: body.amountInPaise,
      type: 'MANUAL_DEBIT', // #5
      reason: body.reason, // #2
      description: body.description,
      internalNotes: body.internalNotes,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId,
      referenceNumber: body.referenceNumber,
      createdByAdminId: adminId,
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
  @Permissions('wallets.block')
  // Phase 26 — blocking a wallet freezes outflows; HIGH risk → 5-min.
  @RequiresStepUp()
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
  @Permissions('wallets.block')
  @RequiresStepUp()
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
