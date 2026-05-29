import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { WalletRefundSagaService } from '../services/wallet-refund-saga.service';

/**
 * Phase 70 (2026-05-22) — Phase 66 audit Gap #8.
 *
 * Sweep PENDING / FAILED wallet refund sagas every 5 minutes,
 * retry each one, and emit an ops event for any that hit the
 * ABANDONED threshold so finance can reconcile manually.
 */
@Injectable()
export class WalletRefundSagaCron {
  private readonly logger = new Logger(WalletRefundSagaCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly saga: WalletRefundSagaService,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('WALLET_REFUND_SAGA_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('wallet-refund-saga', 10 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(
          `Wallet refund saga sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  async runOnce(): Promise<{ scanned: number; completed: number; failed: number; abandoned: number }> {
    const batchLimit = this.env.getNumber('WALLET_REFUND_SAGA_BATCH_LIMIT', 100);
    const cooldown = this.env.getNumber('WALLET_REFUND_SAGA_COOLDOWN_MINUTES', 5);
    const result = await this.saga.retryPendingAndFailed({
      batchLimit,
      cooldownMinutes: cooldown,
    });

    // ABANDONED sweep — emit an event for every saga that flipped
    // to ABANDONED since the previous tick (we re-read here rather
    // than threading the state through). Bounded scan: ABANDONED
    // rows are rare and we only emit once per row by clearing the
    // last_error after the event (a future polish).
    const abandoned = await this.prisma.walletRefundSaga.findMany({
      where: { status: 'ABANDONED' },
      take: 50,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        customerId: true,
        amountInPaise: true,
        lastError: true,
      },
    });
    for (const a of abandoned) {
      this.eventBus
        .publish({
          eventName: 'wallet.refund_saga.abandoned',
          aggregate: 'WalletRefundSaga',
          aggregateId: a.id,
          occurredAt: new Date(),
          payload: {
            sagaId: a.id,
            orderId: a.orderId,
            customerId: a.customerId,
            amountInPaise: a.amountInPaise.toString(),
            lastError: a.lastError,
          },
        })
        .catch(() => undefined);
    }

    if (result.completed > 0 || result.failed > 0) {
      this.logger.log(
        `Wallet refund saga sweep — scanned=${result.scanned} completed=${result.completed} failed=${result.failed} abandoned=${abandoned.length}`,
      );
    }
    return {
      scanned: result.scanned,
      completed: result.completed,
      failed: result.failed,
      abandoned: abandoned.length,
    };
  }
}
