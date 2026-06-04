import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';

/**
 * Phase 5 (PR 5.5) — `cron_heartbeat_targets` seed.
 *
 * The heartbeat detector (PR 8.3 / `CronHeartbeatCron`) walks this
 * table and alerts when any listed job hasn't logged a SUCCEEDED run
 * within `expectedIntervalSeconds × toleranceMultiplier`. Without
 * rows, the detector is a no-op — silent crons stay silent.
 *
 * PR 5.5 seeds the table from the same canonical list of job names
 * the codebase already uses in `leader.run('<name>', ...)` and
 * `instr.wrap('<name>', ...)`. The seeding is an idempotent upsert
 * on `OnModuleInit`:
 *
 *   - First boot in a fresh env creates all rows.
 *   - Subsequent boots leave them untouched (the upsert's `update`
 *     branch is empty — we don't want to clobber an operator's
 *     tolerance tweak).
 *   - Adding a new cron means appending one line to TARGETS below.
 *
 * Tolerance multiplier defaults to 3 (matches the schema default in
 * `cron-observability.prisma`). Override per-target only when the
 * default would alert too aggressively for a job's variance profile
 * (e.g. the daily reconciliation can legitimately take 30+ minutes,
 * so its base interval is 24 h and tolerance×3 = 3 days — generous
 * enough to absorb a one-day stall but tight enough to catch a
 * stuck job).
 *
 * Why a service (`OnModuleInit`) instead of a SQL seed migration:
 *   - Adding a new cron requires a code change anyway (new @Cron
 *     method + wrap call); having the heartbeat list live in code
 *     keeps the three sites (leader.run name, instr.wrap name, seed
 *     row) close to each other.
 *   - Idempotent upsert is safer than an INSERT-style migration that
 *     would need ON CONFLICT handling for dev DB resets / replays.
 *   - The cron-instrumentation-coverage spec cross-checks the seed
 *     list against the instrumented cron files so they never drift.
 */
interface SeedTarget {
  jobName: string;
  expectedIntervalSeconds: number;
  /** Defaults to 3 when omitted (matches DB column default). */
  toleranceMultiplier?: number;
  description: string;
}

/**
 * Canonical cron registry. Each entry matches a `leader.run()`
 * lock-key and an `instr.wrap()` job name in source. The
 * cron-instrumentation-coverage spec asserts the source files use
 * these exact strings — the dashboard, the seed list, and the
 * heartbeat detector all share the same identifier.
 */
const TARGETS: SeedTarget[] = [
  // ── inventory/.../jobs/low-stock-sweep.cron.ts ───────────────
  // Phase 174 — the duplicate hourly sweep in cron-jobs.service.ts was
  // removed (audit #218-#1); the canonical detector is the 15-min
  // LowStockSweepCron (leader-elected + instrumented, job 'low-stock-sweep').
  {
    jobName: 'low-stock-sweep',
    expectedIntervalSeconds: 15 * 60,
    description: 'Refresh low-stock alerts on seller mappings (15-min sweep).',
  },

  // ── bootstrap/scheduler/cron-jobs.service.ts ─────────────────
  {
    jobName: 'ticket-sla-breach',
    expectedIntervalSeconds: 60 * 60,
    description: 'Escalate tickets past their SLA target.',
  },
  {
    jobName: 'daily-reconciliation',
    expectedIntervalSeconds: 24 * 60 * 60,
    description: 'Daily reconciliation across PAYMENT/COD/SETTLEMENT/REFUND/WALLET.',
  },
  {
    jobName: 'cleanup-stale-pending-files',
    expectedIntervalSeconds: 24 * 60 * 60,
    description: 'Soft-delete PENDING file uploads older than 24h.',
  },

  // ── core/* leader-elected crons ──────────────────────────────
  {
    jobName: 'idempotency-sweeper',
    expectedIntervalSeconds: 10 * 60,
    description: 'Sweep expired + orphan idempotency_keys rows.',
  },
  {
    jobName: 'retention-enforcer',
    expectedIntervalSeconds: 24 * 60 * 60,
    description: 'Apply retention policies to file_metadata rows.',
  },
  {
    jobName: 'integrity-verifier',
    expectedIntervalSeconds: 60 * 60,
    description: 'Hash + verify a batch of file_metadata rows.',
  },
  {
    jobName: 'erasure-processor',
    expectedIntervalSeconds: 60 * 60,
    description: 'Process due DataErasureRequest rows.',
  },
  {
    jobName: 'sla-breach-detector',
    expectedIntervalSeconds: 5 * 60,
    description: 'Detect SLA breaches on returns / disputes / tickets.',
  },

  // ── module-level crons ───────────────────────────────────────
  {
    jobName: 'audit-chain-anchor',
    expectedIntervalSeconds: 60 * 60,
    description: 'Pin the audit-chain Merkle head once per hour.',
  },
  {
    jobName: 'admin-task-sla-breach',
    expectedIntervalSeconds: 5 * 60,
    description: 'Escalate admin_tasks past their slaBreachAt.',
  },
  {
    jobName: 'stuck-saga-sweep',
    expectedIntervalSeconds: 5 * 60,
    description: 'Auto-escalate refund sagas stuck > 5 min.',
  },
  {
    jobName: 'franchise-reservation-cleanup',
    expectedIntervalSeconds: 60,
    description: 'Release expired franchise stock reservations.',
  },
  {
    jobName: 'release-expired-redemptions',
    expectedIntervalSeconds: 60,
    description: 'Release expired RESERVED discount redemptions.',
  },
  {
    jobName: 'seller-response-sweeper',
    expectedIntervalSeconds: 60 * 60,
    description: 'Sweep returns awaiting seller response past their deadline.',
  },
];

@Injectable()
export class CronHeartbeatSeeder implements OnModuleInit {
  private readonly logger = new Logger(CronHeartbeatSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.seed();
    } catch (err) {
      // Seed failure isn't load-bearing — the heartbeat detector is
      // opt-in (CRON_HEARTBEAT_ENABLED defaults to false) and a
      // missing-row case results in "no alert" rather than "false
      // alert". Log and let boot proceed.
      this.logger.error(
        `Failed to seed cron heartbeat targets: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Public for tests; idempotent.
   *
   * The upsert's `update` branch is intentionally empty: once a row
   * exists, an operator's tweaks to `expectedIntervalSeconds`,
   * `toleranceMultiplier`, or `enabled` are preserved across deploys.
   * If you NEED to push a new default to all envs, the right move is
   * a one-shot SQL migration, not a code-side default override.
   */
  async seed(): Promise<{ created: number; preserved: number }> {
    let created = 0;
    let preserved = 0;
    for (const t of TARGETS) {
      const existing = await this.prisma.cronHeartbeatTarget.findUnique({
        where: { jobName: t.jobName },
        select: { jobName: true },
      });
      if (existing) {
        preserved += 1;
        continue;
      }
      await this.prisma.cronHeartbeatTarget.create({
        data: {
          jobName: t.jobName,
          expectedIntervalSeconds: t.expectedIntervalSeconds,
          toleranceMultiplier: t.toleranceMultiplier ?? 3,
          enabled: true,
          description: t.description,
        },
      });
      created += 1;
    }
    if (created > 0) {
      this.logger.log(
        `cron-heartbeat seed: created ${created}, preserved ${preserved}`,
      );
    }
    return { created, preserved };
  }
}

/** Test-only export: lets the coverage spec compare the seed list
 *  against the instrumented-cron source-scan registry. */
export const SEEDED_CRON_JOB_NAMES: ReadonlyArray<string> = TARGETS.map(
  (t) => t.jobName,
);
