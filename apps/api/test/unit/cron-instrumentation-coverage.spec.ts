import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 5 (PR 5.1 + 5.2) — cron instrumentation coverage.
 *
 * Every @Cron-decorated service in this codebase should record its
 * run in `cron_runs` via `CronInstrumentationService.wrap(name, ...)`.
 * Without uniform coverage, on-call dashboards have visibility holes
 * — a silently-stopped job goes undetected because the heartbeat
 * checker is blind to crons that never write a run row.
 *
 * The list below documents which crons have been migrated. Each must
 *   (a) import `CronInstrumentationService`
 *   (b) actually call `instr.wrap(...)` inside the body
 *
 * Crons NOT in this list haven't been migrated yet — adding them is
 * the natural follow-up. The test for any future cron file should
 * be added here.
 */

const INSTRUMENTED_CRONS = [
  // Phase 5 (PR 5.1) — leader-elected pollers built in Phase 1.
  'src/modules/shipping/infrastructure/crons/ithink-tracking-poller.cron.ts',
  'src/modules/franchise/application/services/franchise-reservation-cleanup.service.ts',
  'src/modules/payments-saga/application/jobs/stuck-saga-sweep.cron.ts',
  // Phase 5 (PR 5.2) — high-value housekeeping + correctness crons.
  'src/core/idempotency/idempotency-sweeper.cron.ts',
  'src/core/sla/jobs/sla-breach-detector.cron.ts',
  'src/modules/audit/application/jobs/audit-chain-anchor.cron.ts',
  'src/modules/liability-ledger/application/services/admin-task-sla-breach.cron.ts',
  // Phase 5 (PR 5.3) — remaining housekeeping crons (compliance + cleanup).
  'src/core/retention/retention-enforcer.cron.ts',
  'src/core/file-integrity/integrity-verifier.cron.ts',
  'src/core/erasure/erasure-processor.cron.ts',
  'src/modules/discounts/application/crons/release-expired-redemptions.cron.ts',
  // Phase 5 (PR 5.4) — multi-cron service (4 distinct @Cron methods
  // in one class, each with its own job name).
  'src/bootstrap/scheduler/cron-jobs.service.ts',
  // Pre-Phase-5 baseline coverage:
  'src/modules/returns/application/jobs/seller-response-sweeper.cron.ts',
];

/**
 * Phase 5 (PR 5.4) — `cron-jobs.service.ts` hosts FOUR @Cron methods.
 * Each must wrap its body in `instr.wrap` with its own job name so
 * cron_runs.jobName discriminates per-tick metrics. The job names
 * here are the same strings passed to leader.run, which keeps the
 * heartbeat-target binding consistent with the lock-key naming.
 */
const CRON_JOBS_SERVICE_JOB_NAMES = [
  'hourly-low-stock-sweep',
  'ticket-sla-breach',
  'daily-reconciliation',
  'cleanup-stale-pending-files',
];

function read(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', rel), 'utf8');
}

describe('Cron instrumentation coverage (PR 5.1 + 5.2)', () => {
  it.each(INSTRUMENTED_CRONS)('%s imports CronInstrumentationService', (rel) => {
    const source = read(rel);
    expect(source).toMatch(
      /import\s+\{[^}]*CronInstrumentationService[^}]*\}\s+from\s+['"][^'"]*cron-observability\/cron-instrumentation\.service['"]/,
    );
  });

  it.each(INSTRUMENTED_CRONS)('%s calls instr|instrumentation.wrap(name, ...) somewhere in the body', (rel) => {
    // Field name is conventionally `instr` (Phase 5) but the
    // pre-existing seller-response-sweeper uses `instrumentation`.
    // Accept either to support both call sites.
    const source = read(rel);
    expect(source).toMatch(/this\.(instr|instrumentation)\.wrap\s*\(/);
  });

  it.each(INSTRUMENTED_CRONS)('%s passes a string literal job name to wrap()', (rel) => {
    // The job name must be a literal so the heartbeat detector can
    // bind to it via a CronHeartbeatTarget row keyed on the exact
    // string. A dynamic name (e.g. `${classname}.tick`) would defeat
    // the dashboard.
    const source = read(rel);
    const calls = [
      ...source.matchAll(/this\.(?:instr|instrumentation)\.wrap\s*\(\s*(['"][^'"]+['"]|\w+)/g),
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const arg = call[1];
      expect(arg.startsWith("'") || arg.startsWith('"')).toBe(true);
    }
  });
});

describe('CronJobsService — per-method instrumentation names (PR 5.4)', () => {
  const source = read('src/bootstrap/scheduler/cron-jobs.service.ts');

  it.each(CRON_JOBS_SERVICE_JOB_NAMES)(
    'includes a wrap call for the %s job',
    (jobName) => {
      // Each @Cron method must wrap its body in `instr.wrap('<job>', ...)`
      // so the four distinct ticks register as separate rows in
      // cron_runs.jobName. Without this, the four crons would either
      // share a name (collapsing their metrics) or have no record.
      const pattern = new RegExp(`this\\.instr\\.wrap\\s*\\(\\s*['"]${jobName}['"]`);
      expect(source).toMatch(pattern);
    },
  );

  it('every leader.run lock-key has a matching instr.wrap job name (consistency)', () => {
    // Defends against the foot-gun where a future copy-paste renames
    // one half of the pair (e.g. leader uses 'cleanup-pending' but
    // instr.wrap still uses 'cleanup-stale-pending-files'). The
    // heartbeat dashboard would then see "missing run for
    // cleanup-stale-pending-files" even though leader successfully
    // ran. Catching this lock-vs-job-name divergence at unit-test
    // time is much cheaper than at on-call time.
    for (const jobName of CRON_JOBS_SERVICE_JOB_NAMES) {
      const leaderPattern = new RegExp(`this\\.leader\\.run\\s*\\(\\s*['"]${jobName}['"]`);
      expect(source).toMatch(leaderPattern);
    }
  });
});
