import { Injectable, Logger } from '@nestjs/common';
import { CodRemittanceService } from '../services/cod-remittance.service';
import { runWithLeaderLock } from '../../../../bootstrap/scheduler/leader-elected-cron';

/**
 * Daily-at-09:00 IST pull of every registered partner's COD
 * remittance feed. The body is wired but DISABLED — uncomment the
 * @Cron decorator in M3 once partner adapters and a real leader
 * lock are in place. Running it now would: (a) throw because no
 * adapters exist, and (b) run once per replica because the leader
 * lock is a passthrough.
 *
 * The cron-class scaffolding stays here so the M3 PR is a small
 * diff: enable @Cron, swap the leader lock, and ship.
 */
@Injectable()
export class PullRemittanceCron {
  private readonly logger = new Logger(PullRemittanceCron.name);

  constructor(private readonly remittance: CodRemittanceService) {}

  // @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })  // enable in M3
  async handle(): Promise<void> {
    await runWithLeaderLock(
      { key: 'cod.remittance.pull.daily', ttlSeconds: 1800 },
      async () => {
        this.logger.log('Skipping COD remittance pull — no partners registered (M0).');
        // M3: iterate every registered partner and call
        // this.remittance.pull(partner). Errors per partner are
        // collected and reported; a single partner failure must NOT
        // skip the others.
        void this.remittance;
      },
    );
  }
}
