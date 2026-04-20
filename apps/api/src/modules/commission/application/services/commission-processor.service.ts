import { Inject, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import {
  CommissionRepository,
  COMMISSION_REPOSITORY,
  CreateCommissionRecordData,
  CommissionRecordFilter,
  CommissionSettingsData,
} from '../../domain/repositories/commission.repository.interface';

const LOCK_KEY = 'lock:commission-processor';
const LOCK_TTL = 30; // 30 seconds lock

@Injectable()
export class CommissionProcessorService implements OnModuleInit {
  private readonly logger = new Logger(CommissionProcessorService.name);

  constructor(
    @Inject(COMMISSION_REPOSITORY)
    private readonly commissionRepo: CommissionRepository,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit() {
    // Check every 15 seconds for sub-orders past return window
    setInterval(() => this.processCommissions(), 15_000);
    this.logger.log('Commission processor started (15s interval) — Model 1 margin-based');
  }

  /* ── Background job: process delivered sub-orders ───────────────── */

  async processCommissions() {
    // Distributed lock: prevent multiple instances from processing the same sub-orders
    const acquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!acquired) return; // Another instance is already processing

    try {
      const subOrders = await this.commissionRepo.findDeliveredSubOrders();

      if (subOrders.length === 0) return;

      for (const so of subOrders) {
        const sellerName = so.seller?.sellerShopName || 'Unknown';
        const orderNumber = so.masterOrder.orderNumber;

        const records: CreateCommissionRecordData[] = [];

        for (const item of so.items) {
          // Look up the SellerProductMapping for the settlement price
          const mapping = await this.commissionRepo.getSellerProductMapping(
            so.sellerId,
            item.productId,
            item.variantId,
          );

          // platformPrice = what the customer paid (stored as unitPrice in the OrderItem)
          const platformPrice = Number(item.unitPrice);

          // settlementPrice = what the seller gets per unit (from the mapping)
          // Fallback: if no mapping or no settlementPrice, use 80% of platformPrice as a safe default
          const settlementPrice = mapping?.settlementPrice
            ? Number(mapping.settlementPrice)
            : Math.round(platformPrice * 0.8 * 100) / 100;

          const quantity = item.quantity;

          // Per-unit margin
          const unitMargin = Math.round((platformPrice - settlementPrice) * 100) / 100;

          // Totals
          const totalPlatformAmount = Math.round(platformPrice * quantity * 100) / 100;
          const totalSettlementAmount = Math.round(settlementPrice * quantity * 100) / 100;
          const platformMargin = Math.round((totalPlatformAmount - totalSettlementAmount) * 100) / 100;

          // Populate legacy fields for backward compatibility
          const totalItemPrice = Number(item.totalPrice);
          const rateLabel = `Margin: ${((unitMargin / platformPrice) * 100).toFixed(1)}%`;

          records.push({
            orderItemId: item.id,
            subOrderId: so.id,
            masterOrderId: so.masterOrderId,
            sellerId: so.sellerId,
            productId: item.productId,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle || null,
            orderNumber,
            sellerName,

            // Model 1 fields
            platformPrice,
            settlementPrice,
            quantity,
            totalPlatformAmount,
            totalSettlementAmount,
            platformMargin,
            status: 'PENDING',

            // Legacy fields (mapped from new logic)
            unitPrice: platformPrice,
            totalPrice: totalItemPrice,
            commissionType: 'MARGIN_BASED',
            commissionRate: rateLabel,
            unitCommission: unitMargin,
            totalCommission: platformMargin,
            adminEarning: platformMargin,
            productEarning: totalSettlementAmount,
          });
        }

        await this.commissionRepo.processSubOrderCommission(so.id, records);

        this.logger.log(
          `Commission processed for sub-order ${so.id} (order ${so.masterOrder.orderNumber})`,
        );

        // Notify the seller that commission is locked — their payout is now
        // final (modulo explicit returns / manual adjustments). Fires once
        // per sub-order, not per line item, so multi-item orders don't spam.
        const totalAdminEarning = records.reduce(
          (sum, r) => sum + r.adminEarning,
          0,
        );
        const totalSellerEarning = records.reduce(
          (sum, r) => sum + r.productEarning,
          0,
        );
        this.eventBus
          .publish({
            eventName: 'commission.locked',
            aggregate: 'SubOrder',
            aggregateId: so.id,
            occurredAt: new Date(),
            payload: {
              subOrderId: so.id,
              masterOrderId: so.masterOrderId,
              orderNumber,
              sellerId: so.sellerId,
              itemCount: records.length,
              adminEarning:
                Math.round(totalAdminEarning * 100) / 100,
              sellerEarning:
                Math.round(totalSellerEarning * 100) / 100,
            },
          })
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to publish commission.locked: ${(err as Error)?.message}`,
            ),
          );
      }
    } catch (err) {
      this.logger.error('Commission processing error', err);
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }

  /* ── Admin: commission records ──────────────────────────────────── */

  async getCommissionRecords(filter: CommissionRecordFilter, page: number, limit: number) {
    return this.commissionRepo.getCommissionRecords(filter, page, limit);
  }

  /**
   * Unpaginated fetch for CSV export. Hard-cap at 50k rows so a single
   * export can't wedge the API under a massive date range — the UI should
   * surface a truncation warning when `truncated: true`.
   */
  async exportCommissionRecords(filter: CommissionRecordFilter) {
    const HARD_CAP = 50_000;
    const where: any = {};
    if (filter.sellerId) where.sellerId = filter.sellerId;
    if (filter.status) where.status = filter.status;
    if (filter.commissionType) where.commissionType = filter.commissionType;
    if (filter.dateFrom || filter.dateTo) {
      where.createdAt = {};
      if (filter.dateFrom) where.createdAt.gte = new Date(filter.dateFrom);
      if (filter.dateTo) {
        const end = new Date(filter.dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    if (filter.search && filter.search.trim()) {
      where.OR = [
        { orderNumber: { contains: filter.search.trim(), mode: 'insensitive' } },
        { sellerName: { contains: filter.search.trim(), mode: 'insensitive' } },
        { productTitle: { contains: filter.search.trim(), mode: 'insensitive' } },
      ];
    }

    const total = await this.prisma.commissionRecord.count({ where });
    const rows = await this.prisma.commissionRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: HARD_CAP,
      include: {
        sellerSettlement: { select: { id: true, paidAt: true, utrReference: true } },
      },
    });
    return { rows, total, truncated: total > rows.length };
  }

  /* ── Admin: summary ─────────────────────────────────────────────── */

  async getAdminCommissionSummary() {
    return this.commissionRepo.getAdminCommissionSummary();
  }

  /* ── Admin: settings ────────────────────────────────────────────── */

  async getCommissionSettings() {
    return this.commissionRepo.getCommissionSettings();
  }

  async updateCommissionSettings(data: CommissionSettingsData) {
    return this.commissionRepo.upsertCommissionSettings(data);
  }

  /* ── Seller: commission records ─────────────────────────────────── */

  async getSellerCommissionRecords(
    sellerId: string,
    filter: Omit<CommissionRecordFilter, 'sellerId' | 'commissionType'>,
    page: number,
    limit: number,
  ) {
    return this.commissionRepo.getSellerCommissionRecords(sellerId, filter, page, limit);
  }

  /* ── Admin: reversal + adjustment history ──────────────────────── */

  /**
   * Unified audit timeline for a single commission record: the original
   * processed state, every reversal event (from QC-approved returns), and
   * the manual adjustment if any. Returned ordered oldest-first so the UI
   * can render a natural timeline.
   */
  async getCommissionHistory(recordId: string) {
    const record = await this.prisma.commissionRecord.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundAppException('Commission record not found');

    const reversals = await this.prisma.commissionReversalRecord.findMany({
      where: { commissionRecordId: recordId },
      orderBy: { createdAt: 'asc' },
    });

    type Event =
      | {
          type: 'COMMISSION_LOCKED';
          at: Date;
          adminEarning: number;
          platformMargin: number;
          note: string;
        }
      | {
          type: 'REVERSAL';
          at: Date;
          returnNumber: string | null;
          reversedQty: number;
          totalRefundAmount: number;
          refundedAdminEarning: number;
          actorType: string;
          note: string | null;
        }
      | {
          type: 'MANUAL_ADJUSTMENT';
          at: Date;
          adminId: string | null;
          previousAdminEarning: number | null;
          newAdminEarning: number;
          reason: string | null;
        };

    const timeline: Event[] = [];
    timeline.push({
      type: 'COMMISSION_LOCKED',
      at: record.createdAt,
      adminEarning: Number(record.adminEarning),
      platformMargin: Number(record.platformMargin),
      note: 'Commission locked by processor after return window',
    });
    for (const r of reversals) {
      timeline.push({
        type: 'REVERSAL',
        at: r.createdAt,
        returnNumber: r.returnNumber,
        reversedQty: r.reversedQty,
        totalRefundAmount: Number(r.totalRefundAmount),
        refundedAdminEarning: Number(r.refundedAdminEarning),
        actorType: r.actorType,
        note: r.note,
      });
    }
    if (record.adjustedAt) {
      timeline.push({
        type: 'MANUAL_ADJUSTMENT',
        at: record.adjustedAt,
        adminId: record.adjustedBy,
        previousAdminEarning:
          record.originalAdminEarning != null
            ? Number(record.originalAdminEarning)
            : null,
        newAdminEarning: Number(record.adminEarning),
        reason: record.adjustmentReason,
      });
    }

    timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      record: {
        id: record.id,
        orderNumber: record.orderNumber,
        sellerName: record.sellerName,
        productTitle: record.productTitle,
        variantTitle: record.variantTitle,
        quantity: record.quantity,
        platformPrice: Number(record.platformPrice),
        settlementPrice: Number(record.settlementPrice),
        platformMargin: Number(record.platformMargin),
        adminEarning: Number(record.adminEarning),
        refundedAdminEarning: Number(record.refundedAdminEarning),
        status: record.status,
      },
      reversalCount: reversals.length,
      netAdminEarning:
        Math.round(
          (Number(record.adminEarning) - Number(record.refundedAdminEarning)) *
            100,
        ) / 100,
      timeline,
    };
  }

  /* ── Admin: manual commission adjustment ────────────────────────── */

  /**
   * Override the platform's earning on a commission record. Reserved for
   * dispute resolution — every call creates an audit trail by preserving
   * the processor's original value in `originalAdminEarning` and stamping
   * the admin/time/reason. Records already in SETTLED state are rejected
   * here so we never silently mutate something that's already been paid
   * out; use the reversal flow instead.
   */
  async adjustCommissionRecord(
    recordId: string,
    input: { newAdminEarning: number; reason: string; adminId: string },
  ) {
    const record = await this.prisma.commissionRecord.findUnique({
      where: { id: recordId },
    });
    if (!record) throw new NotFoundAppException('Commission record not found');

    if (record.status === 'SETTLED') {
      throw new BadRequestAppException(
        'Record is already SETTLED. Use the reversal flow to recover funds; this endpoint only adjusts PENDING records.',
      );
    }
    if (record.status === 'REFUNDED') {
      throw new BadRequestAppException(
        'Record is REFUNDED and cannot be adjusted.',
      );
    }
    if (!input.reason || input.reason.trim().length < 3) {
      throw new BadRequestAppException(
        'A reason (min 3 chars) is required for every manual adjustment.',
      );
    }
    const newEarning = Math.round(input.newAdminEarning * 100) / 100;
    if (newEarning < 0) {
      throw new BadRequestAppException('newAdminEarning cannot be negative');
    }

    // Preserve the processor's original value on first adjustment only —
    // subsequent tweaks leave `originalAdminEarning` untouched so the column
    // always reflects what the algorithm produced.
    const preserveOriginal =
      record.originalAdminEarning == null ? Number(record.adminEarning) : undefined;

    const updated = await this.prisma.commissionRecord.update({
      where: { id: recordId },
      data: {
        adminEarning: newEarning,
        platformMargin: newEarning,
        adjustedBy: input.adminId,
        adjustedAt: new Date(),
        adjustmentReason: input.reason.trim(),
        ...(preserveOriginal !== undefined
          ? { originalAdminEarning: preserveOriginal }
          : {}),
      },
    });

    this.eventBus
      .publish({
        eventName: 'commission.record_adjusted',
        aggregate: 'CommissionRecord',
        aggregateId: recordId,
        occurredAt: new Date(),
        payload: {
          recordId,
          sellerId: record.sellerId,
          orderNumber: record.orderNumber,
          adminId: input.adminId,
          reason: input.reason.trim(),
          previousAdminEarning: Number(record.adminEarning),
          newAdminEarning: newEarning,
        },
      })
      .catch(() => {});

    this.logger.log(
      `Commission record ${recordId} adjusted by admin ${input.adminId}: ₹${record.adminEarning} → ₹${newEarning}`,
    );

    return updated;
  }
}
