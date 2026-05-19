import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
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
export class CommissionProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommissionProcessorService.name);
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(COMMISSION_REPOSITORY)
    private readonly commissionRepo: CommissionRepository,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly ordersFacade: OrdersPublicFacade,
    // Phase 7 (PR 7.7) — paise-sibling dual-write for the manual
    // commission-record adjustment path (admin overrides the
    // algorithm-produced earning + margin).
    private readonly moneyDualWrite: MoneyDualWriteHelper,
    private readonly env: EnvService,
  ) {}

  onModuleInit() {
    // Phase 3.6 (2026-05-16) — feature-flag gate. Default ON so we
    // don't change production behaviour, but the team can pause the
    // processor without a code change when needed (e.g. during a
    // commission-rule migration, or to investigate a runaway
    // commission row). The interval is env-tunable as well — for
    // load tests we may want to slow it down.
    if (!this.env.getBoolean('COMMISSION_PROCESSOR_ENABLED', true)) {
      this.logger.warn(
        'CommissionProcessorService disabled via COMMISSION_PROCESSOR_ENABLED=false — sub-orders past return-window will NOT auto-lock commission.',
      );
      return;
    }
    const intervalMs = this.env.getNumber(
      'COMMISSION_PROCESSOR_INTERVAL_MS',
      15_000,
    );
    this.tickTimer = setInterval(() => this.processCommissions(), intervalMs);
    this.logger.log(
      `Commission processor started (${intervalMs}ms interval) — Model 1 margin-based`,
    );
  }

  /**
   * Clean up the setInterval on SIGTERM. Without this, the worker
   * holds the event loop open until the next tick fires, delaying
   * pod eviction and accumulating zombie tasks across rolling
   * deploys.
   */
  onModuleDestroy() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
      this.logger.log('Commission processor stopped on module destroy');
    }
  }

  /* ── Background job: process delivered sub-orders ───────────────── */

  async processCommissions() {
    // Distributed lock: prevent multiple instances from processing the same sub-orders
    const acquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!acquired) return; // Another instance is already processing

    try {
      const subOrders = await this.commissionRepo.findDeliveredSubOrders();

      if (subOrders.length === 0) return;

      // Fetch the global commission setting once per tick. Used as a
      // fallback when a mapping's margin is <= 0 (e.g., seller-admin set
      // settlementPrice equal to platformPrice) so the platform still
      // earns commission on every order.
      const settings = await this.commissionRepo.getCommissionSettings();
      const fallbackRatePercent = Number(settings?.commissionValue ?? 20);

      for (const so of subOrders) {
        await this.lockSubOrderCommission(so, fallbackRatePercent, 'cron');
      }
    } catch (err) {
      this.logger.error('Commission processing error', err);
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }

  /**
   * Builds + persists commission records for a single sub-order, then
   * publishes commission.locked. Pulled out of processCommissions() so
   * the same path is reused by the immediate-trigger entry point on
   * return rejection / cancellation. The reason tag is only used in
   * the log line — the persisted shape is identical regardless of
   * whether the cron or a return-rejection fired this.
   */
  private async lockSubOrderCommission(
    so: any,
    fallbackRatePercent: number,
    reason: string,
  ): Promise<void> {
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

      // settlementPrice = what the seller gets per unit (from the mapping).
      // Starts with whatever the mapping says (null → 80% fallback); if that
      // leaves the platform with zero or negative margin, we re-derive it
      // from the global commission percentage below so every order still
      // earns a commission.
      let settlementPrice = mapping?.settlementPrice
        ? Number(mapping.settlementPrice)
        : Math.round(platformPrice * 0.8 * 100) / 100;

      const quantity = item.quantity;

      // Per-unit margin
      let unitMargin = Math.round((platformPrice - settlementPrice) * 100) / 100;
      let usedFallbackRate = false;
      if (unitMargin <= 0) {
        // Platform keeps `fallbackRatePercent` of the platform price,
        // seller keeps the remainder — applies when seller-admin forgot
        // to set a margin on the mapping.
        unitMargin = Math.round(platformPrice * (fallbackRatePercent / 100) * 100) / 100;
        settlementPrice = Math.round((platformPrice - unitMargin) * 100) / 100;
        usedFallbackRate = true;
      }

      // Totals
      const totalPlatformAmount = Math.round(platformPrice * quantity * 100) / 100;
      const totalSettlementAmount = Math.round(settlementPrice * quantity * 100) / 100;
      const platformMargin = Math.round((totalPlatformAmount - totalSettlementAmount) * 100) / 100;

      // Populate legacy fields for backward compatibility
      const totalItemPrice = Number(item.totalPrice);
      const ratePct = platformPrice > 0 ? (unitMargin / platformPrice) * 100 : 0;
      const rateLabel = usedFallbackRate
        ? `Platform fee: ${ratePct.toFixed(1)}% (fallback)`
        : `Margin: ${ratePct.toFixed(1)}%`;

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
      `Commission processed for sub-order ${so.id} (order ${so.masterOrder.orderNumber}) [trigger=${reason}]`,
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
          adminEarning: Math.round(totalAdminEarning * 100) / 100,
          sellerEarning: Math.round(totalSellerEarning * 100) / 100,
          trigger: reason,
        },
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `Failed to publish commission.locked: ${(err as Error)?.message}`,
        ),
      );
  }

  /**
   * Lock commission for one sub-order right now, bypassing the
   * deliveredAt-window gate. Called by the returns module when a return
   * reaches a terminal-rejected state (REJECTED / QC_REJECTED /
   * CANCELLED) — at that point the customer's claim is final, the cron
   * would have processed this sub-order eventually, and there's no
   * value to making the seller wait out the rest of the window.
   *
   * Idempotent — `processSubOrderCommission` uses an atomic-claim
   * UPDATE on `commissionProcessed=false` so a race against the cron
   * is safe (only one will win and write records). If the sub-order
   * is no longer eligible (already processed, has a non-terminal
   * return after all, or isn't a seller sub-order), this is a silent
   * no-op rather than an error.
   */
  async lockCommissionForSubOrderImmediately(
    subOrderId: string,
    reason: string,
  ): Promise<void> {
    const so = await this.ordersFacade.findSubOrderForImmediateCommission(
      subOrderId,
    );
    if (!so) {
      this.logger.log(
        `Skipping immediate commission for sub-order ${subOrderId} — not eligible (already processed, not delivered, or has a non-terminal return)`,
      );
      return;
    }
    // Franchise commissions go through a separate flow that doesn't
    // exist yet on this processor. Skip cleanly so callers don't need
    // to branch.
    if ((so as any).fulfillmentNodeType !== 'SELLER' || !(so as any).sellerId) {
      this.logger.log(
        `Skipping immediate commission for sub-order ${subOrderId} — not a seller sub-order`,
      );
      return;
    }

    const settings = await this.commissionRepo.getCommissionSettings();
    const fallbackRatePercent = Number(settings?.commissionValue ?? 20);

    await this.lockSubOrderCommission(so, fallbackRatePercent, reason);
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
    // Phase 2 / H10 — even a PENDING record can be inside a
    // SellerSettlement that has already been APPROVED or PAID by
    // finance. Editing the earning at that point silently drifts
    // the cycle's totals from what was approved. Refuse, and route
    // the operator to the reversal flow.
    if (record.settlementId) {
      const settlement = await this.prisma.sellerSettlement.findUnique({
        where: { id: record.settlementId },
        select: { id: true, status: true, cycleId: true },
      });
      if (
        settlement &&
        (settlement.status === 'APPROVED' || settlement.status === 'PAID')
      ) {
        throw new BadRequestAppException(
          `Record belongs to a SellerSettlement in ${settlement.status} state; ` +
            'totals on an approved cycle are frozen. ' +
            'Use the reversal flow to record a corrective adjustment instead.',
        );
      }
      if (settlement?.cycleId) {
        const cycle = await this.prisma.settlementCycle.findUnique({
          where: { id: settlement.cycleId },
          select: { status: true },
        });
        if (
          cycle &&
          (cycle.status === 'APPROVED' || cycle.status === 'PAID')
        ) {
          throw new BadRequestAppException(
            `Settlement cycle is in ${cycle.status} state; commission ` +
              'records included in an approved cycle are frozen. ' +
              'Use the reversal flow.',
          );
        }
      }
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
    // always reflects what the algorithm produced. Pass the Decimal verbatim
    // (no Number(...) collapse) so the dual-write helper's toPaise can
    // convert exactly when MONEY_DUAL_WRITE_ENABLED is on.
    const preserveOriginal =
      record.originalAdminEarning == null ? record.adminEarning : undefined;

    const updated = await this.prisma.commissionRecord.update({
      where: { id: recordId },
      data: this.moneyDualWrite.applyPaise('commissionRecord', {
        // newEarning arrives as a JS Number from input.newAdminEarning.
        // .toFixed(2) gives toPaise a Decimal-string to parse exactly,
        // sidestepping the fractional-Number RangeError.
        adminEarning: Number(newEarning).toFixed(2),
        platformMargin: Number(newEarning).toFixed(2),
        adjustedBy: input.adminId,
        adjustedAt: new Date(),
        adjustmentReason: input.reason.trim(),
        ...(preserveOriginal !== undefined
          ? { originalAdminEarning: preserveOriginal }
          : {}),
      }),
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
