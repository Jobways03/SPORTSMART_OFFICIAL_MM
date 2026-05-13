import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../bootstrap/env/env.service';
import { EventBusService } from '../../../bootstrap/events/event-bus.service';
import {
  SlaTrackerService,
  type ResourceSnapshot,
  type SlaVerdict,
} from '../sla-tracker.service';
import { SlaEscalationService } from '../services/sla-escalation.service';
import { LeaderElectedCron } from '../../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../../cron-observability/cron-instrumentation.service';

/**
 * Phase 6 (PR 6.2) — periodic breach detector.
 *
 * Every 5 minutes:
 *   1. Pulls non-terminal cases (returns / disputes / tickets) plus
 *      their last status-change time.
 *   2. Asks SlaTrackerService for a verdict per (case × policy).
 *   3. For BREACHED + BREACHED_ESCALATE verdicts: upsert an SlaBreach
 *      row keyed by (policy, resource). Idempotent — re-runs find the
 *      existing row and skip.
 *   4. For BREACHED_ESCALATE verdicts whose breach hasn't been
 *      escalated yet: invoke the escalation service, stamp escalatedAt.
 *   5. Mark previously-open breaches as resolved when the case has
 *      transitioned out of the SLA-tracked status.
 *
 * Status-change timestamp pragmatism: we don't have a dedicated
 * `statusEnteredAt` column on disputes / tickets yet (returns has the
 * full status_history table). For v1 we use `updatedAt` as a
 * conservative proxy. Side effect: a non-status update (e.g. a new
 * dispute message) resets the SLA timer. Acceptable for v1 because:
 *   - 5-min cron cadence makes the inaccuracy bounded
 *   - The test suite makes this proxy explicit
 *   - A dedicated column lands in the v2 dedicated-status-history PR
 *
 * Flag: SLA_BREACH_DETECTOR_ENABLED. Default off. Flip after seeding
 * the example policies (PR 6.5).
 */
@Injectable()
export class SlaBreachDetectorCron {
  private readonly logger = new Logger(SlaBreachDetectorCron.name);

  /**
   * Cap how many candidates we scan per run. The cron is best-effort —
   * if the unresolved-case backlog ever exceeds this we'd rather miss
   * a few than blow the connection pool. Bump if needed once the
   * staging numbers settle.
   */
  private static readonly SCAN_LIMIT = 5_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly tracker: SlaTrackerService,
    private readonly escalation: SlaEscalationService,
    private readonly eventBus: EventBusService,
    // Phase 1 (PR 1.2) — escalations are externally visible (Slack /
    // PagerDuty); N replicas firing N escalations per breach is the
    // exact noise this prevents.
    private readonly leader: LeaderElectedCron,
    // Phase 5 (PR 5.2) — cron-run observability. Captures
    // `{ scanned, opened, escalated, resolved }` per tick.
    private readonly instr: CronInstrumentationService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('SLA_BREACH_DETECTOR_ENABLED', false);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;

    await this.leader.run('sla-breach-detector', 10 * 60, async () => {
      // Phase 5 (PR 5.2) — wrap so each run records duration +
      // `{ scanned, opened, escalated, resolved }` in cron_runs.
      try {
        await this.instr.wrap('sla-breach-detector', () => this.runOnce());
      } catch {
        // instr.wrap already recorded the failure in cron_runs;
        // swallow so @nestjs/schedule doesn't double-log.
      }
    });
  }

  private async runOnce(): Promise<{
    scanned: number;
    opened: number;
    escalated: number;
    resolved: number;
  }> {
    const now = new Date();
    let snapshots: ResourceSnapshot[] = [];
    try {
      snapshots = await this.collectCandidates();
    } catch (err) {
      this.logger.error(
        `SLA candidate collection failed: ${(err as Error).message}`,
      );
      return { scanned: 0, opened: 0, escalated: 0, resolved: 0 };
    }

    if (snapshots.length === 0) {
      return { scanned: 0, opened: 0, escalated: 0, resolved: 0 };
    }

    let verdicts: SlaVerdict[] = [];
    try {
      verdicts = await this.tracker.evaluate(snapshots, now);
    } catch (err) {
      this.logger.error(
        `SLA tracker evaluate failed: ${(err as Error).message}`,
      );
      return { scanned: snapshots.length, opened: 0, escalated: 0, resolved: 0 };
    }

    let openedCount = 0;
    let escalatedCount = 0;
    for (const v of verdicts) {
      if (v.state !== 'BREACHED' && v.state !== 'BREACHED_ESCALATE') {
        continue;
      }
      try {
        const opened = await this.upsertBreach(v, now);
        if (opened) openedCount++;
        if (v.state === 'BREACHED_ESCALATE') {
          const escalated = await this.maybeEscalate(v, now);
          if (escalated) escalatedCount++;
        }
      } catch (err) {
        this.logger.warn(
          `SLA breach upsert failed for ${v.resourceType} ${v.resourceId}: ${(err as Error).message}`,
        );
      }
    }

    let resolvedCount = 0;
    try {
      resolvedCount = await this.resolveStaleBreaches(snapshots, now);
    } catch (err) {
      this.logger.warn(
        `SLA stale-breach resolve failed: ${(err as Error).message}`,
      );
    }

    if (openedCount > 0 || escalatedCount > 0 || resolvedCount > 0) {
      this.logger.log(
        `SLA cron: opened=${openedCount} escalated=${escalatedCount} resolved=${resolvedCount}`,
      );
    }

    return {
      scanned: snapshots.length,
      opened: openedCount,
      escalated: escalatedCount,
      resolved: resolvedCount,
    };
  }

  private async collectCandidates(): Promise<ResourceSnapshot[]> {
    const TERMINAL_RETURN = [
      'CANCELLED',
      'REJECTED',
      'COMPLETED',
      'REFUNDED',
    ];
    const TERMINAL_DISPUTE = [
      'CLOSED',
      'RESOLVED_BUYER',
      'RESOLVED_SELLER',
      'RESOLVED_SPLIT',
    ];
    const TERMINAL_TICKET = ['CLOSED'];

    const limit = SlaBreachDetectorCron.SCAN_LIMIT;
    const [returns, disputes, tickets] = await Promise.all([
      this.prisma.return.findMany({
        where: { status: { notIn: TERMINAL_RETURN as any } },
        select: { id: true, status: true, updatedAt: true },
        take: limit,
        orderBy: { updatedAt: 'asc' }, // oldest-untouched first → hits SLA limit soonest
      }),
      this.prisma.dispute.findMany({
        where: { status: { notIn: TERMINAL_DISPUTE as any } },
        select: { id: true, status: true, updatedAt: true },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.ticket.findMany({
        where: { status: { notIn: TERMINAL_TICKET as any } },
        select: { id: true, status: true, lastMessageAt: true },
        take: limit,
        orderBy: { lastMessageAt: 'asc' },
      }),
    ]);

    const out: ResourceSnapshot[] = [];
    for (const r of returns) {
      out.push({
        resourceType: 'return',
        resourceId: r.id,
        status: r.status as string,
        enteredStatusAt: r.updatedAt,
      });
    }
    for (const d of disputes) {
      out.push({
        resourceType: 'dispute',
        resourceId: d.id,
        status: d.status as string,
        enteredStatusAt: d.updatedAt,
      });
    }
    for (const t of tickets) {
      out.push({
        resourceType: 'ticket',
        resourceId: t.id,
        status: t.status as string,
        // Tickets carry an explicit lastMessageAt — better proxy than
        // updatedAt because admin assignments shouldn't reset the timer.
        enteredStatusAt: t.lastMessageAt,
      });
    }
    return out;
  }

  /**
   * Returns true when a NEW breach row was inserted (i.e. first time
   * we noticed this case crossed the deadline).
   */
  private async upsertBreach(
    v: SlaVerdict,
    now: Date,
  ): Promise<boolean> {
    const existing = await this.prisma.slaBreach.findUnique({
      where: {
        policyId_resourceType_resourceId: {
          policyId: v.policyId,
          resourceType: v.resourceType,
          resourceId: v.resourceId,
        },
      },
    });

    if (existing && !existing.resolvedAt) {
      // Re-run on an already-open breach. Nothing to do here — escalate
      // path is handled separately so it doesn't race with idempotent
      // upsert when both branches fire on the same verdict.
      return false;
    }

    await this.prisma.slaBreach.upsert({
      where: {
        policyId_resourceType_resourceId: {
          policyId: v.policyId,
          resourceType: v.resourceType,
          resourceId: v.resourceId,
        },
      },
      create: {
        policyId: v.policyId,
        resourceType: v.resourceType,
        resourceId: v.resourceId,
        status: v.status,
        enteredStatusAt: v.enteredStatusAt,
        deadlineAt: v.deadlineAt,
        breachedAt: now,
      },
      update: {
        // Re-opening a previously-resolved breach (case slid back into
        // the tracked status). Reset the resolution fields.
        status: v.status,
        enteredStatusAt: v.enteredStatusAt,
        deadlineAt: v.deadlineAt,
        breachedAt: now,
        resolvedAt: null,
        overdueMinutes: null,
        escalatedAt: null,
      },
    });

    try {
      await this.eventBus.publish({
        eventName: 'sla.breached',
        aggregate: v.resourceType,
        aggregateId: v.resourceId,
        occurredAt: now,
        payload: {
          resourceType: v.resourceType,
          resourceId: v.resourceId,
          status: v.status,
          policyId: v.policyId,
          policyName: v.policyName,
          deadlineAt: v.deadlineAt.toISOString(),
          breachedAt: now.toISOString(),
        },
      });
    } catch {
      // events are best-effort
    }
    return true;
  }

  private async maybeEscalate(v: SlaVerdict, now: Date): Promise<boolean> {
    if (!v.escalateAction) return false;
    const breach = await this.prisma.slaBreach.findUnique({
      where: {
        policyId_resourceType_resourceId: {
          policyId: v.policyId,
          resourceType: v.resourceType,
          resourceId: v.resourceId,
        },
      },
    });
    if (!breach || breach.escalatedAt || breach.resolvedAt) return false;

    await this.escalation.escalate({
      resourceType: v.resourceType,
      resourceId: v.resourceId,
      action: v.escalateAction,
      policyName: v.policyName,
    });
    await this.prisma.slaBreach.update({
      where: { id: breach.id },
      data: { escalatedAt: now },
    });
    return true;
  }

  /**
   * Closes breaches whose case has transitioned out of the breached
   * status. Returns the number of rows we resolved this pass.
   */
  private async resolveStaleBreaches(
    snapshots: ResourceSnapshot[],
    now: Date,
  ): Promise<number> {
    // Build a set of (resourceType, resourceId, status) for currently-
    // breached cases so we can find breaches whose case status moved on.
    const currentByResource = new Map<string, string>(
      snapshots.map((s) => [`${s.resourceType}:${s.resourceId}`, s.status]),
    );

    const open = await this.prisma.slaBreach.findMany({
      where: { resolvedAt: null },
      take: SlaBreachDetectorCron.SCAN_LIMIT,
    });

    let resolved = 0;
    for (const b of open) {
      const cur = currentByResource.get(`${b.resourceType}:${b.resourceId}`);
      // Resolve when:
      //   - the case dropped out of our snapshot list (terminal status), or
      //   - the case's current status differs from the breached status
      //     (it transitioned to a different non-terminal state, e.g.
      //     dispute UNDER_REVIEW → AWAITING_INFO).
      if (cur === undefined || cur !== b.status) {
        const overdueMinutes = Math.max(
          0,
          Math.floor((now.getTime() - b.deadlineAt.getTime()) / 60_000),
        );
        await this.prisma.slaBreach.update({
          where: { id: b.id },
          data: { resolvedAt: now, overdueMinutes },
        });
        resolved += 1;
      }
    }
    return resolved;
  }
}
