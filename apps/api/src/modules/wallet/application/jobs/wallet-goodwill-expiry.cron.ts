import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { WalletService } from '../services/wallet.service';

/**
 * Phase 172 (Goodwill Credit audit #9) — lapses goodwill wallet credits past
 * their expiry by posting a compensating DEBIT_ADJUSTMENT per lot.
 *
 * Leader-elected (single node in a multi-node deploy). Daily is ample for a
 * 180-day window; spend-time enforcement (WalletService.getSpendableBalance,
 * used by checkout) already makes expired goodwill unspendable the moment it
 * crosses expiry — this cron is the ledger cleanup that removes the lapsed
 * liability from the balance.
 */
@Injectable()
export class WalletGoodwillExpiryCron {
  private readonly logger = new Logger(WalletGoodwillExpiryCron.name);

  constructor(
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly wallet: WalletService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('WALLET_GOODWILL_EXPIRY_ENABLED', true);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async sweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('wallet-goodwill-expiry', 30 * 60, async () => {
      try {
        await this.runOnce();
      } catch (err) {
        this.logger.error(
          `Goodwill expiry sweep failed: ${(err as Error).message}`,
        );
      }
    });
  }

  async runOnce(): Promise<{
    usersProcessed: number;
    lotsLapsed: number;
    paiseLapsed: number;
  }> {
    const batchLimit = this.env.getNumber(
      'WALLET_GOODWILL_EXPIRY_BATCH_LIMIT',
      1000,
    );
    const result = await this.wallet.sweepExpiredGoodwill(batchLimit);
    if (result.lotsLapsed > 0) {
      this.logger.log(
        `Lapsed ${result.lotsLapsed} expired goodwill lot(s) (₹${(result.paiseLapsed / 100).toFixed(2)}) across ${result.usersProcessed} user(s)`,
      );
    }
    return result;
  }
}
