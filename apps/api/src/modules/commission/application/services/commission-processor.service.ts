import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  CommissionRepository,
  COMMISSION_REPOSITORY,
  CreateCommissionRecordData,
  CommissionRecordFilter,
  CommissionSettingsData,
  SellerProductMapping,
} from '../../domain/repositories/commission.repository.interface';

const LOCK_KEY = 'lock:commission-processor';
const LOCK_TTL = 30; // 30 seconds lock
// Cluster-B — instrumentation job name (cron_runs + Prometheus labels).
const CRON_JOB_NAME = 'commission-processor';

@Injectable()
export class CommissionProcessorService {
  private readonly logger = new Logger(CommissionProcessorService.name);
  // Phase 135 — in-process re-entrancy guard. Cheap first line of defence so
  // a slow tick doesn't overlap itself within ONE pod (the Redis lock guards
  // cross-pod; this avoids even acquiring it when we're already mid-tick).
  private isProcessing = false;

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
    // Phase 135 — system audit trail for processor-locked commission.
    private readonly audit: AuditPublicFacade,
    // Cluster-B — cron_runs row + Prometheus metrics per tick. @Global() export
    // from CronObservabilityModule, so no module import is needed.
    private readonly instr: CronInstrumentationService,
  ) {}

  /** `sellerId:productId:variantId` key for the prefetched mapping cache. */
  private mappingKey(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): string {
    return `${sellerId}:${productId}:${variantId ?? ''}`;
  }

  /**
   * Bounded-concurrency runner — processes `items` with at most
   * `concurrency` in flight. Each task is independent (per-sub-order
   * atomic-claim), so this is safe; the cap keeps DB-connection pressure
   * bounded. Tasks must not throw (callers wrap their own try/catch).
   */
  private async runBounded<T>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        await fn(items[idx]!);
      }
    };
    const n = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
  }

  /**
   * Cluster-B — @Cron driver, replacing the prior onModuleInit setInterval
   * (+ its onModuleDestroy cleanup, no longer needed: @nestjs/schedule owns
   * the timer lifecycle and tears it down on shutdown).
   *
   * Phase 3.6 (2026-05-16) — feature-flag gate. Default ON so we don't change
   * production behaviour, but the team can pause the processor without a code
   * change when needed (e.g. during a commission-rule migration, or to
   * investigate a runaway commission row).
   *
   * The existing FENCED Redis lock inside processCommissions() remains the
   * cluster-wide single-runner guard (acquireLockWithToken = the same fenced
   * primitive LeaderElectedCron uses), so we do NOT add a second leader layer
   * here; we only add CronInstrumentationService.wrap for the cron_runs row +
   * Prometheus metrics that the setInterval driver never produced.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (!this.env.getBoolean('COMMISSION_PROCESSOR_ENABLED', true)) {
      // Logged once per tick at debug to avoid noise; the warn on first miss
      // is enough signal in practice. Keep it terse.
      this.logger.debug(
        'CommissionProcessorService disabled via COMMISSION_PROCESSOR_ENABLED=false — skipping tick.',
      );
      return;
    }
    try {
      await this.instr.wrap(CRON_JOB_NAME, () => this.processCommissions());
    } catch {
      // already recorded as FAILED in cron_runs by the wrap
    }
  }

  /* ── Background job: process delivered sub-orders ───────────────── */

  async processCommissions(): Promise<{
    scanned: number;
    processed: number;
    failed: number;
    skippedUnpaidCod?: number;
  }> {
    // Phase 135 — in-process overlap guard. Cheap first line of defence: don't
    // even acquire the Redis lock if this pod is already mid-tick.
    if (this.isProcessing) return { scanned: 0, processed: 0, failed: 0 };
    this.isProcessing = true;
    const startedAt = Date.now();

    // FENCED distributed lock. The plain acquireLock/releaseLock pair had a
    // documented race: a holder whose TTL expired mid-batch could DEL a
    // successor's lock, letting two replicas run concurrently. The token-based
    // pair only deletes the lock if it's still ours (Lua CAS).
    const { acquired, token } = await this.redis.acquireLockWithToken(
      LOCK_KEY,
      LOCK_TTL,
    );
    if (!acquired) {
      this.isProcessing = false;
      return { scanned: 0, processed: 0, failed: 0 }; // Another instance is already processing
    }

    let scanned = 0;
    let processed = 0;
    let failed = 0;
    let skippedUnpaidCod = 0;
    try {
      // Cap the per-tick batch (env-tunable). Successive ticks drain the
      // backlog; the atomic-claim makes cross-tick processing safe.
      const batchSize = this.env.getNumber(
        'COMMISSION_PROCESSOR_BATCH_SIZE',
        200,
      );
      let subOrders =
        await this.commissionRepo.findDeliveredSubOrders(batchSize);
      scanned = subOrders.length;
      if (subOrders.length === 0)
        return { scanned, processed, failed, skippedUnpaidCod };

      // Cluster-B (#2b) — COD cash-in-hand gate. The eligibility scan
      // (findDeliveredSubOrdersPastReturnWindow) admits a DELIVERED COD
      // sub-order the moment its return window closes, REGARDLESS of whether
      // the delivery agent's cash was ever collected — deliverSubOrder sets
      // fulfillmentStatus=DELIVERED but never touches paymentStatus, and no
      // downstream settlement step re-checks COD collection. So commission
      // (and therefore the seller payable) can lock on money the platform may
      // never receive (COD non-payment / RTO-after-delivery). Gated OFF by
      // default because turning it ON shifts settlement timing for every
      // in-flight COD order and is a finance-policy call (see honestCalls); when
      // ON, a COD sub-order is processed only once its paymentStatus=PAID
      // (set by orders.markSubOrderAsPaid on cash collection). ONLINE/prepaid
      // sub-orders are unaffected.
      if (
        this.env.getBoolean('COMMISSION_REQUIRE_COD_PAID', false) &&
        subOrders.length > 0
      ) {
        const masterIds = Array.from(
          new Set(
            (subOrders as any[])
              .map((so) => so.masterOrderId)
              .filter((x): x is string => !!x),
          ),
        );
        const codMasterIds = new Set(
          (
            await this.prisma.masterOrder.findMany({
              where: { id: { in: masterIds }, paymentMethod: 'COD' },
              select: { id: true },
            })
          ).map((m) => m.id),
        );
        if (codMasterIds.size > 0) {
          const before = subOrders.length;
          subOrders = (subOrders as any[]).filter((so) => {
            // Keep non-COD outright; keep COD only when its cash is collected.
            if (!codMasterIds.has(so.masterOrderId)) return true;
            return so.paymentStatus === 'PAID';
          }) as typeof subOrders;
          skippedUnpaidCod = before - subOrders.length;
          if (skippedUnpaidCod > 0) {
            this.logger.log(
              `Commission tick: deferred ${skippedUnpaidCod} delivered COD sub-order(s) awaiting cash collection (COMMISSION_REQUIRE_COD_PAID)`,
            );
          }
        }
        if (subOrders.length === 0)
          return { scanned, processed, failed, skippedUnpaidCod };
      }

      // Fetch the global commission setting once per tick. Used as a fallback
      // when there's no mapping or a mapping leaves no margin so the platform
      // still earns commission on every order.
      const settings = await this.commissionRepo.getCommissionSettings();
      const fallbackRatePercent = Number(settings?.commissionValue ?? 20);

      // Phase 135 — prefetch ALL settlement mappings for the tick in ONE query
      // (kills the per-item N+1: 200 sub-orders × N items was 1 round-trip each).
      const keys = subOrders.flatMap((so: any) =>
        ((so.items ?? []) as any[]).map((it) => ({
          sellerId: so.sellerId,
          productId: it.productId,
          variantId: it.variantId ?? null,
        })),
      );
      const mappings =
        await this.commissionRepo.getSellerProductMappingsBatch(keys);

      // Phase 135 — bounded-parallel processing. Each sub-order is independent
      // (per-sub-order atomic-claim), so concurrency is safe; the cap bounds
      // DB-connection pressure. A failing sub-order is isolated → DLQ + skip,
      // never wedging the batch (or every future tick).
      const concurrency = this.env.getNumber(
        'COMMISSION_PROCESSOR_CONCURRENCY',
        5,
      );
      await this.runBounded(subOrders, concurrency, async (so: any) => {
        try {
          const didProcess = await this.lockSubOrderCommission(
            so,
            fallbackRatePercent,
            'cron',
            mappings,
          );
          if (didProcess) processed++;
        } catch (err) {
          failed++;
          this.logger.error(
            `Commission lock failed for sub-order ${so?.id}; routing to DLQ: ${
              (err as Error)?.message
            }`,
          );
          await this.commissionRepo
            .recordCommissionFailure(
              so.id,
              'cron',
              (err as Error)?.message ?? 'unknown',
            )
            .catch(() => undefined);
        }
      });
    } catch (err) {
      this.logger.error('Commission processing error', err);
    } finally {
      if (token) await this.redis.releaseLockWithToken(LOCK_KEY, token);
      this.isProcessing = false;
      // Phase 135 — per-tick metrics (duration + counts) for observability.
      if (scanned > 0) {
        this.logger.log(
          `Commission tick: scanned=${scanned} processed=${processed} failed=${failed} durationMs=${Date.now() - startedAt}`,
        );
      }
    }
    // Cluster-B — returned to CronInstrumentationService.wrap so the per-tick
    // counts land in the cron_runs.result JSON column (SQL-queryable metric).
    return { scanned, processed, failed, skippedUnpaidCod };
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
    // Phase 135 — settlement mappings prefetched once for the whole tick
    // (kills the per-item N+1). Keyed by sellerId:productId:variantId.
    mappings: Map<string, SellerProductMapping>,
  ): Promise<boolean> {
    const sellerName = so.seller?.sellerShopName || 'Unknown';
    const orderNumber = so.masterOrder.orderNumber;

    const records: CreateCommissionRecordData[] = [];
    // Phase 135 — accumulate per-sub-order event totals as exact Decimals
    // (the record money fields are now strings, so summing them would
    // concatenate; sum the Decimal values instead).
    let totalAdminEarning = new Prisma.Decimal(0);
    let totalSellerEarning = new Prisma.Decimal(0);
    const processedAt = new Date();
    // Phase 136 — stable settlement date: the return window's end if it has
    // already passed (the normal cron case → ≈ createdAt, so cycle assignment
    // is unchanged for prompt runs but CORRECT for a backfill), else now (the
    // immediate/early-lock path, where the window is still open).
    const rwEnd = so.returnWindowEndsAt
      ? new Date(so.returnWindowEndsAt)
      : null;
    const settlableAt = rwEnd && rwEnd < processedAt ? rwEnd : processedAt;

    for (const item of so.items) {
      // Phase 135 — settlement mapping from the prefetched cache (no N+1 query).
      const mapping = mappings.get(
        this.mappingKey(so.sellerId, item.productId, item.variantId),
      );

      // Phase 135 — all money math is exact Prisma.Decimal (columns are
      // Decimal(10,2)). The old Number(...) + Math.round(x*100)/100 collapsed
      // to float first, accumulating paise-level drift at high volume.
      // platformPrice = what the customer paid (OrderItem.unitPrice).
      const platformPrice = new Prisma.Decimal(item.unitPrice);
      const quantity = item.quantity;

      // settlementPrice = what the seller gets per unit. Mapping value if
      // present; otherwise fall back to the CONFIGURED platform rate (no more
      // hardcoded 0.8 magic number — a missing mapping now tracks the global
      // commission setting). A Decimal is always truthy → explicit null-check.
      let settlementPrice: Prisma.Decimal;
      let usedFallbackRate = false;
      if (mapping?.settlementPrice != null) {
        settlementPrice = new Prisma.Decimal(mapping.settlementPrice);
      } else {
        settlementPrice = platformPrice.minus(
          platformPrice.mul(fallbackRatePercent).div(100),
        );
        usedFallbackRate = true;
      }

      // Per-unit margin; if non-positive (mapping left no margin), re-derive
      // from the global rate so every order still earns the platform a commission.
      let unitMargin = platformPrice.minus(settlementPrice);
      if (unitMargin.lte(0)) {
        unitMargin = platformPrice.mul(fallbackRatePercent).div(100);
        settlementPrice = platformPrice.minus(unitMargin);
        usedFallbackRate = true;
      }

      const totalPlatformAmount = platformPrice.mul(quantity);
      const totalSettlementAmount = settlementPrice.mul(quantity);
      const platformMargin = totalPlatformAmount.minus(totalSettlementAmount);

      // Legacy / label fields.
      const totalItemPrice = new Prisma.Decimal(item.totalPrice);
      const ratePct = platformPrice.gt(0)
        ? unitMargin.div(platformPrice).mul(100)
        : new Prisma.Decimal(0);
      const rateLabel = usedFallbackRate
        ? `Platform fee: ${ratePct.toFixed(1)}% (fallback)`
        : `Margin: ${ratePct.toFixed(1)}%`;

      // Persist money as exact 2dp decimal-strings — Prisma's Decimal columns
      // store them losslessly and the dual-write toPaise() parses them
      // exactly (it throws on fractional Numbers).
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
        platformPrice: platformPrice.toFixed(2),
        settlementPrice: settlementPrice.toFixed(2),
        quantity,
        totalPlatformAmount: totalPlatformAmount.toFixed(2),
        totalSettlementAmount: totalSettlementAmount.toFixed(2),
        platformMargin: platformMargin.toFixed(2),
        status: 'PENDING',

        // Legacy fields (mapped from new logic)
        unitPrice: platformPrice.toFixed(2),
        totalPrice: totalItemPrice.toFixed(2),
        commissionType: 'MARGIN_BASED',
        commissionRate: rateLabel,
        unitCommission: unitMargin.toFixed(2),
        totalCommission: platformMargin.toFixed(2),
        adminEarning: platformMargin.toFixed(2),
        productEarning: totalSettlementAmount.toFixed(2),

        // Phase 135 — numeric rate (bps) for analytics + processing provenance.
        commissionRateBps: Number(ratePct.mul(100).toFixed(0)),
        processedAt,
        processedBy: reason,
        // Phase 136 — stable settlement date (see above).
        settlableAt,
      });

      totalAdminEarning = totalAdminEarning.plus(platformMargin);
      totalSellerEarning = totalSellerEarning.plus(totalSettlementAmount);
    }

    // Phase 135 — the commission.locked event is published INSIDE the persist
    // transaction (via the onClaimed hook) so it commits atomically with the
    // records through the transactional outbox, AND only when the claim
    // actually wins (the old post-txn publish fired even on a lost claim).
    const lockedEvent = {
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
        adminEarning: Number(totalAdminEarning.toFixed(2)),
        sellerEarning: Number(totalSellerEarning.toFixed(2)),
        trigger: reason,
      },
    };

    const claimed = await this.commissionRepo.processSubOrderCommission(
      so.id,
      records,
      (tx) => this.eventBus.publish(lockedEvent, { tx }),
    );

    if (!claimed) return false; // lost the claim (already processed / live return)

    this.logger.log(
      `Commission processed for sub-order ${so.id} (order ${so.masterOrder.orderNumber}) [trigger=${reason}]`,
    );

    // Phase 135 — system audit row (one per sub-order), so a unified audit
    // query can reconstruct the timeline without joining commission_records.
    this.audit
      .writeAuditLog({
        actorId: 'system',
        actorRole: 'SYSTEM',
        action: 'commission.locked',
        module: 'commission',
        resource: 'sub_order',
        resourceId: so.id,
        newValue: {
          itemCount: records.length,
          adminEarning: Number(totalAdminEarning.toFixed(2)),
          sellerEarning: Number(totalSellerEarning.toFixed(2)),
          trigger: reason,
        },
      })
      .catch(() => undefined);

    return true;
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

    // Phase 135 — build the (small) mapping cache for this one sub-order's
    // items so lockSubOrderCommission shares the cron's no-N+1 code path.
    const keys = (((so as any).items ?? []) as any[]).map((it) => ({
      sellerId: (so as any).sellerId,
      productId: it.productId,
      variantId: it.variantId ?? null,
    }));
    const mappings =
      await this.commissionRepo.getSellerProductMappingsBatch(keys);

    await this.lockSubOrderCommission(so, fallbackRatePercent, reason, mappings);
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
  async exportCommissionRecords(
    filter: CommissionRecordFilter,
    actor?: { adminId?: string },
  ) {
    const HARD_CAP = 50_000;
    const where: any = {};
    if (filter.sellerId) where.sellerId = filter.sellerId;
    if (filter.status) where.status = filter.status;
    if (filter.commissionType) where.commissionType = filter.commissionType;
    // Phase 140 — export drill-down filters.
    if (filter.subOrderId) where.subOrderId = filter.subOrderId;
    if (filter.productId) where.productId = filter.productId;
    if (filter.adjustedOnly) where.adjustedAt = { not: null };
    if (filter.reversedOnly) where.refundedAdminEarning = { gt: 0 };
    if (filter.settlementStatus) {
      where.sellerSettlement = { status: filter.settlementStatus };
    }
    if (filter.dateFrom || filter.dateTo) {
      // Phase 140 — interpret bare YYYY-MM-DD dates as Asia/Kolkata day
      // boundaries (IST has no DST → fixed +05:30), not server-local time, so
      // "2026-05-22" means the whole IST calendar day. Full ISO strings with an
      // explicit offset are respected verbatim.
      where.createdAt = {};
      if (filter.dateFrom) where.createdAt.gte = this.toIstBoundary(filter.dateFrom, 'start');
      if (filter.dateTo) where.createdAt.lte = this.toIstBoundary(filter.dateTo, 'end');
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
        // Phase 140 — resolve the adjusting admin's name so the CSV shows a
        // human name, not a raw UUID (FK added in Phase 138).
        adjustedByAdmin: { select: { name: true, email: true } },
      },
    });
    const truncated = total > rows.length;

    // Phase 140 — forensic trail: a bulk export of seller financials + dispute
    // reasons must leave an audit row (who, when, what filter, how many rows).
    // Best-effort so the audit subsystem can't block an authorised read.
    if (actor?.adminId) {
      this.audit
        .writeAuditLog({
          actorId: actor.adminId,
          actorRole: 'ADMIN',
          action: 'commission.exported',
          module: 'commission',
          resource: 'commission_records',
          resourceId: 'bulk-export',
          newValue: {
            rowCount: rows.length,
            total,
            truncated,
            filters: {
              sellerId: filter.sellerId ?? null,
              status: filter.status ?? null,
              commissionType: filter.commissionType ?? null,
              settlementStatus: filter.settlementStatus ?? null,
              subOrderId: filter.subOrderId ?? null,
              productId: filter.productId ?? null,
              adjustedOnly: filter.adjustedOnly ?? false,
              reversedOnly: filter.reversedOnly ?? false,
              dateFrom: filter.dateFrom ?? null,
              dateTo: filter.dateTo ?? null,
              search: filter.search ?? null,
            },
          },
        })
        .catch((e) =>
          this.logger.error(`Failed to audit commission export: ${e}`),
        );
    }

    return { rows, total, truncated };
  }

  /**
   * Phase 140 — turn a date filter into a UTC instant at the Asia/Kolkata day
   * boundary. A bare YYYY-MM-DD is treated as IST midnight (start) or
   * 23:59:59.999 IST (end); any string carrying its own time/offset is parsed
   * as-is. IST has no daylight saving, so the fixed +05:30 offset is exact.
   */
  private toIstBoundary(input: string, edge: 'start' | 'end'): Date {
    const IST = '+05:30';
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      return new Date(
        `${input}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}${IST}`,
      );
    }
    return new Date(input);
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

    // Phase 137 — admin hold/resume events (commission_hold_history) + the
    // system return-driven freeze/unfreeze (audit_logs keyed on the sub-order).
    const holdEvents = await this.prisma.commissionHoldHistory.findMany({
      where: { commissionRecordId: recordId },
      orderBy: { createdAt: 'asc' },
    });
    const systemHoldAudits = await this.prisma.auditLog.findMany({
      where: {
        resource: 'sub_order',
        resourceId: record.subOrderId,
        action: { in: ['commission.frozen', 'commission.reversed'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Phase 138 — every manual adjustment (the single adjustedAt/adjustmentReason
    // columns only hold the LATEST; this table preserves all of them).
    const adjustments = await this.prisma.commissionAdjustmentHistory.findMany({
      where: { commissionRecordId: recordId },
      orderBy: { createdAt: 'asc' },
    });

    // Phase 139 — settlement linkage surfaced as a SETTLED timeline event (the
    // cycle payout flip was otherwise invisible here). Derived from the join
    // (audit option b) — the linkage already exists, so no new write path.
    const settlement = record.settlementId
      ? await this.prisma.sellerSettlement.findUnique({
          where: { id: record.settlementId },
          select: { id: true, paidAt: true, utrReference: true, status: true },
        })
      : null;

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
        }
      | {
          type: 'HOLD_EVENT';
          at: Date;
          action: string; // HOLD | RESUME | SYSTEM_FREEZE | SYSTEM_UNFREEZE
          actorType: string; // ADMIN | SYSTEM
          actorId: string | null;
          fromStatus: string | null;
          toStatus: string | null;
          reason: string | null;
        }
      | {
          type: 'SETTLED';
          at: Date;
          settlementId: string;
          utrReference: string | null;
          settlementStatus: string;
          note: string;
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
    for (const h of holdEvents) {
      timeline.push({
        type: 'HOLD_EVENT',
        at: h.createdAt,
        action: h.action,
        actorType: h.actorType,
        actorId: h.actorId,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        reason: h.reason,
      });
    }
    for (const a of systemHoldAudits) {
      timeline.push({
        type: 'HOLD_EVENT',
        at: a.createdAt,
        action:
          a.action === 'commission.frozen' ? 'SYSTEM_FREEZE' : 'SYSTEM_UNFREEZE',
        actorType: 'SYSTEM',
        actorId: null,
        fromStatus: null,
        toStatus: null,
        reason: (a.newValue as any)?.reason ?? null,
      });
    }
    if (adjustments.length > 0) {
      // Each row carries its own from→to, so a record adjusted N times shows N
      // events with the correct deltas (not just the latest).
      for (const adj of adjustments) {
        timeline.push({
          type: 'MANUAL_ADJUSTMENT',
          at: adj.createdAt,
          adminId: adj.adminId,
          previousAdminEarning: Number(adj.fromAdminEarning),
          newAdminEarning: Number(adj.toAdminEarning),
          reason: adj.reason,
        });
      }
    } else if (record.adjustedAt) {
      // Fallback for records adjusted before Phase 138 (no history row exists);
      // surfaces the single-column snapshot so their one adjustment isn't lost.
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

    // Phase 139 — surface the payout as a SETTLED event when the linked
    // settlement has actually been paid (paidAt set). A record merely attached
    // to a not-yet-paid cycle is still PENDING, so no event until money moves.
    if (settlement?.paidAt) {
      timeline.push({
        type: 'SETTLED',
        at: settlement.paidAt,
        settlementId: settlement.id,
        utrReference: settlement.utrReference,
        settlementStatus: settlement.status,
        note: `Paid out via settlement ${settlement.id}`,
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
        settlementId: record.settlementId,
      },
      reversalCount: reversals.length,
      netAdminEarning:
        Math.round(
          (Number(record.adminEarning) - Number(record.refundedAdminEarning)) *
            100,
        ) / 100,
      timeline,
      // Phase 139 — the timeline is assembled at read time across five sources
      // (record + reversals + hold-history + audit_logs + adjustments), so it's
      // eventually consistent: a write landing mid-read shows on the next fetch.
      // This stamps the read moment so operators know the snapshot's freshness.
      generatedAt: new Date().toISOString(),
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
    // Phase 138 — reason: min 3, max 2000, HTML-stripped (so a value rendered
    // into a non-React surface — CSV / email — can't carry markup).
    const trimmed = input.reason?.trim();
    if (!trimmed || trimmed.length < 3) {
      throw new BadRequestAppException(
        'A reason (min 3 chars) is required for every manual adjustment.',
      );
    }
    if (trimmed.length > 2000) {
      throw new BadRequestAppException('reason must be at most 2000 characters.');
    }
    const safeReason = trimmed.replace(/<[^>]*>/g, '').trim();
    if (safeReason.length < 3) {
      throw new BadRequestAppException(
        'A reason with at least 3 characters of text is required.',
      );
    }

    if (input.newAdminEarning == null || !Number.isFinite(input.newAdminEarning)) {
      throw new BadRequestAppException('newAdminEarning must be a number.');
    }
    const newEarning = new Prisma.Decimal(
      (Math.round(input.newAdminEarning * 100) / 100).toFixed(2),
    );
    if (newEarning.lt(0)) {
      throw new BadRequestAppException('newAdminEarning cannot be negative');
    }

    // Phase 138 — the whole flow is now ONE transaction: re-read + re-validate
    // + optimistic-lock CAS update + history row + outbox event, all atomic.
    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.commissionRecord.findUnique({
        where: { id: recordId },
      });
      if (!record) throw new NotFoundAppException('Commission record not found');

      if (record.status === 'SETTLED') {
        throw new BadRequestAppException(
          'Record is already SETTLED. Use the reversal flow to recover funds; this endpoint only adjusts pre-settlement records.',
        );
      }
      if (record.status === 'REFUNDED') {
        throw new BadRequestAppException('Record is REFUNDED and cannot be adjusted.');
      }
      // Even a PENDING/ON_HOLD record can sit inside an APPROVED/PAID
      // settlement or cycle — editing it would silently drift approved totals.
      if (record.settlementId) {
        const settlement = await tx.sellerSettlement.findUnique({
          where: { id: record.settlementId },
          select: { status: true, cycleId: true },
        });
        if (
          settlement &&
          (settlement.status === 'APPROVED' || settlement.status === 'PAID')
        ) {
          throw new BadRequestAppException(
            `Record belongs to a SellerSettlement in ${settlement.status} state; totals on an approved cycle are frozen. Use the reversal flow instead.`,
          );
        }
        if (settlement?.cycleId) {
          const cycle = await tx.settlementCycle.findUnique({
            where: { id: settlement.cycleId },
            select: { status: true },
          });
          if (cycle && (cycle.status === 'APPROVED' || cycle.status === 'PAID')) {
            throw new BadRequestAppException(
              `Settlement cycle is in ${cycle.status} state; records in an approved cycle are frozen. Use the reversal flow.`,
            );
          }
        }
      }

      // Phase 138 — the platform can't earn more than the customer paid for the
      // line; cap the override at the order's platform amount.
      const totalPlatformAmount = new Prisma.Decimal(record.totalPlatformAmount);
      if (newEarning.gt(totalPlatformAmount)) {
        throw new BadRequestAppException(
          `newAdminEarning (₹${newEarning.toFixed(2)}) cannot exceed the order's platform amount (₹${totalPlatformAmount.toFixed(2)}).`,
        );
      }

      // Phase 138 — keep the row-math invariant intact:
      //   totalPlatformAmount = platformMargin + totalSettlementAmount.
      // Overriding the platform's earning reallocates the delta to the seller's
      // payable (money is conserved within the order total), so a lowered
      // commission means a higher seller settlement. productEarning mirrors
      // totalSettlementAmount (the processor writes them equal).
      const newSettlement = totalPlatformAmount.minus(newEarning);

      const previousAdminEarning = new Prisma.Decimal(record.adminEarning);
      const previousPlatformMargin = new Prisma.Decimal(record.platformMargin);
      // Preserve the processor's original earning on the FIRST adjustment only.
      const preserveOriginal =
        record.originalAdminEarning == null ? record.adminEarning : undefined;

      // Optimistic-lock CAS: (id, version, non-terminal status). A concurrent
      // adjust that already bumped version → count 0 → 409 (no last-write-wins).
      const claim = await tx.commissionRecord.updateMany({
        where: {
          id: recordId,
          version: record.version,
          status: { notIn: ['SETTLED', 'REFUNDED'] },
        },
        data: this.moneyDualWrite.applyPaise('commissionRecord', {
          adminEarning: newEarning.toFixed(2),
          platformMargin: newEarning.toFixed(2),
          productEarning: newSettlement.toFixed(2),
          totalSettlementAmount: newSettlement.toFixed(2),
          isAdjusted: true,
          adjustedBy: input.adminId,
          adjustedAt: new Date(),
          adjustmentReason: safeReason,
          version: { increment: 1 },
          ...(preserveOriginal !== undefined
            ? { originalAdminEarning: preserveOriginal }
            : {}),
        }),
      });
      if (claim.count === 0) {
        throw new ConflictAppException(
          'Commission record changed concurrently — reload and retry.',
        );
      }

      // One immutable history row per adjustment (the single columns only keep
      // the latest; this preserves every from→to).
      await tx.commissionAdjustmentHistory.create({
        data: {
          commissionRecordId: recordId,
          fromAdminEarning: previousAdminEarning.toFixed(2),
          toAdminEarning: newEarning.toFixed(2),
          fromPlatformMargin: previousPlatformMargin.toFixed(2),
          toPlatformMargin: newEarning.toFixed(2),
          adminId: input.adminId,
          reason: safeReason,
        },
      });

      // Transactional outbox — the event commits atomically with the adjustment
      // (was previously a fire-and-forget .catch()).
      await this.eventBus.publish(
        {
          eventName: 'commission.record_adjusted',
          aggregate: 'CommissionRecord',
          aggregateId: recordId,
          occurredAt: new Date(),
          payload: {
            recordId,
            sellerId: record.sellerId,
            orderNumber: record.orderNumber,
            adminId: input.adminId,
            reason: safeReason,
            previousAdminEarning: previousAdminEarning.toNumber(),
            newAdminEarning: newEarning.toNumber(),
          },
        },
        { tx },
      );

      return tx.commissionRecord.findUnique({ where: { id: recordId } });
    });

    // Cross-system audit row (best-effort; the dedicated columns + history table
    // are the authoritative trail). Settlement/freeze already write audit_logs;
    // this brings manual-adjust into the unified audit query too.
    this.audit
      .writeAuditLog({
        actorId: input.adminId,
        actorRole: 'ADMIN',
        action: 'commission.adjusted',
        module: 'commission',
        resource: 'commission_record',
        resourceId: recordId,
        newValue: { newAdminEarning: newEarning.toNumber(), reason: safeReason },
      })
      .catch(() => undefined);

    this.logger.log(
      `Commission record ${recordId} adjusted by admin ${input.adminId} → ₹${newEarning.toFixed(2)}`,
    );

    return updated;
  }

  /* ── Admin: hold / resume (fraud-suspicion / operational review) ── */

  /**
   * Phase 137 — place a commission record ON_HOLD so it's excluded from
   * settlement. Distinct from the system return-driven freeze: this is an
   * explicit ADMIN action (heldByAdminId is stamped), reversible via
   * resumeCommissionRecord. Only a PENDING, NOT-yet-cycled record can be held —
   * a record already attached to a settlement (settlementId set) must be acted
   * on at the cycle level, else its amount would desync the cycle totals
   * (double-pay risk). Transitions are CAS-guarded so a concurrent settle /
   * system-freeze can't be silently lost.
   */
  async holdCommissionRecord(
    recordId: string,
    adminId: string,
    holdReason: string,
  ) {
    // Phase 139 — strip HTML so a reason rendered into a non-React surface
    // (CSV / email) can't carry markup, then enforce the length floor.
    const reason = (holdReason ?? '').replace(/<[^>]*>/g, '').trim();
    if (!reason || reason.length < 5) {
      throw new BadRequestAppException(
        'holdReason (min 5 chars) is required to hold a commission record.',
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.commissionRecord.findUnique({
        where: { id: recordId },
      });
      if (!record) throw new NotFoundAppException('Commission record not found');
      if (record.status !== 'PENDING') {
        throw new BadRequestAppException(
          `Cannot hold a commission record in ${record.status} state — only PENDING records can be held.`,
        );
      }
      if (record.settlementId) {
        throw new BadRequestAppException(
          'Record is already attached to a settlement cycle; act on the cycle instead of holding the record.',
        );
      }
      // CAS on the exact source state (PENDING + not cycled).
      const claim = await tx.commissionRecord.updateMany({
        where: { id: recordId, status: 'PENDING', settlementId: null },
        data: {
          status: 'ON_HOLD',
          previousStatus: 'PENDING',
          heldByAdminId: adminId,
          heldAt: new Date(),
          holdReason: reason,
        },
      });
      if (claim.count === 0) {
        throw new ConflictAppException(
          'Commission record changed state concurrently — reload and retry.',
        );
      }
      await tx.commissionHoldHistory.create({
        data: {
          commissionRecordId: recordId,
          action: 'HOLD',
          actorType: 'ADMIN',
          actorId: adminId,
          fromStatus: 'PENDING',
          toStatus: 'ON_HOLD',
          reason,
        },
      });
      // Transactional outbox — the event commits atomically with the hold.
      await this.eventBus.publish(
        {
          eventName: 'commission.held',
          aggregate: 'CommissionRecord',
          aggregateId: recordId,
          occurredAt: new Date(),
          payload: {
            recordId,
            sellerId: record.sellerId,
            orderNumber: record.orderNumber,
            heldByAdminId: adminId,
            holdReason: reason,
          },
        },
        { tx },
      );
      return tx.commissionRecord.findUnique({ where: { id: recordId } });
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'commission.held',
        module: 'commission',
        resource: 'commission_record',
        resourceId: recordId,
        newValue: { holdReason: reason },
      })
      .catch(() => undefined);
    this.logger.log(
      `Commission record ${recordId} held by admin ${adminId}: ${reason}`,
    );
    return updated;
  }

  /**
   * Phase 137 — resume an ADMIN-held record back to its previous state. Only
   * admin holds (heldByAdminId set) can be resumed here; a system return-driven
   * freeze is lifted by the returns flow when the return is rejected, never by
   * this endpoint.
   */
  async resumeCommissionRecord(
    recordId: string,
    adminId: string,
    resumeReason?: string,
  ) {
    // Phase 139 — strip HTML from the optional resume reason (CSV/email safety).
    const reason = (resumeReason ?? '').replace(/<[^>]*>/g, '').trim() || null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.commissionRecord.findUnique({
        where: { id: recordId },
      });
      if (!record) throw new NotFoundAppException('Commission record not found');
      if (record.status !== 'ON_HOLD') {
        throw new BadRequestAppException(
          `Cannot resume a commission record in ${record.status} state — only ON_HOLD records can be resumed.`,
        );
      }
      if (!record.heldByAdminId) {
        throw new BadRequestAppException(
          'This record was frozen by the system (a return is in progress), not an admin hold; it resumes automatically when the return is resolved.',
        );
      }
      const target = record.previousStatus ?? 'PENDING';
      const claim = await tx.commissionRecord.updateMany({
        // heldByAdminId guard → never resume a system freeze through this path.
        where: { id: recordId, status: 'ON_HOLD', heldByAdminId: { not: null } },
        data: {
          status: target,
          previousStatus: null,
          heldByAdminId: null,
          heldAt: null,
          holdReason: null,
          resumedByAdminId: adminId,
          resumedAt: new Date(),
          resumeReason: reason,
        },
      });
      if (claim.count === 0) {
        throw new ConflictAppException(
          'Commission record changed state concurrently — reload and retry.',
        );
      }
      await tx.commissionHoldHistory.create({
        data: {
          commissionRecordId: recordId,
          action: 'RESUME',
          actorType: 'ADMIN',
          actorId: adminId,
          fromStatus: 'ON_HOLD',
          toStatus: target,
          reason: reason ?? 'admin resume',
        },
      });
      await this.eventBus.publish(
        {
          eventName: 'commission.resumed',
          aggregate: 'CommissionRecord',
          aggregateId: recordId,
          occurredAt: new Date(),
          payload: {
            recordId,
            sellerId: record.sellerId,
            orderNumber: record.orderNumber,
            resumedByAdminId: adminId,
            resumeReason: reason,
            restoredTo: target,
          },
        },
        { tx },
      );
      return tx.commissionRecord.findUnique({ where: { id: recordId } });
    });

    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'commission.resumed',
        module: 'commission',
        resource: 'commission_record',
        resourceId: recordId,
        newValue: { resumeReason: reason },
      })
      .catch(() => undefined);
    this.logger.log(`Commission record ${recordId} resumed by admin ${adminId}`);
    return updated;
  }
}
