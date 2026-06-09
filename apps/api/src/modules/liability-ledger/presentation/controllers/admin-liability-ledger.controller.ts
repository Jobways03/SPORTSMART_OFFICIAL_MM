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
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  CancelSellerDebitDto,
  CreateManualSellerDebitDto,
} from '../dtos/seller-debit.dto';
import { randomUUID } from 'crypto';

/**
 * Phase 13 completion — admin browser for the three liability-ledger
 * tables (SellerDebit, LogisticsClaim, PlatformExpense). Read-only;
 * mutation lives on the services that own each row's lifecycle
 * (recover from settlement / file claim / record expense). Filters
 * on sourceType + sourceId let finance trace every cost attribution
 * back to the dispute or return that triggered it.
 *
 * Permission: `refunds.approve` — finance role already has this for
 * the RefundInstruction approval queue, and these tables are the
 * downstream record of the same decisions, so the same role gates
 * both surfaces. A separate `ledger.read` slug could be carved out
 * later if we want a stricter split.
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
}
