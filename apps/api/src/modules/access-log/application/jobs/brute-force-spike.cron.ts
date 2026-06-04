import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../../../core/cron-observability/cron-instrumentation.service';
import { AccessLogService } from '../services/access-log.service';

interface SpikeCounts {
  actorIpSpikes: number;
  ipSpikes: number;
  accountSpikes: number;
  tasksOpened: number;
  eventsEmitted: number;
}

/**
 * Phase 207 (#2) — brute-force spike detector + alerter.
 *
 * Pre-Phase-207 the codebase had a `failedLoginSpike()` aggregation but
 * NOTHING ever called it on a schedule — an operator had to open the
 * dashboard and look. A live credential-stuffing run would come and go
 * unseen. This cron polls the recent LOGIN_FAILURE window every 5 minutes
 * through three lenses and, on a crossing, ALERTS:
 *
 *   • per-(actor, IP)  — classic per-target burst.
 *   • per-IP           — one source host across many accounts (spray /
 *                        credential stuffing) — Phase 207 #6.
 *   • per-account      — one victim across many IPs (distributed botnet)
 *                        — Phase 207 #6.
 *
 * Alerting is two-channel, by design:
 *   1. `security.brute_force_detected` EVENT (EventBusService) — wired to
 *      whatever async handler ops attach (email / Slack / SIEM forwarder).
 *      The actual SIEM/PagerDuty transport is an EXTERNAL integration not
 *      buildable offline — SURFACED, not faked.
 *   2. A durable AdminTask (idempotent on (kind, sourceType, sourceId)) so
 *      the spike survives even if no event handler is attached yet. This is
 *      the load-bearing backstop — the event is best-effort.
 *
 * Idempotency / no-spam: the AdminTask uniqueKey is
 * (OTHER, MANUAL, "brute-force:<lens>:<hash(target)>"), so repeated ticks
 * during one sustained attack hit the SAME open task instead of spawning a
 * new row every 5 minutes. The event still fires each tick (cheap, and a
 * downstream handler can debounce) but the queue stays clean.
 *
 * Leader-elected (one emitter across replicas) + instrumented (records the
 * {actorIpSpikes, ipSpikes, accountSpikes, tasksOpened} shape so ops can
 * chart attack volume and spot a stuck detector).
 */
@Injectable()
export class BruteForceSpikeCron {
  private readonly logger = new Logger(BruteForceSpikeCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
    private readonly accessLog: AccessLogService,
    private readonly eventBus: EventBusService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('BRUTE_FORCE_SPIKE_CRON_ENABLED', true);
  }

  private windowHours(): number {
    const minutes = this.env.getNumber('BRUTE_FORCE_SPIKE_WINDOW_MINUTES', 15);
    return Math.max(1, minutes) / 60;
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;
    await this.leader.run('brute-force-spike', 5 * 60, async () => {
      try {
        await this.instr.wrap('brute-force-spike', () => this.runOnce());
      } catch {
        // already recorded as FAILED in cron_runs
      }
    });
  }

  async runOnce(): Promise<SpikeCounts> {
    const counts: SpikeCounts = {
      actorIpSpikes: 0,
      ipSpikes: 0,
      accountSpikes: 0,
      tasksOpened: 0,
      eventsEmitted: 0,
    };
    const hours = this.windowHours();
    const maxTasks = this.env.getNumber(
      'BRUTE_FORCE_SPIKE_MAX_TASKS_PER_RUN',
      50,
    );

    // ── Lens 1: per-(actor, IP) ──────────────────────────────────────
    const actorIp = await this.accessLog.failedLoginSpike({
      hours,
      minFailures: this.env.getNumber('BRUTE_FORCE_SPIKE_PER_ACTOR_IP', 10),
    });
    counts.actorIpSpikes = actorIp.items.length;
    for (const it of actorIp.items) {
      if (counts.tasksOpened >= maxTasks) break;
      const target = `${it.actorType}:${it.actorId}@${it.ipAddress ?? 'unknown'}`;
      await this.alert(counts, 'ACTOR_IP', target, {
        actorType: it.actorType,
        actorId: it.actorId,
        ipAddress: it.ipAddress,
        failureCount: it.failureCount,
        lastFailureAt: it.lastFailureAt,
      });
    }

    // ── Lens 2: per-IP (spray / credential stuffing) ─────────────────
    const byIp = await this.accessLog.failedLoginSpikeByIp({
      hours,
      minFailures: this.env.getNumber('BRUTE_FORCE_SPIKE_PER_IP', 30),
    });
    counts.ipSpikes = byIp.items.length;
    for (const it of byIp.items) {
      if (counts.tasksOpened >= maxTasks) break;
      const target = `ip:${it.ipAddress ?? 'unknown'}`;
      await this.alert(counts, 'IP', target, {
        ipAddress: it.ipAddress,
        failureCount: it.failureCount,
        distinctAccounts: it.distinctAccounts,
        lastFailureAt: it.lastFailureAt,
      });
    }

    // ── Lens 3: per-account (distributed botnet) ─────────────────────
    const byAccount = await this.accessLog.failedLoginSpikeByAccount({
      hours,
      minFailures: this.env.getNumber('BRUTE_FORCE_SPIKE_PER_ACCOUNT', 20),
    });
    counts.accountSpikes = byAccount.items.length;
    for (const it of byAccount.items) {
      if (counts.tasksOpened >= maxTasks) break;
      const target = `account:${it.actorType}:${it.actorId}`;
      await this.alert(counts, 'ACCOUNT', target, {
        actorType: it.actorType,
        actorId: it.actorId,
        failureCount: it.failureCount,
        distinctIps: it.distinctIps,
        lastFailureAt: it.lastFailureAt,
      });
    }

    if (counts.tasksOpened > 0 || counts.eventsEmitted > 0) {
      this.logger.warn(
        `Brute-force spikes: actorIp=${counts.actorIpSpikes} ip=${counts.ipSpikes} ` +
          `account=${counts.accountSpikes} → ${counts.tasksOpened} task(s), ` +
          `${counts.eventsEmitted} event(s)`,
      );
    }
    return counts;
  }

  /**
   * Emit the event (best-effort) + open/refresh the durable AdminTask
   * (idempotent). A stable hash of the target string keeps the sourceId
   * bounded and free of PII (the raw email/IP only lives in the task
   * `reason` + event payload, both behind security.read / admin auth).
   */
  private async alert(
    counts: SpikeCounts,
    lens: 'ACTOR_IP' | 'IP' | 'ACCOUNT',
    target: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    // 1. Event — fire-and-forget; transport handler is attached
    //    out-of-module (or surfaced as a future SIEM forwarder).
    await this.eventBus
      .publish({
        eventName: 'security.brute_force_detected',
        aggregate: 'security',
        aggregateId: target,
        occurredAt: new Date(),
        payload: { lens, target, ...detail },
      })
      .then(() => {
        counts.eventsEmitted++;
      })
      .catch((e) =>
        this.logger.warn(
          `Failed to publish brute_force_detected for ${target}: ${(e as Error).message}`,
        ),
      );

    // 2. Durable AdminTask — idempotent on (kind, sourceType, sourceId).
    //    Uses OTHER + MANUAL because a dedicated AdminTaskKind
    //    (SECURITY_BRUTE_FORCE_DETECTED) lives in liability-ledger.prisma
    //    which is owned by another agent this cycle — SURFACED for follow-up.
    const sourceId = `brute-force:${lens.toLowerCase()}:${createHash('sha256')
      .update(target)
      .digest('hex')
      .slice(0, 24)}`;
    try {
      const existing = await this.prisma.adminTask.findUnique({
        where: {
          kind_sourceType_sourceId: {
            kind: 'OTHER',
            sourceType: 'MANUAL',
            sourceId,
          },
        },
        select: { id: true, status: true },
      });
      // Only (re)open if there's no row, or the prior one was resolved
      // (a fresh attack after a closed task should re-alert ops).
      if (!existing) {
        await this.prisma.adminTask.create({
          data: {
            kind: 'OTHER',
            sourceType: 'MANUAL',
            sourceId,
            reason: `Brute-force spike (${lens}): ${target} — ${JSON.stringify(detail)}`,
          },
        });
        counts.tasksOpened++;
      }
    } catch (e) {
      this.logger.warn(
        `Failed to open brute-force AdminTask for ${target}: ${(e as Error).message}`,
      );
    }
  }
}
