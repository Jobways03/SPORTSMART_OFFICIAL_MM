import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { FranchiseCommissionService } from './franchise-commission.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

const LOCK_KEY = 'lock:franchise-commission-processor';
const LOCK_TTL = 30;

@Injectable()
export class FranchiseCommissionProcessorService implements OnModuleInit, OnModuleDestroy {
  private processingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commissionService: FranchiseCommissionService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('FranchiseCommissionProcessorService');
  }

  onModuleInit() {
    this.processingInterval = setInterval(() => this.processCommissions(), 15_000);
    this.logger.log('Franchise commission processor started (every 15s)');
  }

  onModuleDestroy() {
    if (this.processingInterval) clearInterval(this.processingInterval);
  }

  async processCommissions(): Promise<void> {
    // FENCED distributed lock. The plain acquireLock/releaseLock pair had a
    // documented race: a holder whose 30s TTL expired mid-batch could DEL a
    // SUCCESSOR's lock on release, letting two pods run the body concurrently.
    // The token CAS (releaseLockWithToken) deletes only if the lock is still
    // ours — mirrors the seller-side commission-processor.
    const { acquired, token } = await this.redisService.acquireLockWithToken(
      LOCK_KEY,
      LOCK_TTL,
    );
    if (!acquired) return;

    try {
      // Find franchise sub-orders that are:
      // 1. fulfillmentNodeType = 'FRANCHISE'
      // 2. fulfillmentStatus = 'DELIVERED'
      // 3. returnWindowEndsAt < now (return window passed)
      // 4. commissionProcessed = false
      // 5. NO live return — i.e. no return exists that isn't terminal-failed
      //    (REJECTED/QC_REJECTED/CANCELLED). A return requested just before the
      //    window closed can still be in-flight after it; locking commission
      //    then would pay the franchise while a refund is pending. (The reversal
      //    path nets it on approval, but locking-then-reversing churns
      //    settlement + can outrun the 30-day auto-claw window.)
      // 6. NO active dispute — no dispute outside the terminal RESOLVED_*/CLOSED
      //    set. Mirrors the seller-side guard (prisma-commission.repository.ts).
      const now = new Date();
      const eligibleSubOrders = await this.prisma.subOrder.findMany({
        where: {
          fulfillmentNodeType: 'FRANCHISE',
          franchiseId: { not: null },
          fulfillmentStatus: 'DELIVERED',
          returnWindowEndsAt: { lt: now },
          commissionProcessed: false,
          NOT: {
            returns: {
              some: { status: { notIn: ['REJECTED', 'QC_REJECTED', 'CANCELLED'] } },
            },
          },
          disputes: {
            none: {
              status: {
                notIn: ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'CLOSED'],
              },
            },
          },
        },
        include: {
          items: true,
          masterOrder: { select: { orderNumber: true } },
          franchise: { select: { id: true, onlineFulfillmentRate: true } },
        },
      });

      for (const subOrder of eligibleSubOrders) {
        if (!subOrder.franchise) continue;

        try {
          // Use the rate snapshot from order time; fall back to current rate for legacy orders
          const commissionRate = subOrder.commissionRateSnapshot
            ? Number(subOrder.commissionRateSnapshot)
            : Number(subOrder.franchise.onlineFulfillmentRate);
          const items = subOrder.items.map((item) => ({
            unitPrice: Number(item.unitPrice),
            quantity: item.quantity,
          }));

          // Record FIRST, then mark. recordOnlineOrderCommission is idempotent
          // (the ledger @unique key ONLINE_ORDER:<subOrderId> returns the
          // existing row instead of double-posting). Recording before marking
          // means a crash between the two leaves commissionProcessed=false, so
          // the next tick safely RE-records (no-op) and re-marks — the
          // commission is never silently stranded/lost.
          await this.commissionService.recordOnlineOrderCommission({
            franchiseId: subOrder.franchiseId!,
            subOrderId: subOrder.id,
            orderNumber: subOrder.masterOrder.orderNumber,
            items,
            commissionRate,
          });

          // Mark processed atomically + conditionally. Whoever flips
          // false→true "wins"; a concurrent worker (were the fenced lock ever
          // to fail) sees count=0 and skips the notification, so
          // commission.locked is published EXACTLY ONCE per sub-order.
          //
          // Re-validate the no-live-return / no-active-dispute predicate INSIDE
          // the claim (mirrors the seller side): a return/dispute opened in the
          // window between the eligibility findMany and here makes the claim
          // match 0 rows → commissionProcessed stays false and no event fires.
          // (recordOnlineOrderCommission already ran for that narrow race; the
          // ledger row is idempotent and the reversal path nets it on approval.)
          const marked = await this.prisma.subOrder.updateMany({
            where: {
              id: subOrder.id,
              commissionProcessed: false,
              NOT: {
                returns: {
                  some: { status: { notIn: ['REJECTED', 'QC_REJECTED', 'CANCELLED'] } },
                },
              },
              disputes: {
                none: {
                  status: {
                    notIn: ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'CLOSED'],
                  },
                },
              },
            },
            data: { commissionProcessed: true },
          });
          if (marked.count === 0) continue; // already finalized, OR a live return/dispute appeared

          this.logger.log(`Franchise commission processed for sub-order ${subOrder.id}`);

          // Notify the franchise that their commission is locked — same
          // event the seller-side processor emits, unified consumers.
          const baseAmount = items.reduce(
            (sum, i) => sum + i.unitPrice * i.quantity,
            0,
          );
          const platformEarning =
            Math.round(baseAmount * (commissionRate / 100) * 100) / 100;
          const franchiseEarning =
            Math.round((baseAmount - platformEarning) * 100) / 100;
          this.eventBus
            .publish({
              eventName: 'commission.locked',
              aggregate: 'SubOrder',
              aggregateId: subOrder.id,
              occurredAt: new Date(),
              payload: {
                subOrderId: subOrder.id,
                masterOrderId: subOrder.masterOrderId,
                orderNumber: subOrder.masterOrder.orderNumber,
                nodeType: 'FRANCHISE',
                franchiseId: subOrder.franchiseId,
                itemCount: items.length,
                adminEarning: platformEarning,
                sellerEarning: franchiseEarning,
                commissionRate,
              },
            })
            .catch((err: unknown) =>
              this.logger.warn(
                `Failed to publish commission.locked: ${(err as Error)?.message}`,
              ),
            );
        } catch (err) {
          // Recording (or marking) failed — the row stays commissionProcessed
          // =false, so the next tick retries. The idempotent ledger write makes
          // a retry safe (no double-post).
          this.logger.error(
            `Failed to process franchise commission for ${subOrder.id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Franchise commission processing error: ${(err as Error).message}`);
    } finally {
      if (token) await this.redisService.releaseLockWithToken(LOCK_KEY, token);
    }
  }
}
