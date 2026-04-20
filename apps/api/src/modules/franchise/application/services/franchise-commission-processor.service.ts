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
    // Distributed lock to prevent multi-instance processing
    const lockAcquired = await this.redisService.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!lockAcquired) return;

    try {
      // Find franchise sub-orders that are:
      // 1. fulfillmentNodeType = 'FRANCHISE'
      // 2. fulfillmentStatus = 'DELIVERED'
      // 3. returnWindowEndsAt < now (return window passed)
      // 4. commissionProcessed = false
      const now = new Date();
      const eligibleSubOrders = await this.prisma.subOrder.findMany({
        where: {
          fulfillmentNodeType: 'FRANCHISE',
          franchiseId: { not: null },
          fulfillmentStatus: 'DELIVERED',
          returnWindowEndsAt: { lt: now },
          commissionProcessed: false,
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

          await this.commissionService.recordOnlineOrderCommission({
            franchiseId: subOrder.franchiseId!,
            subOrderId: subOrder.id,
            orderNumber: subOrder.masterOrder.orderNumber,
            items,
            commissionRate,
          });

          // Mark as processed
          await this.prisma.subOrder.update({
            where: { id: subOrder.id },
            data: { commissionProcessed: true },
          });

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
          this.logger.error(
            `Failed to process franchise commission for ${subOrder.id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Franchise commission processing error: ${(err as Error).message}`);
    } finally {
      await this.redisService.releaseLock(LOCK_KEY);
    }
  }
}
