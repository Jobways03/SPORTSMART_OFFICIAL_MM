import { Injectable } from '@nestjs/common';
import type { SlaPolicy } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';

/**
 * Phase 6 (PR 6.1) — SLA tracker.
 *
 * Pure-ish: takes a list of resource snapshots ({type, id, status,
 * enteredStatusAt}) and compares them against the SlaPolicy table.
 * Returns a per-resource verdict the cron writes back as breaches and
 * the queue API reads to colour rows.
 *
 * Why a service rather than inline math:
 *   - Two callers: the breach detector cron and the queue endpoint.
 *     Both need the same "is this breaching?" math; centralising it
 *     prevents drift between "the cron decided breach" and "the UI
 *     shows breach" interpretations.
 *   - Caching the policy list within a request reduces 1 DB hit per
 *     resource to 1 per request.
 */

export type SlaState =
  /** Within deadline and outside the warning window. */
  | 'OK'
  /** Within deadline but inside the warning window. */
  | 'WARNING'
  /** Past the deadline, no escalation yet. */
  | 'BREACHED'
  /** Past the deadline AND past the escalate-after window. */
  | 'BREACHED_ESCALATE';

export interface ResourceSnapshot {
  resourceType: string;
  resourceId: string;
  status: string;
  enteredStatusAt: Date;
}

export interface SlaVerdict {
  resourceType: string;
  resourceId: string;
  status: string;
  policyId: string;
  policyName: string;
  enteredStatusAt: Date;
  deadlineAt: Date;
  state: SlaState;
  /** Negative when past deadline. */
  remainingMinutes: number;
  /** Set when state is BREACHED_ESCALATE; matches the policy.escalateAction. */
  escalateAction?: string | null;
}

@Injectable()
export class SlaTrackerService {
  /**
   * Cache duration for the policy list. The cron runs every 5 minutes,
   * a 60s TTL means each cron run does at most 1 read. Admins editing
   * policies see their changes within 60s.
   */
  private static readonly POLICY_CACHE_TTL_MS = 60_000;
  private cache: { rows: SlaPolicy[]; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  invalidate(): void {
    this.cache = null;
  }

  /**
   * Evaluate an in-memory list of snapshots against the policy table.
   * Returns one verdict per (snapshot × matching policy). Snapshots
   * with no matching policy are skipped — they're not under SLA.
   */
  async evaluate(
    snapshots: ResourceSnapshot[],
    now: Date = new Date(),
  ): Promise<SlaVerdict[]> {
    if (snapshots.length === 0) return [];
    const policies = await this.loadPolicies();
    const out: SlaVerdict[] = [];
    for (const s of snapshots) {
      const matched = policies.filter(
        (p) =>
          p.enabled &&
          p.resourceType === s.resourceType &&
          p.status === s.status,
      );
      for (const p of matched) {
        out.push(this.judge(s, p, now));
      }
    }
    return out;
  }

  /**
   * Convenience wrapper for a single snapshot. Returns the most-urgent
   * verdict (lowest remaining minutes) when multiple policies fire.
   */
  async evaluateOne(
    snapshot: ResourceSnapshot,
    now: Date = new Date(),
  ): Promise<SlaVerdict | null> {
    const verdicts = await this.evaluate([snapshot], now);
    if (verdicts.length === 0) return null;
    verdicts.sort((a, b) => a.remainingMinutes - b.remainingMinutes);
    return verdicts[0];
  }

  private judge(
    s: ResourceSnapshot,
    p: SlaPolicy,
    now: Date,
  ): SlaVerdict {
    const deadlineMs =
      s.enteredStatusAt.getTime() + p.deadlineMinutes * 60_000;
    const deadlineAt = new Date(deadlineMs);
    const remainingMinutes = Math.floor(
      (deadlineMs - now.getTime()) / 60_000,
    );
    let state: SlaState = 'OK';
    let escalateAction: string | null | undefined = undefined;

    if (now.getTime() < deadlineMs) {
      // Inside the deadline. Apply the optional warning band.
      if (
        p.warningMinutesBeforeDeadline !== null &&
        p.warningMinutesBeforeDeadline !== undefined &&
        remainingMinutes <= p.warningMinutesBeforeDeadline
      ) {
        state = 'WARNING';
      }
    } else {
      // Past the deadline.
      const overdueMs = now.getTime() - deadlineMs;
      const escalateAfterMs =
        p.escalateAfterMinutes !== null && p.escalateAfterMinutes !== undefined
          ? p.escalateAfterMinutes * 60_000
          : null;
      if (escalateAfterMs !== null && overdueMs >= escalateAfterMs) {
        state = 'BREACHED_ESCALATE';
        escalateAction = p.escalateAction;
      } else {
        state = 'BREACHED';
      }
    }

    return {
      resourceType: s.resourceType,
      resourceId: s.resourceId,
      status: s.status,
      policyId: p.id,
      policyName: p.name,
      enteredStatusAt: s.enteredStatusAt,
      deadlineAt,
      state,
      remainingMinutes,
      escalateAction,
    };
  }

  private async loadPolicies(): Promise<SlaPolicy[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.rows;
    const rows = await this.prisma.slaPolicy.findMany({
      where: { enabled: true },
    });
    this.cache = {
      rows,
      expiresAt: now + SlaTrackerService.POLICY_CACHE_TTL_MS,
    };
    return rows;
  }
}
