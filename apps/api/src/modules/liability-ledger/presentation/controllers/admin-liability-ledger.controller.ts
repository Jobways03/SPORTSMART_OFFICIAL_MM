import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { SellerDebitService } from '../../application/services/seller-debit.service';
import { LogisticsClaimService } from '../../application/services/logistics-claim.service';
import { PlatformExpenseService } from '../../application/services/platform-expense.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  CancelSellerDebitDto,
  CreateManualSellerDebitDto,
} from '../dtos/seller-debit.dto';
import {
  ReversePlatformExpenseDto,
  TransitionLogisticsClaimDto,
} from '../dtos/liability-action.dto';
import type { LogisticsClaimStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Phase 13 completion — admin browser for the three liability-ledger
 * tables (SellerDebit, LogisticsClaim, PlatformExpense). Read-only;
 * mutation lives on the services that own each row's lifecycle
 * (recover from settlement / file claim / record expense). Filters
 * on sourceType + sourceId let finance trace every cost attribution
 * back to the dispute or return that triggered it.
 *
 * Permissions: reads use `liability_ledger.read` (MEDIUM — no MFA step-up,
 * so the browse page loads); the manual-debit / cancel writes keep their
 * dedicated `liability_ledger.write` / `liability_ledger.cancel` (HIGH).
 * The read route previously reused `refunds.approve`, but that's CRITICAL
 * and forced a fresh MFA step-up on every GET, 403-ing the whole view.
 */
const VALID_TYPES = ['seller_debit', 'logistics_claim', 'platform_expense'] as const;
type LedgerType = (typeof VALID_TYPES)[number];

@ApiTags('Liability Ledger — Admin')
@Controller('admin/liability-ledger')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminLiabilityLedgerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerDebits: SellerDebitService,
    private readonly logisticsClaims: LogisticsClaimService,
    private readonly platformExpenses: PlatformExpenseService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * GET /admin/liability-ledger/:type
   *
   * Lists rows from the requested ledger table. Supports filtering on
   * sourceType (DISPUTE / RETURN) + sourceId (exact match) and pagination.
   * BigInt amounts are stringified server-side (wire format independent
   * of the BigInt.prototype.toJSON shim).
   */
  @Get(':type')
  // Read-only ledger browse. Gated on liability_ledger.read (MEDIUM) — the
  // dedicated read permission carved out in Phase 150 and already used by
  // pendingSummary below. It was previously `refunds.approve`, which is
  // classified CRITICAL and therefore demands a fresh MFA step-up on EVERY
  // request — that 403'd the whole page just to VIEW the ledger. Reads
  // shouldn't require step-up; the sensitive WRITE/CANCEL routes keep their
  // HIGH permissions.
  // Read of the liability ledger — the matching read permission, same as the
  // sibling /seller-debits/pending-summary route. (Was 'refunds.approve', a
  // copy-paste from the refund flow: it's CRITICAL, so it tripped the auto
  // step-up gate and 403'd even SUPER_ADMIN on a plain list read.)
  @Permissions('liability_ledger.read')
  async list(
    @Param('type') type: string,
    @Query('sourceType') sourceType?: string,
    @Query('sourceId') sourceId?: string,
    // Phase 150 — sellerId + status let the claw-back UI list "this seller's
    // PENDING debits" so each can be cancelled. Only seller_debit has these.
    @Query('sellerId') sellerId?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    if (!VALID_TYPES.includes(type as LedgerType)) {
      throw new BadRequestAppException(
        `type must be one of: ${VALID_TYPES.join(', ')}`,
      );
    }
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const where: any = {};
    if (sourceType) where.sourceType = sourceType;
    if (sourceId) where.sourceId = sourceId;
    if (sellerId && type === 'seller_debit') where.sellerId = sellerId;
    if (status && type === 'seller_debit') where.status = status;

    const skip = (pageNum - 1) * lim;
    const orderBy = { createdAt: 'desc' as const };

    let items: any[] = [];
    let total = 0;
    if (type === 'seller_debit') {
      [items, total] = await Promise.all([
        this.prisma.sellerDebit.findMany({ where, skip, take: lim, orderBy }),
        this.prisma.sellerDebit.count({ where }),
      ]);
    } else if (type === 'logistics_claim') {
      [items, total] = await Promise.all([
        this.prisma.logisticsClaim.findMany({ where, skip, take: lim, orderBy }),
        this.prisma.logisticsClaim.count({ where }),
      ]);
    } else {
      [items, total] = await Promise.all([
        this.prisma.platformExpense.findMany({ where, skip, take: lim, orderBy }),
        this.prisma.platformExpense.count({ where }),
      ]);
    }

    // BigInt → string for wire format. The Prisma payload contains
    // `amountInPaise` as BigInt on all three tables.
    const data = items.map((row) => ({
      ...row,
      amountInPaise:
        row.amountInPaise != null ? row.amountInPaise.toString() : null,
    }));

    return {
      success: true,
      message: 'Ledger rows retrieved',
      data: { items: data, total, page: pageNum, limit: lim, type },
    };
  }

  /**
   * GET /admin/liability-ledger/seller-debits/pending-summary
   *
   * Phase 150 — per-seller total of PENDING claw-backs (what the next
   * settlement cycle will deduct from each seller). Powers the "pending
   * claw-backs" widget on the settlement detail page. Optional `sellerIds`
   * (comma-separated) scopes the summary to a cycle's sellers; otherwise it
   * returns every seller with an outstanding claw-back (capped). Two path
   * segments so it never collides with the `:type` list route.
   */
  @Get('seller-debits/pending-summary')
  @Permissions('liability_ledger.read')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async pendingSummary(@Query('sellerIds') sellerIds?: string) {
    const ids = (sellerIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const grouped = await this.prisma.sellerDebit.groupBy({
      by: ['sellerId'],
      where: {
        status: 'PENDING',
        ...(ids.length ? { sellerId: { in: ids } } : {}),
      },
      _sum: { amountInPaise: true },
      _count: { _all: true },
      // Most-owed first; orderBy is also required by Prisma when `take` is set.
      orderBy: { _sum: { amountInPaise: 'desc' } },
      // Cap the unscoped variant so a huge ledger can't return unbounded rows.
      ...(ids.length ? {} : { take: 500 }),
    });
    const items = grouped.map((g) => ({
      sellerId: g.sellerId,
      totalPendingInPaise: (g._sum.amountInPaise ?? 0n).toString(),
      count: g._count._all,
    }));
    return {
      success: true,
      message: 'Pending claw-back summary',
      data: { items },
    };
  }

  /**
   * POST /admin/liability-ledger/debits
   *
   * Phase 150 — record a MANUAL seller debit (goodwill / off-platform claw-
   * back finance enters by hand). Netted off the seller's next cycle exactly
   * like an automated claw-back. A fresh sourceId per request — manual entries
   * aren't naturally idempotent, so a deliberate re-submit creates a new row.
   */
  @Post('debits')
  @Permissions('liability_ledger.write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async createManualDebit(
    @Req() req: Request,
    @Body() body: CreateManualSellerDebitDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const sourceId = randomUUID();
    const row = await this.sellerDebits.record({
      sellerId: body.sellerId,
      sourceType: 'MANUAL',
      sourceId,
      amountInPaise: body.amountInPaise,
      reason: body.reason,
    });
    await this.audit
      .writeAuditLog({
        actorId: adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'liability_ledger.manual_debit_created',
        module: 'liability-ledger',
        resource: 'seller_debit',
        resourceId: row.id,
        newValue: {
          sellerId: body.sellerId,
          amountInPaise: body.amountInPaise.toString(),
          reason: body.reason,
          sourceId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      })
      .catch(() => undefined);
    return {
      success: true,
      message: 'Manual seller debit recorded',
      data: { ...row, amountInPaise: row.amountInPaise.toString() },
    };
  }

  /**
   * PATCH /admin/liability-ledger/debits/:id/cancel
   *
   * Phase 150 — cancel a PENDING seller debit when a seller successfully
   * contests it. The service guards: APPLIED debits (already netted into a
   * settlement) can't be cancelled here — void the linked adjustment instead.
   */
  @Patch('debits/:id/cancel')
  @Permissions('liability_ledger.cancel')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async cancelDebit(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelSellerDebitDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const row = await this.sellerDebits.cancel(id, body.reason);
    await this.audit
      .writeAuditLog({
        actorId: adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'liability_ledger.debit_cancelled',
        module: 'liability-ledger',
        resource: 'seller_debit',
        resourceId: id,
        newValue: { status: row.status, reason: body.reason },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      })
      .catch(() => undefined);
    return {
      success: true,
      message: 'Seller debit cancelled',
      data: { ...row, amountInPaise: row.amountInPaise.toString() },
    };
  }

  /**
   * PATCH /admin/liability-ledger/claims/:id/transition
   *
   * Advance a logistics claim through its courier-recovery lifecycle
   * (PENDING → SUBMITTED → ACCEPTED → RECOVERED) or REJECTED. The service
   * enforces legal transitions (illegal jumps 400). When a claim is REJECTED
   * the courier denied liability, so the cost is auto-reclassified to a
   * PlatformExpense (platform absorbs it) — idempotent on the claim's source.
   */
  @Patch('claims/:id/transition')
  @Permissions('liability_ledger.write')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async transitionClaim(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransitionLogisticsClaimDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const claim = await this.logisticsClaims.transition(
      id,
      body.toStatus as LogisticsClaimStatus,
      { notes: body.note },
    );

    // Courier denied the claim → platform absorbs the cost. Idempotent on
    // (sourceType, sourceId); reuses an existing expense if one already exists.
    let reclassifiedExpenseId: string | null = null;
    if (body.toStatus === 'REJECTED') {
      const expense = await this.platformExpenses.record({
        sourceType: claim.sourceType,
        sourceId: claim.sourceId,
        expenseType: 'PLATFORM_FAULT',
        amountInPaise: Number(claim.amountInPaise),
        reason: `Logistics claim ${id} rejected by courier — reclassified to platform expense`,
      });
      reclassifiedExpenseId = expense.id;
    }

    await this.audit
      .writeAuditLog({
        actorId: adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'liability_ledger.claim_transitioned',
        module: 'liability-ledger',
        resource: 'logistics_claim',
        resourceId: id,
        newValue: {
          toStatus: body.toStatus,
          note: body.note ?? null,
          reclassifiedExpenseId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      })
      .catch(() => undefined);

    return {
      success: true,
      message:
        body.toStatus === 'REJECTED'
          ? 'Claim rejected — cost reclassified to platform expense'
          : `Claim moved to ${body.toStatus}`,
      data: {
        ...claim,
        amountInPaise: claim.amountInPaise.toString(),
        reclassifiedExpenseId,
      },
    };
  }

  /**
   * PATCH /admin/liability-ledger/expenses/:id/reverse
   *
   * Un-book a mis-attributed platform expense (soft reversal — excluded from
   * cost totals). Finance re-attributes the cost via a manual seller debit or
   * a re-filed claim. Cannot reverse twice (400).
   */
  @Patch('expenses/:id/reverse')
  @Permissions('liability_ledger.write')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async reverseExpense(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReversePlatformExpenseDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const row = await this.platformExpenses.reverseById(id, body.reason);
    await this.audit
      .writeAuditLog({
        actorId: adminId ?? 'system',
        actorRole: 'ADMIN',
        action: 'liability_ledger.expense_reversed',
        module: 'liability-ledger',
        resource: 'platform_expense',
        resourceId: id,
        newValue: { reversedAt: row.reversedAt, reason: body.reason },
        ipAddress: req.ip,
        userAgent: req.get('user-agent') ?? undefined,
      })
      .catch(() => undefined);
    return {
      success: true,
      message: 'Platform expense reversed',
      data: { ...row, amountInPaise: row.amountInPaise.toString() },
    };
  }
}
