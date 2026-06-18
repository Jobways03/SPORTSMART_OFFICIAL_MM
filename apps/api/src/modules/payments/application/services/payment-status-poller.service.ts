import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { resolveExpectedGatewayPaise } from '../../../../core/money/gateway-amount-verifier';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';
import { PaymentOpsFacade } from '../../../payments-ops/application/facades/payment-ops.facade';

// Phase 165 (#9/#17) — the poller was a raw setInterval guarded by a manual,
// unfenced Redis lock (invisible to cron-observability; a tick overrunning the
// TTL could have its lock deleted by a successor). It is now a @Cron job
// wrapped in LeaderElectedCron (cluster-safe, fenced) + CronInstrumentationService
// (metrics in cron_runs), matching every other cron in the codebase.
const CRON_JOB_NAME = 'payment-status-poller';
const CRON_TTL_SECONDS = 5 * 60;

/**
 * Background processor for online payments stuck in PENDING_PAYMENT.
 *
 * Two responsibilities:
 * 1. **Auto-cancel expired**: orders past `paymentExpiresAt` with no
 *    Razorpay payment are cancelled + stock released.
 * 2. **Auto-confirm paid**: orders where Razorpay shows "captured" but
 *    the verify endpoint was never called (e.g. user closed browser
 *    after payment but before redirect). Polls Razorpay by order ID
 *    and confirms if paid.
 */
@Injectable()
export class PaymentStatusPollerService {
  private readonly logger = new Logger(PaymentStatusPollerService.name);
  private readonly windowMinutes: number;
  // Phase 166 (#13) — consecutive gateway fetch failures across ticks; crossing
  // the env threshold opens an alert (catches revoked/expired credentials that
  // would otherwise fail silently for the whole window).
  private consecutiveFetchFailures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
    private readonly razorpayAdapter: RazorpayAdapter,
    private readonly franchiseFacade: FranchisePublicFacade,
    // Phase 165 (#9/#17) — cluster-safe scheduling + observability.
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    // Phase 166 (#5/#6/#13) — poll-attempt ledger + mismatch alerts.
    private readonly paymentOps: PaymentOpsFacade,
  ) {
    this.windowMinutes = this.envService.getNumber(
      'PAYMENT_WINDOW_MINUTES',
      30,
    );
  }

  /** Disabled by setting PAYMENT_POLL_INTERVAL_SECONDS <= 0 (kept for parity). */
  private enabled(): boolean {
    return this.envService.getNumber('PAYMENT_POLL_INTERVAL_SECONDS', 60) > 0;
  }

  // Phase 165 (#9) — every minute, leader-elected + instrumented. Replaces
  // the prior onModuleInit setInterval + manual Redis lock.
  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run(CRON_JOB_NAME, CRON_TTL_SECONDS, async () => {
      try {
        await this.instr.wrap(CRON_JOB_NAME, () => this.tick());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  async tick(): Promise<void> {
    await this.cancelExpiredPayments();
    await this.confirmOrphanedPayments();
  }

  /**
   * Cancel orders whose payment window has lapsed with no payment.
   */
  private async cancelExpiredPayments(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.masterOrder.findMany({
      where: {
        orderStatus: 'PENDING_PAYMENT',
        paymentExpiresAt: { lt: now },
        razorpayPaymentId: null,
        // Phase 166 (#10) — never even consider an order that's already PAID
        // (webhook/orphan-confirmed but orderStatus not yet flipped). The CAS
        // below is the load-bearing guard; this just trims the candidate set.
        paymentStatus: { notIn: ['PAID'] as any },
      },
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
      },
      take: this.envService.getNumber('PAYMENT_POLL_CANCEL_BATCH', 30),
    });

    for (const order of expired) {
      try {
        // Flip statuses and release seller stock atomically. CONFIRMED
        // reservations had their stockQty deducted at order place time
        // (see checkout.service.ts:470-479) so we must restore stockQty;
        // RESERVED reservations only hold reservedQty. Mirrors the
        // pattern in orders.service.ts:478-508.
        const result = await this.prisma.$transaction(async (tx) => {
          // Phase 166 (#10) — CAS cancel. A payment captured in the last
          // second of the window (verify/webhook/orphan-confirm flips
          // paymentStatus PAID or sets razorpayPaymentId) between this tick's
          // findMany and here must NOT be cancelled. Guard the flip on the
          // exact pre-state; count 0 → a concurrent confirm won → skip release.
          const flip = await tx.masterOrder.updateMany({
            where: {
              id: order.id,
              orderStatus: 'PENDING_PAYMENT',
              razorpayPaymentId: null,
              paymentStatus: { notIn: ['PAID'] as any },
            },
            data: {
              orderStatus: 'CANCELLED',
              paymentStatus: 'CANCELLED',
            },
          });
          if (flip.count === 0) {
            return { cancelled: false };
          }
          await tx.subOrder.updateMany({
            where: { masterOrderId: order.id },
            data: {
              paymentStatus: 'CANCELLED',
              fulfillmentStatus: 'CANCELLED',
              acceptStatus: 'CANCELLED',
            },
          });

          const reservations = await tx.stockReservation.findMany({
            where: {
              orderId: order.id,
              status: { in: ['RESERVED', 'CONFIRMED'] },
            },
          });
          // Cluster C (#215-#23) — SURFACED, not fixed here. Unlike the
          // canonical ReservationExpirySweepCron (which writes a
          // StockMovement RELEASED ledger row per release via
          // StockMovementLedgerService), this cancel-expired path adjusts
          // stockQty/reservedQty WITHOUT a ledger row, so a forensic
          // "where did these units go?" query can't see poller-driven
          // releases. The fix is a best-effort `ledger.record({ kind:
          // 'RELEASED', referenceType: 'PAYMENT_EXPIRY', ... })` after each
          // mapping adjust below — but StockMovementLedgerService lives in
          // the (non-@Global) InventoryModule, which the payments module
          // does not import. Wiring it requires adding `InventoryModule` to
          // payments/module.ts imports (out of this cluster's scope), so it
          // is reported as an honestCall rather than half-wired here.
          for (const res of reservations) {
            await tx.stockReservation.update({
              where: { id: res.id },
              data: { status: 'RELEASED' },
            });
            if (res.status === 'CONFIRMED') {
              await tx.sellerProductMapping.update({
                where: { id: res.mappingId },
                data: { stockQty: { increment: res.quantity } },
              });
            } else {
              await tx.sellerProductMapping.update({
                where: { id: res.mappingId },
                data: { reservedQty: { decrement: res.quantity } },
              });
            }
          }
          return { cancelled: true };
        });

        // Phase 166 (#10) — a last-second payment won the CAS race; the order
        // is NOT cancelled. Skip stock release + the expired event (the
        // confirm path owns the order now).
        if (!result.cancelled) {
          this.logger.log(
            `Skipped cancel for ${order.orderNumber} — a payment landed in the race window`,
          );
          continue;
        }

        // Franchise-path stock lives behind the franchise facade which
        // manages its own transactions; best-effort release outside the tx.
        const franchiseSubOrders = await this.prisma.subOrder.findMany({
          where: {
            masterOrderId: order.id,
            fulfillmentNodeType: 'FRANCHISE',
            franchiseId: { not: null },
          },
          include: {
            items: {
              select: { productId: true, variantId: true, quantity: true },
            },
          },
        });
        for (const so of franchiseSubOrders) {
          if (!so.franchiseId) continue;
          for (const item of so.items) {
            // Phase 166 (#11) — retry the franchise unreserve a few times before
            // giving up, then ERROR-log with a MANUAL-RECONCILIATION marker so a
            // facade blip doesn't silently strand franchise stock as reserved.
            await this.unreserveFranchiseWithRetry(so.franchiseId, item, order);
          }
        }

        this.eventBus
          .publish({
            eventName: 'payments.payment.expired',
            aggregate: 'MasterOrder',
            aggregateId: order.id,
            occurredAt: now,
            payload: {
              masterOrderId: order.id,
              orderNumber: order.orderNumber,
              customerId: order.customerId,
              reason: `Payment window (${this.windowMinutes}min) expired`,
            },
          })
          .catch(() => {});

        this.logger.log(
          `Auto-cancelled expired payment order ${order.orderNumber}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to cancel expired order ${order.orderNumber}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Phase 166 (#11) — best-effort franchise unreserve with a small bounded
   * retry. On final failure, ERROR-log with a MANUAL-RECONCILIATION marker so
   * a transient facade blip doesn't silently strand franchise stock reserved
   * after the order is already cancelled.
   */
  private async unreserveFranchiseWithRetry(
    franchiseId: string,
    item: { productId: string; variantId: string | null; quantity: number },
    order: { id: string; orderNumber: string },
  ): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.franchiseFacade.unreserveStock(
          franchiseId,
          item.productId,
          item.variantId ?? null,
          item.quantity,
          order.id,
        );
        return;
      } catch (err) {
        if (attempt === 3) {
          this.logger.error(
            `[MANUAL-RECONCILIATION] Franchise unreserveStock FAILED after 3 attempts for ` +
              `order ${order.orderNumber} franchise=${franchiseId} product=${item.productId} ` +
              `variant=${item.variantId ?? 'null'} qty=${item.quantity}: ${(err as Error)?.message}. ` +
              `Order is CANCELLED but franchise stock may remain reserved — release manually.`,
          );
        }
      }
    }
  }

  /**
   * Check Razorpay for PENDING_PAYMENT orders that have a razorpayOrderId
   * but no razorpayPaymentId — the customer may have paid but never
   * returned to the verify endpoint.
   */
  private async confirmOrphanedPayments(): Promise<void> {
    // Phase 166 (#7) — back off per order: skip orders polled within the
    // backoff window so a captured-but-orphaned order isn't polled ~30× over
    // the 30-min window. lastPolledAt is stamped on every poll below.
    const backoffSeconds = this.envService.getNumber(
      'PAYMENT_POLL_ORPHAN_BACKOFF_SECONDS',
      180,
    );
    const backoffCutoff = new Date(Date.now() - backoffSeconds * 1000);
    const orphaned = await this.prisma.masterOrder.findMany({
      where: {
        orderStatus: 'PENDING_PAYMENT',
        razorpayOrderId: { not: null },
        razorpayPaymentId: null,
        paymentExpiresAt: { gte: new Date() },
        OR: [
          { lastPolledAt: null },
          { lastPolledAt: { lt: backoffCutoff } },
        ],
      },
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        razorpayOrderId: true,
        // Phase 165 (#11) — use the BigInt paise sibling column directly;
        // Number(totalAmount) * 100 lost precision above ~₹90L.
        totalAmountInPaise: true,
        // Needed so orphan recovery compares the captured amount against the
        // PAYABLE (total − wallet) — a wallet-assisted order is captured net
        // of wallet at the gateway, so comparing against the full total would
        // wrongly flag a legitimate capture as drift.
        gatewayAmountInPaise: true,
        walletAmountUsedInPaise: true,
      },
      take: this.envService.getNumber('PAYMENT_POLL_ORPHAN_BATCH', 20),
    });

    for (const order of orphaned) {
      const expectedInPaise = resolveExpectedGatewayPaise(order);
      let pollError: string | null = null;
      try {
        // Phase 165 (#2) — scan EVERY gateway order id this MasterOrder has
        // ever had, not just the current MasterOrder.razorpayOrderId.
        const paymentRows = await this.prisma.payment.findMany({
          where: {
            masterOrderId: order.id,
            method: 'ONLINE',
            providerOrderId: { not: null },
          },
          select: { providerOrderId: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });
        const orderIds = Array.from(
          new Set(
            [
              order.razorpayOrderId,
              ...paymentRows.map((p) => p.providerOrderId),
            ].filter((x): x is string => !!x),
          ),
        );

        // Phase 166 (#16) — collect ALL captured payments across the order ids,
        // then pick the LATEST by createdAt (Razorpay can have several payment
        // attempts per order; "first captured" could pick a stale one).
        const capturedCandidates: Array<{
          paymentId: string;
          amountInPaise: bigint;
          sourceOrderId: string;
          createdAt: Date;
        }> = [];
        for (const rid of orderIds) {
          try {
            const payments = await this.razorpayAdapter.fetchOrderPayments(rid);
            this.consecutiveFetchFailures = 0; // a success resets the counter
            for (const p of payments) {
              if (p.captured && p.status === 'captured') {
                capturedCandidates.push({
                  paymentId: p.paymentId,
                  amountInPaise: p.amountInPaise,
                  sourceOrderId: rid,
                  createdAt: p.createdAt,
                });
              }
            }
          } catch (fetchErr) {
            pollError = (fetchErr as Error).message;
            await this.onFetchFailure(order, fetchErr as Error);
          }
        }

        let captured = capturedCandidates[0] ?? null;
        if (capturedCandidates.length > 1) {
          capturedCandidates.sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
          captured = capturedCandidates[0]!;
          this.logger.warn(
            `[orphan-recovery] ${capturedCandidates.length} captured payments for order ` +
              `${order.orderNumber}; using the latest (${captured.paymentId}).`,
          );
        }

        if (captured) {
          const drift =
            captured.amountInPaise > expectedInPaise
              ? captured.amountInPaise - expectedInPaise
              : expectedInPaise - captured.amountInPaise;
          if (drift > 1n) {
            // Phase 165 (#17-drift) — OPEN a PaymentMismatchAlert.
            this.logger.warn(
              `[orphan-recovery] amount drift on order ${order.orderNumber}: ` +
                `expected=${expectedInPaise} captured=${captured.amountInPaise} — opening AMOUNT_MISMATCH alert`,
            );
            await this.prisma.paymentMismatchAlert
              .create({
                data: {
                  kind: 'AMOUNT_MISMATCH',
                  masterOrderId: order.id,
                  orderNumber: order.orderNumber,
                  providerPaymentId: captured.paymentId,
                  expectedInPaise,
                  actualInPaise: captured.amountInPaise,
                  severity: 90,
                  description:
                    `[orphan-recovery] captured Razorpay payment ${captured.paymentId} ` +
                    `(order ${captured.sourceOrderId}) amount ${captured.amountInPaise} paise ` +
                    `differs from expected ${expectedInPaise} paise by ${drift} paise. ` +
                    `Auto-confirm withheld — finance to reconcile.`,
                },
              })
              .catch((err) =>
                this.logger.error(
                  `[orphan-recovery] failed to open mismatch alert for ${order.orderNumber}: ${(err as Error).message}`,
                ),
              );
            // Phase 166 (#6) — record the poll outcome in the attempt ledger.
            this.paymentOps
              .recordAttempt({
                masterOrderId: order.id,
                orderNumber: order.orderNumber,
                kind: 'POLL_STATUS',
                status: 'FAILURE',
                providerOrderId: captured.sourceOrderId,
                providerPaymentId: captured.paymentId,
                amountInPaise: captured.amountInPaise,
                failureReason: `amount drift ${drift} paise`,
              })
              .catch(() => undefined);
          } else {
            this.logger.log(
              `[orphan-recovery] order ${order.orderNumber} has captured Razorpay payment ` +
                `${captured.paymentId} (gateway order ${captured.sourceOrderId}) — emitting recovery event`,
            );
            // Phase 166 (#1) — OrphanRecoveredHandler now consumes this and
            // does the full atomic confirm.
            await this.eventBus.publish({
              eventName: 'payments.orphan_recovered',
              aggregate: 'MasterOrder',
              aggregateId: order.id,
              occurredAt: new Date(),
              payload: {
                masterOrderId: order.id,
                orderNumber: order.orderNumber,
                razorpayOrderId: captured.sourceOrderId,
                razorpayPaymentId: captured.paymentId,
                capturedAmountInPaise: captured.amountInPaise.toString(),
                customerId: order.customerId,
              },
            });
            // The handler records the SUCCESS POLL_STATUS attempt on confirm,
            // so we don't double-write here.
          }
        }
      } catch (err) {
        pollError = (err as Error).message;
        this.logger.warn(
          `[orphan-recovery] failed for ${order.orderNumber}: ${pollError}`,
        );
      } finally {
        // Phase 166 (#7) — stamp poll tracking on EVERY order examined so the
        // backoff window applies and a forensic review sees when/how-often we
        // polled. Different columns from the confirm handler's flip → no conflict.
        await this.prisma.masterOrder
          .update({
            where: { id: order.id },
            data: {
              lastPolledAt: new Date(),
              pollAttemptCount: { increment: 1 },
              lastPollError: pollError,
            },
          })
          .catch(() => undefined);
      }
    }
  }

  /**
   * Phase 166 (#13) — track consecutive gateway fetch failures across orders /
   * ticks. Crossing the env threshold opens a single ORPHAN_PAYMENT alert (then
   * resets) so revoked/expired credentials surface instead of failing silently
   * for the whole window.
   */
  private async onFetchFailure(
    order: { id: string; orderNumber: string },
    err: Error,
  ): Promise<void> {
    this.consecutiveFetchFailures++;
    this.logger.warn(
      `[orphan-recovery] gateway fetch failed for ${order.orderNumber} ` +
        `(consecutive=${this.consecutiveFetchFailures}): ${err.message}`,
    );
    const threshold = this.envService.getNumber(
      'PAYMENT_POLL_FETCH_FAILURE_ALERT_THRESHOLD',
      5,
    );
    if (this.consecutiveFetchFailures >= threshold) {
      await this.paymentOps
        .flagMismatch({
          kind: 'ORPHAN_PAYMENT',
          masterOrderId: order.id,
          orderNumber: order.orderNumber,
          severity: 95,
          description:
            `[orphan-recovery] ${this.consecutiveFetchFailures} consecutive Razorpay ` +
            `fetchOrderPayments failures (last: ${err.message}). Orphan recovery is ` +
            `effectively down — check gateway credentials / connectivity.`,
          sourceType: 'POLLER', // Phase 169 (#13)
        })
        .catch(() => undefined);
      this.consecutiveFetchFailures = 0; // reset so we don't spam alerts
    }
  }
}
