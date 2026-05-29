import 'reflect-metadata';
import { CronHeartbeatSeeder, SEEDED_CRON_JOB_NAMES } from './cron-heartbeat-seeder';

/**
 * Phase 5 (PR 5.5) — heartbeat seeder behavioural spec.
 *
 * Two correctness properties:
 *
 *   1. First-boot: creates one row per documented target.
 *   2. Subsequent boots: PRESERVE existing rows verbatim — operator
 *      tweaks to expectedIntervalSeconds / toleranceMultiplier /
 *      enabled survive deploys. The upsert's `update` branch is
 *      intentionally a no-op.
 *
 * Plus the boot-error swallow: a Prisma blip on seed must NOT block
 * application boot (the heartbeat detector is opt-in by env flag, so
 * the seed failing-closed isn't catastrophic).
 */

function buildPrismaMock(opts: {
  existingByName?: Record<string, true>;
} = {}) {
  const created: any[] = [];
  return {
    cronHeartbeatTarget: {
      findUnique: jest.fn(async (args: { where: { jobName: string } }) => {
        return opts.existingByName?.[args.where.jobName]
          ? { jobName: args.where.jobName }
          : null;
      }),
      create: jest.fn(async (args: { data: any }) => {
        created.push(args.data);
        return args.data;
      }),
    },
    _created: created,
  } as any;
}

describe('CronHeartbeatSeeder (PR 5.5)', () => {
  it('creates one row per documented target on a fresh DB', async () => {
    const prisma = buildPrismaMock();
    const seeder = new CronHeartbeatSeeder(prisma);
    const result = await seeder.seed();

    expect(result.created).toBe(SEEDED_CRON_JOB_NAMES.length);
    expect(result.preserved).toBe(0);
    expect(prisma.cronHeartbeatTarget.create).toHaveBeenCalledTimes(
      SEEDED_CRON_JOB_NAMES.length,
    );

    // Every documented job name appears in the created rows.
    const createdNames = new Set(
      (prisma._created as Array<{ jobName: string }>).map((r) => r.jobName),
    );
    for (const name of SEEDED_CRON_JOB_NAMES) {
      expect(createdNames.has(name)).toBe(true);
    }
  });

  it('every created row has positive interval + tolerance + enabled=true', async () => {
    const prisma = buildPrismaMock();
    const seeder = new CronHeartbeatSeeder(prisma);
    await seeder.seed();

    for (const row of prisma._created as Array<{
      jobName: string;
      expectedIntervalSeconds: number;
      toleranceMultiplier: number;
      enabled: boolean;
      description: string;
    }>) {
      expect(row.expectedIntervalSeconds).toBeGreaterThan(0);
      expect(row.toleranceMultiplier).toBeGreaterThan(0);
      expect(row.enabled).toBe(true);
      expect(row.description.length).toBeGreaterThan(0);
    }
  });

  it('preserves existing rows on subsequent boots (no upsert.update clobber)', async () => {
    // Every documented target already has a row. The seeder must
    // NOT call create() at all — operator tweaks to tolerance live
    // safe under deploys.
    const existingByName = Object.fromEntries(
      SEEDED_CRON_JOB_NAMES.map((n) => [n, true as const]),
    );
    const prisma = buildPrismaMock({ existingByName });
    const seeder = new CronHeartbeatSeeder(prisma);
    const result = await seeder.seed();

    expect(result.created).toBe(0);
    expect(result.preserved).toBe(SEEDED_CRON_JOB_NAMES.length);
    expect(prisma.cronHeartbeatTarget.create).not.toHaveBeenCalled();
  });

  it('creates only the missing rows when partially seeded', async () => {
    // Operator manually deleted one target. Next boot recreates just
    // that one — others stay untouched.
    const existingByName: Record<string, true> = {};
    for (const name of SEEDED_CRON_JOB_NAMES.slice(1)) {
      existingByName[name] = true;
    }
    const prisma = buildPrismaMock({ existingByName });
    const seeder = new CronHeartbeatSeeder(prisma);
    const result = await seeder.seed();

    expect(result.created).toBe(1);
    expect(result.preserved).toBe(SEEDED_CRON_JOB_NAMES.length - 1);
    expect(prisma.cronHeartbeatTarget.create).toHaveBeenCalledTimes(1);
    const created = (prisma._created as Array<{ jobName: string }>)[0]!;

    expect(created.jobName).toBe(SEEDED_CRON_JOB_NAMES[0]);
  });

  it('onModuleInit swallows seed errors so app boot proceeds', async () => {
    // A Prisma blip on seed shouldn't block API boot. The heartbeat
    // detector is opt-in (CRON_HEARTBEAT_ENABLED) so the failure mode
    // is "no alerts" not "false alerts".
    const prisma = {
      cronHeartbeatTarget: {
        findUnique: jest.fn().mockRejectedValue(new Error('DB unreachable')),
        create: jest.fn(),
      },
    } as any;
    const seeder = new CronHeartbeatSeeder(prisma);
    await expect(seeder.onModuleInit()).resolves.toBeUndefined();
  });
});

describe('Seed-list ↔ instrumented-cron registry parity (PR 5.5)', () => {
  // The cron-instrumentation-coverage source-scan registry and this
  // seed list MUST stay aligned: every instrumented cron should have
  // a heartbeat target, and no extra ghost-targets should exist.
  // The list of expected job names is hardcoded here as the canonical
  // truth — adding a new cron means appending to BOTH this list and
  // the seeder's TARGETS array. The instrumentation-coverage spec
  // catches the source-file side; this spec catches the seed side.
  const CANONICAL_JOB_NAMES = [
    'hourly-low-stock-sweep',
    'ticket-sla-breach',
    'daily-reconciliation',
    'cleanup-stale-pending-files',
    'idempotency-sweeper',
    'retention-enforcer',
    'integrity-verifier',
    'erasure-processor',
    'sla-breach-detector',
    'audit-chain-anchor',
    'admin-task-sla-breach',
    'stuck-saga-sweep',
    'franchise-reservation-cleanup',
    'release-expired-redemptions',
    'seller-response-sweeper',
  ];

  it('the seed list contains exactly the canonical 15 names', () => {
    const seeded = new Set(SEEDED_CRON_JOB_NAMES);
    const canonical = new Set(CANONICAL_JOB_NAMES);
    expect(seeded).toEqual(canonical);
  });

  it('no duplicates in the seed list', () => {
    const seen = new Set<string>();
    for (const name of SEEDED_CRON_JOB_NAMES) {
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
  });
});
