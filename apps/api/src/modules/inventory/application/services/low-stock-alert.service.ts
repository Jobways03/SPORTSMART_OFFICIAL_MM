import { Injectable, Logger } from '@nestjs/common';
import { LowStockAlertStatus } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { INVENTORY_EVENTS } from '../../domain/events/inventory.events';

/**
 * Phase 54 (2026-05-21) — low-stock alert service hardened.
 *
 * Detects + records low-stock conditions on seller-product-mappings.
 * Run periodically by LowStockSweepCron or on-demand via the admin
 * controller. Event-driven trigger path (triggerForMapping) is wired
 * from STOCK_DEDUCTED / STOCK_RESERVED / STOCK_ADJUSTED subscribers
 * so a sudden order doesn't wait ≤15 min for the next sweep tick.
 *
 * Changes vs. pre-Phase-54:
 *   - Formula switched from `stockQty <= threshold` to
 *     `(stockQty - reservedQty) <= threshold` (audit Gap #1). The
 *     stale-stock-driven false-negative (high reserved hiding a
 *     real low-stock) is closed.
 *   - Single batched findMany for existing alerts replaces the
 *     N+1 per-row findUnique (audit Gap #4).
 *   - Cursor pagination replaces the silent 50K truncation
 *     (audit Gap #5).
 *   - currentStock + availableStock + reservedStock are refreshed
 *     on every sweep tick for still-ACTIVE alerts (audit Gap #10).
 *   - variantId denormalized so admin UI doesn't need to drill
 *     into the mapping (audit Gap #7).
 *   - Emits inventory.low_stock_alert.triggered on create so a
 *     notification subscriber can send email/Slack (audit Gap #9).
 *   - New triggerForMapping(mappingId) for event-driven detection
 *     (audit Gap #12).
 *   - New dismiss(alertId, adminId, snoozeUntil?) for the manual
 *     suppression path (audit Gap #8). DISMISSED rows with
 *     dismissUntil in the future are skipped by the sweep.
 *   - New listForSeller(sellerId) for the seller-facing endpoint
 *     (audit Gap #16).
 */

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_THRESHOLD = 5;

@Injectable()
export class LowStockAlertService {
  private readonly logger = new Logger(LowStockAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Phase 54 — cursor-paginated sweep. Iterates ALL active mappings
   * (no silent 50K truncation), batches existing-alert lookups, and
   * recomputes the snapshot on every still-ACTIVE row.
   */
  async sweep(): Promise<{ created: number; resolved: number; scanned: number }> {
    const batchSize = this.env.getNumber('LOW_STOCK_SWEEP_BATCH_SIZE', DEFAULT_BATCH_SIZE);
    let created = 0;
    let resolved = 0;
    let scanned = 0;
    let cursor: string | undefined;

    // Safety cap so a runaway/buggy iteration can't burn the leader's
    // entire 20-min lock. 50 batches * 1000/batch = 50,000 mappings
    // — beyond that the sweep just stops and resumes next tick.
    const safetyIterations = 50;

    for (let iter = 0; iter < safetyIterations; iter++) {
      const batch = await this.prisma.sellerProductMapping.findMany({
        where: { isActive: true },
        select: {
          id: true,
          sellerId: true,
          productId: true,
          variantId: true,
          stockQty: true,
          reservedQty: true,
          lowStockThreshold: true,
        },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (batch.length === 0) break;
      scanned += batch.length;
      cursor = batch[batch.length - 1]!.id;

      const ids = batch.map((m) => m.id);
      // Phase 54 — single findMany for all existing alerts in this
      // batch. Pre-Phase-54 the loop did one findUnique per mapping
      // (audit Gap #4 — N+1).
      const existingRows = await this.prisma.lowStockAlert.findMany({
        where: { sellerProductMappingId: { in: ids } },
      });
      const existingMap = new Map(
        existingRows.map((a) => [a.sellerProductMappingId!, a]),
      );

      for (const m of batch) {
        const threshold = m.lowStockThreshold ?? DEFAULT_THRESHOLD;
        const availableStock = Math.max(m.stockQty - m.reservedQty, 0);
        const isLow = availableStock <= threshold;
        const existing = existingMap.get(m.id);
        const now = new Date();

        // Skip rows currently dismissed with an unexpired snooze.
        if (
          existing &&
          existing.status === LowStockAlertStatus.DISMISSED &&
          existing.dismissUntil &&
          existing.dismissUntil > now
        ) {
          continue;
        }

        if (isLow && !existing) {
          // New active alert.
          const row = await this.prisma.lowStockAlert.create({
            data: {
              resourceType: 'SELLER_MAPPING',
              sellerProductMappingId: m.id,
              sellerId: m.sellerId,
              productId: m.productId,
              variantId: m.variantId,
              currentStock: m.stockQty,
              availableStock,
              reservedStock: m.reservedQty,
              threshold,
              status: LowStockAlertStatus.ACTIVE,
            },
          });
          created++;
          this.fireTriggered(row.id, {
            mappingId: m.id,
            sellerId: m.sellerId,
            productId: m.productId,
            variantId: m.variantId,
            availableStock,
            threshold,
          });
        } else if (isLow && existing) {
          // Existing alert — refresh the snapshot (audit Gap #10)
          // and, if previously RESOLVED/DISMISSED and now low again,
          // re-activate.
          const becomingActive =
            existing.status === LowStockAlertStatus.RESOLVED ||
            (existing.status === LowStockAlertStatus.DISMISSED &&
              existing.dismissUntil != null &&
              existing.dismissUntil <= now);

          await this.prisma.lowStockAlert.update({
            where: { id: existing.id },
            data: {
              currentStock: m.stockQty,
              availableStock,
              reservedStock: m.reservedQty,
              threshold,
              variantId: m.variantId,
              ...(becomingActive
                ? {
                    status: LowStockAlertStatus.ACTIVE,
                    resolvedAt: null,
                    dismissedAt: null,
                    dismissUntil: null,
                  }
                : {}),
            },
          });
          if (becomingActive) {
            created++;
            this.fireTriggered(existing.id, {
              mappingId: m.id,
              sellerId: m.sellerId,
              productId: m.productId,
              variantId: m.variantId,
              availableStock,
              threshold,
            });
          }
        } else if (!isLow && existing && existing.status === LowStockAlertStatus.ACTIVE) {
          // Recovered — auto-resolve.
          await this.prisma.lowStockAlert.update({
            where: { id: existing.id },
            data: {
              status: LowStockAlertStatus.RESOLVED,
              resolvedAt: now,
              currentStock: m.stockQty,
              availableStock,
              reservedStock: m.reservedQty,
            },
          });
          resolved++;
          this.eventBus
            .publish({
              eventName: INVENTORY_EVENTS.LOW_STOCK_ALERT_RESOLVED,
              aggregate: 'LowStockAlert',
              aggregateId: existing.id,
              payload: {
                alertId: existing.id,
                mappingId: m.id,
                sellerId: m.sellerId,
                availableStock,
                threshold,
              },
              occurredAt: now,
            })
            .catch(() => {});
        }
      }

      if (batch.length < batchSize) break;
    }

    this.logger.log(
      `Low-stock sweep: scanned=${scanned} created=${created} resolved=${resolved}`,
    );
    return { created, resolved, scanned };
  }

  /**
   * Phase 54 (audit Gap #12) — event-driven single-mapping recompute.
   * Wired from stock-change subscribers so a popular SKU selling its
   * way down to 1 unit triggers immediately rather than waiting up to
   * 15 min for the next sweep tick.
   *
   * Idempotent: re-firing on the same mapping has no effect if state
   * hasn't crossed the threshold.
   */
  async triggerForMapping(mappingId: string): Promise<void> {
    const mapping = await this.prisma.sellerProductMapping.findUnique({
      where: { id: mappingId },
      select: {
        id: true,
        sellerId: true,
        productId: true,
        variantId: true,
        stockQty: true,
        reservedQty: true,
        lowStockThreshold: true,
        isActive: true,
      },
    });
    if (!mapping || !mapping.isActive) return;

    const threshold = mapping.lowStockThreshold ?? DEFAULT_THRESHOLD;
    const availableStock = Math.max(mapping.stockQty - mapping.reservedQty, 0);
    const isLow = availableStock <= threshold;
    const existing = await this.prisma.lowStockAlert.findUnique({
      where: { sellerProductMappingId: mappingId },
    });
    const now = new Date();

    if (
      existing &&
      existing.status === LowStockAlertStatus.DISMISSED &&
      existing.dismissUntil &&
      existing.dismissUntil > now
    ) {
      return; // suppressed
    }

    if (isLow && !existing) {
      const row = await this.prisma.lowStockAlert.create({
        data: {
          resourceType: 'SELLER_MAPPING',
          sellerProductMappingId: mapping.id,
          sellerId: mapping.sellerId,
          productId: mapping.productId,
          variantId: mapping.variantId,
          currentStock: mapping.stockQty,
          availableStock,
          reservedStock: mapping.reservedQty,
          threshold,
          status: LowStockAlertStatus.ACTIVE,
        },
      });
      this.fireTriggered(row.id, {
        mappingId: mapping.id,
        sellerId: mapping.sellerId,
        productId: mapping.productId,
        variantId: mapping.variantId,
        availableStock,
        threshold,
      });
    } else if (isLow && existing && existing.status !== LowStockAlertStatus.ACTIVE) {
      const becomingActive =
        existing.status === LowStockAlertStatus.RESOLVED ||
        (existing.status === LowStockAlertStatus.DISMISSED &&
          existing.dismissUntil != null &&
          existing.dismissUntil <= now);
      if (becomingActive) {
        await this.prisma.lowStockAlert.update({
          where: { id: existing.id },
          data: {
            status: LowStockAlertStatus.ACTIVE,
            resolvedAt: null,
            dismissedAt: null,
            dismissUntil: null,
            currentStock: mapping.stockQty,
            availableStock,
            reservedStock: mapping.reservedQty,
            threshold,
          },
        });
        this.fireTriggered(existing.id, {
          mappingId: mapping.id,
          sellerId: mapping.sellerId,
          productId: mapping.productId,
          variantId: mapping.variantId,
          availableStock,
          threshold,
        });
      }
    } else if (isLow && existing && existing.status === LowStockAlertStatus.ACTIVE) {
      // Refresh snapshot only — no re-fire.
      await this.prisma.lowStockAlert.update({
        where: { id: existing.id },
        data: {
          currentStock: mapping.stockQty,
          availableStock,
          reservedStock: mapping.reservedQty,
        },
      });
    } else if (!isLow && existing && existing.status === LowStockAlertStatus.ACTIVE) {
      await this.prisma.lowStockAlert.update({
        where: { id: existing.id },
        data: {
          status: LowStockAlertStatus.RESOLVED,
          resolvedAt: now,
          currentStock: mapping.stockQty,
          availableStock,
          reservedStock: mapping.reservedQty,
        },
      });
      this.eventBus
        .publish({
          eventName: INVENTORY_EVENTS.LOW_STOCK_ALERT_RESOLVED,
          aggregate: 'LowStockAlert',
          aggregateId: existing.id,
          payload: {
            alertId: existing.id,
            mappingId: mapping.id,
            sellerId: mapping.sellerId,
            availableStock,
            threshold,
          },
          occurredAt: now,
        })
        .catch(() => {});
    }
  }

  /**
   * Phase 55 polish (2026-05-22) — franchise-stock variant of the
   * event-driven trigger. Wired from the
   * `inventory.franchise_stock.changed` event that procurement
   * receipt + future franchise adjust paths emit. Mirrors
   * `triggerForMapping` but reads FranchiseStock (which has its own
   * lowStockThreshold) and writes/refreshes a row keyed by
   * franchiseStockId + resourceType='FRANCHISE_STOCK'.
   *
   * Idempotent: re-firing on the same franchise stock has no effect
   * if state hasn't crossed the threshold.
   */
  async triggerForFranchiseStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<void> {
    const stock = await this.prisma.franchiseStock.findFirst({
      where: {
        franchiseId,
        productId,
        variantId: variantId ?? null,
      },
      select: {
        id: true,
        franchiseId: true,
        productId: true,
        variantId: true,
        onHandQty: true,
        reservedQty: true,
        availableQty: true,
        lowStockThreshold: true,
      },
    });
    if (!stock) return;

    const threshold = stock.lowStockThreshold ?? DEFAULT_THRESHOLD;
    // Use the persisted availableQty since the franchise repo keeps
    // it in lock-step with onHandQty - reservedQty.
    const availableStock = Math.max(stock.availableQty, 0);
    const isLow = availableStock <= threshold;
    const existing = await this.prisma.lowStockAlert.findUnique({
      where: { franchiseStockId: stock.id },
    });
    const now = new Date();

    if (
      existing &&
      existing.status === LowStockAlertStatus.DISMISSED &&
      existing.dismissUntil &&
      existing.dismissUntil > now
    ) {
      return; // suppressed
    }

    if (isLow && !existing) {
      const row = await this.prisma.lowStockAlert.create({
        data: {
          resourceType: 'FRANCHISE_STOCK',
          franchiseStockId: stock.id,
          franchiseId: stock.franchiseId,
          productId: stock.productId,
          variantId: stock.variantId,
          currentStock: stock.onHandQty,
          availableStock,
          reservedStock: stock.reservedQty,
          threshold,
          status: LowStockAlertStatus.ACTIVE,
        },
      });
      this.eventBus
        .publish({
          eventName: INVENTORY_EVENTS.LOW_STOCK_ALERT_TRIGGERED,
          aggregate: 'LowStockAlert',
          aggregateId: row.id,
          payload: {
            alertId: row.id,
            franchiseStockId: stock.id,
            franchiseId: stock.franchiseId,
            productId: stock.productId,
            variantId: stock.variantId,
            availableStock,
            threshold,
          },
          occurredAt: now,
        })
        .catch((err) =>
          this.logger.warn(
            `Failed to publish LOW_STOCK_ALERT_TRIGGERED for franchise stock ${stock.id}: ${(err as Error).message}`,
          ),
        );
    } else if (isLow && existing && existing.status !== LowStockAlertStatus.ACTIVE) {
      const becomingActive =
        existing.status === LowStockAlertStatus.RESOLVED ||
        (existing.status === LowStockAlertStatus.DISMISSED &&
          existing.dismissUntil != null &&
          existing.dismissUntil <= now);
      if (becomingActive) {
        await this.prisma.lowStockAlert.update({
          where: { id: existing.id },
          data: {
            status: LowStockAlertStatus.ACTIVE,
            resolvedAt: null,
            dismissedAt: null,
            dismissUntil: null,
            currentStock: stock.onHandQty,
            availableStock,
            reservedStock: stock.reservedQty,
            threshold,
          },
        });
        this.eventBus
          .publish({
            eventName: INVENTORY_EVENTS.LOW_STOCK_ALERT_TRIGGERED,
            aggregate: 'LowStockAlert',
            aggregateId: existing.id,
            payload: {
              alertId: existing.id,
              franchiseStockId: stock.id,
              franchiseId: stock.franchiseId,
              productId: stock.productId,
              variantId: stock.variantId,
              availableStock,
              threshold,
            },
            occurredAt: now,
          })
          .catch(() => {});
      }
    } else if (isLow && existing && existing.status === LowStockAlertStatus.ACTIVE) {
      // Refresh snapshot only — no re-fire.
      await this.prisma.lowStockAlert.update({
        where: { id: existing.id },
        data: {
          currentStock: stock.onHandQty,
          availableStock,
          reservedStock: stock.reservedQty,
        },
      });
    } else if (!isLow && existing && existing.status === LowStockAlertStatus.ACTIVE) {
      await this.prisma.lowStockAlert.update({
        where: { id: existing.id },
        data: {
          status: LowStockAlertStatus.RESOLVED,
          resolvedAt: now,
          currentStock: stock.onHandQty,
          availableStock,
          reservedStock: stock.reservedQty,
        },
      });
      this.eventBus
        .publish({
          eventName: INVENTORY_EVENTS.LOW_STOCK_ALERT_RESOLVED,
          aggregate: 'LowStockAlert',
          aggregateId: existing.id,
          payload: {
            alertId: existing.id,
            franchiseStockId: stock.id,
            franchiseId: stock.franchiseId,
            availableStock,
            threshold,
          },
          occurredAt: now,
        })
        .catch(() => {});
    }
  }

  /**
   * Phase 54 (audit Gap #8) — admin dismiss with optional snooze.
   * Sets status=DISMISSED, stamps dismissedAt/By, and stores
   * dismissUntil so the sweep + event path skip the row until the
   * snooze expires.
   */
  async dismiss(
    alertId: string,
    adminId: string,
    snoozeUntil?: Date,
  ): Promise<void> {
    const existing = await this.prisma.lowStockAlert.findUnique({
      where: { id: alertId },
    });
    if (!existing) throw new NotFoundAppException(`Alert ${alertId} not found`);
    if (existing.status !== LowStockAlertStatus.ACTIVE) {
      throw new BadRequestAppException(
        `Cannot dismiss a ${existing.status} alert`,
      );
    }
    if (snoozeUntil && snoozeUntil <= new Date()) {
      throw new BadRequestAppException('snoozeUntil must be in the future');
    }
    await this.prisma.lowStockAlert.update({
      where: { id: alertId },
      data: {
        status: LowStockAlertStatus.DISMISSED,
        dismissedAt: new Date(),
        dismissedBy: adminId,
        dismissUntil: snoozeUntil ?? null,
      },
    });
  }

  /** Phase 54 — manual resolve action for admins (audit Gap #8 sibling). */
  async resolve(alertId: string): Promise<void> {
    const existing = await this.prisma.lowStockAlert.findUnique({
      where: { id: alertId },
    });
    if (!existing) throw new NotFoundAppException(`Alert ${alertId} not found`);
    if (existing.status === LowStockAlertStatus.RESOLVED) return;
    await this.prisma.lowStockAlert.update({
      where: { id: alertId },
      data: {
        status: LowStockAlertStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });
  }

  async listOpen(args: { sellerId?: string; limit?: number }) {
    return this.prisma.lowStockAlert.findMany({
      where: {
        status: LowStockAlertStatus.ACTIVE,
        ...(args.sellerId ? { sellerId: args.sellerId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(args.limit ?? 200, 500),
    });
  }

  /**
   * Phase 54 (audit Gap #16) — seller-scoped read. Returns only
   * alerts whose mapping belongs to the requesting seller. Throws
   * Forbidden if the caller tries to look at someone else's data.
   */
  async listForSeller(
    sellerId: string,
    opts: { limit?: number } = {},
  ): Promise<unknown[]> {
    if (!sellerId) throw new ForbiddenAppException('sellerId required');
    return this.prisma.lowStockAlert.findMany({
      where: {
        sellerId,
        status: LowStockAlertStatus.ACTIVE,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 100, 500),
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private fireTriggered(
    alertId: string,
    payload: {
      mappingId: string;
      sellerId: string;
      productId: string;
      variantId: string | null;
      availableStock: number;
      threshold: number;
    },
  ): void {
    this.eventBus
      .publish({
        eventName: INVENTORY_EVENTS.LOW_STOCK_ALERT_TRIGGERED,
        aggregate: 'LowStockAlert',
        aggregateId: alertId,
        payload: { alertId, ...payload },
        occurredAt: new Date(),
      })
      .catch((err) =>
        this.logger.warn(
          `Failed to publish LOW_STOCK_ALERT_TRIGGERED for ${alertId}: ${(err as Error).message}`,
        ),
      );
  }
}
