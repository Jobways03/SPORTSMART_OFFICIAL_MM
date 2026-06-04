import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  SlaTrackerService,
  type ResourceSnapshot,
  type SlaVerdict,
} from '../sla/sla-tracker.service';
import { RiskScoreService } from '../risk/risk-score.service';

/**
 * Phase 6 (PR 6.4) — Queue rollup service.
 *
 * Single shape across the three resource types (returns / disputes /
 * tickets) so the admin UI renders one queue list with consistent
 * columns. Sort key = SLA remaining ASC (most-urgent first), then
 * risk score DESC, then createdAt ASC (FIFO tie-breaker).
 *
 * The service owns the join across three sources of truth:
 *   - the resource table (status, age, basic identifiers),
 *   - SlaTrackerService (deadline + breach state),
 *   - RiskScoreService (score + tier).
 *
 * Each item carries the full triplet so the queue UI can colour rows
 * and render a "why's this urgent?" tooltip without follow-up calls.
 */

export type QueueResource = 'dispute' | 'return' | 'ticket';

export interface QueueItem {
  resourceType: QueueResource;
  resourceId: string;
  status: string;
  number: string;
  createdAt: Date;
  enteredStatusAt: Date;
  // SLA
  slaState: 'OK' | 'WARNING' | 'BREACHED' | 'BREACHED_ESCALATE' | 'NO_POLICY';
  slaDeadlineAt: Date | null;
  slaRemainingMinutes: number | null;
  slaPolicyName: string | null;
  // Risk
  riskScore: number;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface QueueListParams {
  resource: QueueResource;
  page: number;
  limit: number;
  /** Filter to only breaching cases. */
  onlyBreaching?: boolean;
  /** Filter to a minimum risk tier. */
  minTier?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface QueueSummary {
  resource: QueueResource;
  total: number;
  breaching: number;
  warning: number;
  highRisk: number;
}

@Injectable()
export class QueueService {
  /** Hard cap so a misconfigured pagination call can't tank Postgres. */
  private static readonly MAX_LIMIT = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracker: SlaTrackerService,
    private readonly risk: RiskScoreService,
  ) {}

  async list(params: QueueListParams): Promise<{
    items: QueueItem[];
    total: number;
  }> {
    const limit = Math.min(
      Math.max(1, params.limit),
      QueueService.MAX_LIMIT,
    );
    const offset = (Math.max(1, params.page) - 1) * limit;

    const snapshots = await this.fetchSnapshots(params.resource);
    const verdicts = await this.tracker.evaluate(snapshots);

    // Index verdicts by resourceId. Multiple verdicts per resource (one
    // per matching policy) collapse to the most-urgent.
    const verdictByResource = new Map<string, SlaVerdict>();
    for (const v of verdicts) {
      const existing = verdictByResource.get(v.resourceId);
      if (!existing || v.remainingMinutes < existing.remainingMinutes) {
        verdictByResource.set(v.resourceId, v);
      }
    }

    // One batched risk lookup for the whole snapshot set — previously this
    // was an `await getOrZero` per row inside the loop (N sequential DB
    // round-trips; summary() multiplied that by three queues).
    const riskByResource = await this.risk.getManyOrZero(
      params.resource,
      snapshots.map((s) => s.resourceId),
    );

    const items: QueueItem[] = [];
    for (const s of snapshots) {
      const verdict = verdictByResource.get(s.resourceId);
      const risk = riskByResource.get(s.resourceId) ?? { score: 0, tier: 'LOW' };
      const item: QueueItem = {
        resourceType: params.resource,
        resourceId: s.resourceId,
        status: s.status,
        number: (s as any).number ?? '',
        createdAt: (s as any).createdAt ?? s.enteredStatusAt,
        enteredStatusAt: s.enteredStatusAt,
        slaState: verdict?.state ?? 'NO_POLICY',
        slaDeadlineAt: verdict?.deadlineAt ?? null,
        slaRemainingMinutes: verdict?.remainingMinutes ?? null,
        slaPolicyName: verdict?.policyName ?? null,
        riskScore: risk.score,
        riskTier: risk.tier as QueueItem['riskTier'],
      };
      items.push(item);
    }

    // Filter then sort.
    let filtered = items;
    if (params.onlyBreaching) {
      filtered = filtered.filter(
        (i) =>
          i.slaState === 'BREACHED' ||
          i.slaState === 'BREACHED_ESCALATE',
      );
    }
    if (params.minTier) {
      const tierRank = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;
      const min = tierRank[params.minTier];
      filtered = filtered.filter((i) => tierRank[i.riskTier] >= min);
    }

    filtered.sort((a, b) => {
      const aRem = a.slaRemainingMinutes ?? Number.MAX_SAFE_INTEGER;
      const bRem = b.slaRemainingMinutes ?? Number.MAX_SAFE_INTEGER;
      if (aRem !== bRem) return aRem - bRem;
      if (a.riskScore !== b.riskScore) return b.riskScore - a.riskScore;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const total = filtered.length;
    const slice = filtered.slice(offset, offset + limit);
    return { items: slice, total };
  }

  /**
   * Aggregate counts per queue. Cheap because it works off the same
   * snapshot list — no extra DB queries beyond what list() already
   * does for snapshots/verdicts/risk.
   */
  async summary(): Promise<QueueSummary[]> {
    const out: QueueSummary[] = [];
    for (const r of ['return', 'dispute', 'ticket'] as QueueResource[]) {
      const { items, total } = await this.list({
        resource: r,
        page: 1,
        limit: QueueService.MAX_LIMIT,
      });
      out.push({
        resource: r,
        total,
        breaching: items.filter(
          (i) =>
            i.slaState === 'BREACHED' || i.slaState === 'BREACHED_ESCALATE',
        ).length,
        warning: items.filter((i) => i.slaState === 'WARNING').length,
        highRisk: items.filter((i) => i.riskTier === 'HIGH').length,
      });
    }
    return out;
  }

  private async fetchSnapshots(
    resource: QueueResource,
  ): Promise<Array<ResourceSnapshot & { number?: string; createdAt?: Date }>> {
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
    const limit = QueueService.MAX_LIMIT * 5; // room for sort+filter

    if (resource === 'return') {
      const rows = await this.prisma.return.findMany({
        where: { status: { notIn: TERMINAL_RETURN as any } },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          createdAt: true,
          returnNumber: true,
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      });
      return rows.map((r) => ({
        resourceType: 'return',
        resourceId: r.id,
        status: r.status as string,
        enteredStatusAt: r.updatedAt,
        number: r.returnNumber,
        createdAt: r.createdAt,
      }));
    }
    if (resource === 'dispute') {
      const rows = await this.prisma.dispute.findMany({
        where: { status: { notIn: TERMINAL_DISPUTE as any } },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          createdAt: true,
          disputeNumber: true,
        },
        take: limit,
        orderBy: { updatedAt: 'asc' },
      });
      return rows.map((d) => ({
        resourceType: 'dispute',
        resourceId: d.id,
        status: d.status as string,
        enteredStatusAt: d.updatedAt,
        number: d.disputeNumber,
        createdAt: d.createdAt,
      }));
    }
    // tickets
    const rows = await this.prisma.ticket.findMany({
      where: { status: { notIn: TERMINAL_TICKET as any } },
      select: {
        id: true,
        status: true,
        lastMessageAt: true,
        createdAt: true,
        ticketNumber: true,
      },
      take: limit,
      orderBy: { lastMessageAt: 'asc' },
    });
    return rows.map((t) => ({
      resourceType: 'ticket',
      resourceId: t.id,
      status: t.status as string,
      enteredStatusAt: t.lastMessageAt,
      number: t.ticketNumber,
      createdAt: t.createdAt,
    }));
  }
}
