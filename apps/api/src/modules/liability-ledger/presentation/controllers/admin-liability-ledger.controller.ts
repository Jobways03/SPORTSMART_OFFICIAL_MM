import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /admin/liability-ledger/:type
   *
   * Lists rows from the requested ledger table. Supports filtering on
   * sourceType (DISPUTE / RETURN) + sourceId (exact match) and pagination.
   * BigInt amounts are stringified server-side (wire format independent
   * of the BigInt.prototype.toJSON shim).
   */
  @Get(':type')
  @Permissions('refunds.approve')
  async list(
    @Param('type') type: string,
    @Query('sourceType') sourceType?: string,
    @Query('sourceId') sourceId?: string,
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
}
