import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { recomputeStoredRowHash } from './audit-hash.util';
import { AUDIT_SELF_ACTIONS } from './audit-event-types';

/**
 * Phase 8 (PR 8.1) + Phase 203/204 — Audit chain anchor + verification.
 *
 * Anchoring (`pinNext`) is unchanged in spirit: it pins the current chain head
 * so the verifier can start O(1) from the latest checkpoint instead of genesis.
 *
 * Verification (Phase 204) is substantially hardened:
 *   #5/#6  every row's CONTENT hash is recomputed and HARD-FAILED on mismatch
 *          (v2 rows are content-verifiable now that the writer hashes over the
 *          stored createdAt), and findings carry a typed `AuditChainIssueType`
 *          instead of a free-text reason;
 *   #3     each run + its issues are PERSISTED (AuditChainVerificationRun /
 *          …Issue) for the audit-history UI and the "we checked" trail;
 *   #2/#8  a cursor-batched FULL walk capability (`verifyFull`) underpins the
 *          async job;
 *   #4     the run is self-audited (audit.chain.verified);
 *   #7     a break emits `audit.chain.break_detected` for the alert handler.
 */

/** A single verification finding, typed per Phase 204 #6. */
export type AuditChainIssueTypeValue =
  | 'HASH_MISMATCH'
  | 'PREVIOUS_HASH_MISMATCH'
  | 'MISSING_SEQUENCE'
  | 'DUPLICATE_SEQUENCE'
  | 'OUT_OF_ORDER_ROW'
  | 'GENESIS_INVALID'
  | 'ANCHOR_MISMATCH'
  | 'ROW_UNREADABLE'
  | 'UNKNOWN';

export interface ChainBreak {
  id: string | null;
  issueType: AuditChainIssueTypeValue;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  reason: string;
  createdAt: Date | null;
  expectedHash?: string | null;
  actualHash?: string | null;
}

export interface ChainVerifyResult {
  anchorSequence: number | null;
  anchorCreatedAt: Date | null;
  rowsChecked: number;
  breaks: ChainBreak[];
}

// Severity per issue type — a content edit outranks an ordering anomaly.
const SEVERITY: Record<AuditChainIssueTypeValue, ChainBreak['severity']> = {
  HASH_MISMATCH: 'CRITICAL',
  PREVIOUS_HASH_MISMATCH: 'CRITICAL',
  GENESIS_INVALID: 'CRITICAL',
  ANCHOR_MISMATCH: 'CRITICAL',
  MISSING_SEQUENCE: 'HIGH',
  DUPLICATE_SEQUENCE: 'HIGH',
  OUT_OF_ORDER_ROW: 'MEDIUM',
  ROW_UNREADABLE: 'HIGH',
  UNKNOWN: 'HIGH',
};

type AuditRow = {
  id: string;
  sequenceNumber: bigint;
  actorId: string | null;
  actorRole: string | null;
  actorType: string | null;
  action: string;
  module: string;
  resource: string;
  resourceId: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  prevHash: string | null;
  hash: string;
  schemaVersion: number;
  createdAt: Date;
};

const ROW_SELECT = {
  id: true,
  sequenceNumber: true,
  actorId: true,
  actorRole: true,
  actorType: true,
  action: true,
  module: true,
  resource: true,
  resourceId: true,
  oldValue: true,
  newValue: true,
  metadata: true,
  ipAddress: true,
  userAgent: true,
  requestId: true,
  prevHash: true,
  hash: true,
  schemaVersion: true,
  createdAt: true,
} as const;

@Injectable()
export class AuditChainAnchorService {
  private readonly logger = new Logger(AuditChainAnchorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
  ) {}

  // ── Anchoring (unchanged behaviour, ordered by sequenceNumber) ────────────

  async pinNext(): Promise<
    | { pinned: false }
    | { pinned: true; sequence: number; upToAuditLogId: string; rowsCovered: number }
  > {
    const latestAnchor = await this.prisma.auditChainAnchor.findFirst({
      orderBy: { sequence: 'desc' },
    });

    const cutoffSeq = latestAnchor
      ? await this.prisma.auditLog
          .findUnique({
            where: { id: latestAnchor.upToAuditLogId },
            select: { sequenceNumber: true },
          })
          .then((r) => r?.sequenceNumber ?? null)
      : null;

    const latestRow = await this.prisma.auditLog.findFirst({
      where: cutoffSeq != null ? { sequenceNumber: { gt: cutoffSeq } } : undefined,
      orderBy: { sequenceNumber: 'desc' },
      select: { id: true, hash: true, sequenceNumber: true },
    });

    if (!latestRow || !latestRow.hash) return { pinned: false };

    const rowsCovered =
      cutoffSeq != null
        ? await this.prisma.auditLog.count({
            where: { sequenceNumber: { gt: cutoffSeq, lte: latestRow.sequenceNumber } },
          })
        : await this.prisma.auditLog.count({
            where: { sequenceNumber: { lte: latestRow.sequenceNumber } },
          });

    const sequence = (latestAnchor?.sequence ?? 0) + 1;
    await this.prisma.auditChainAnchor.create({
      data: {
        sequence,
        upToAuditLogId: latestRow.id,
        expectedHash: latestRow.hash,
        rowsCovered,
      },
    });
    return { pinned: true, sequence, upToAuditLogId: latestRow.id, rowsCovered };
  }

  // ── FAST verify — from latest anchor, persisted + self-audited ────────────

  /**
   * Verify forward from the latest anchor up to `limit` rows. Persists a
   * RUN row, records typed issues, self-audits, and alerts on any break.
   */
  async verifyFromLatestAnchor(
    limit = 10_000,
    startedBy?: string,
  ): Promise<ChainVerifyResult & { runId: string }> {
    const run = await this.prisma.auditChainVerificationRun.create({
      data: { runType: 'FAST', status: 'RUNNING', startedBy: startedBy ?? null },
      select: { id: true },
    });
    try {
      const result = await this.runFastVerify(limit);
      await this.finishRun(run.id, result, 'FAST', startedBy);
      return { ...result, runId: run.id };
    } catch (err) {
      await this.failRun(run.id, err);
      throw err;
    }
  }

  private async runFastVerify(limit: number): Promise<ChainVerifyResult> {
    const anchor = await this.prisma.auditChainAnchor.findFirst({
      orderBy: { sequence: 'desc' },
    });
    if (!anchor) {
      // No anchor yet — bounded walk from genesis.
      return this.runWalkFromGenesis(limit);
    }

    const breaks: ChainBreak[] = [];
    const anchoredRow = (await this.prisma.auditLog.findUnique({
      where: { id: anchor.upToAuditLogId },
      select: ROW_SELECT,
    })) as AuditRow | null;

    if (!anchoredRow) {
      breaks.push(this.mk(anchor.upToAuditLogId, 'ROW_UNREADABLE', 'anchored row missing', null));
      return { anchorSequence: anchor.sequence, anchorCreatedAt: anchor.createdAt, rowsChecked: 0, breaks };
    }
    if (anchoredRow.hash !== anchor.expectedHash) {
      breaks.push(
        this.mk(anchor.upToAuditLogId, 'ANCHOR_MISMATCH',
          `anchor.expected_hash ${anchor.expectedHash} != row.hash ${anchoredRow.hash}`,
          anchoredRow.createdAt, anchor.expectedHash, anchoredRow.hash),
      );
    }
    // The anchored row's own content is the trust root for the walk — verify it.
    this.checkContent(anchoredRow, breaks);

    const rows = (await this.prisma.auditLog.findMany({
      where: { sequenceNumber: { gt: anchoredRow.sequenceNumber } },
      orderBy: { sequenceNumber: 'asc' },
      take: limit,
      select: ROW_SELECT,
    })) as AuditRow[];

    const rowsChecked = this.walk(rows, anchoredRow.hash, anchoredRow.sequenceNumber, breaks);
    return { anchorSequence: anchor.sequence, anchorCreatedAt: anchor.createdAt, rowsChecked, breaks };
  }

  private async runWalkFromGenesis(limit: number): Promise<ChainVerifyResult> {
    const rows = (await this.prisma.auditLog.findMany({
      orderBy: { sequenceNumber: 'asc' },
      take: limit,
      select: ROW_SELECT,
    })) as AuditRow[];
    const breaks: ChainBreak[] = [];
    // Genesis row must have null prevHash.
    if (rows[0] && rows[0].prevHash !== null) {
      breaks.push(this.mk(rows[0].id, 'GENESIS_INVALID', 'genesis row has non-null prevHash', rows[0].createdAt));
    }
    const rowsChecked = this.walk(rows, null, null, breaks);
    return { anchorSequence: null, anchorCreatedAt: null, rowsChecked, breaks };
  }

  // ── FULL verify — cursor-batched over the whole chain (#2/#8) ─────────────

  /**
   * Walk the ENTIRE chain in `batchSize` cursor pages. Bounded memory, no 10K
   * cap. Backs the async FULL job (the job framework that schedules/streams
   * this is SURFACED — see notes — but the capability is real and tested).
   */
  async verifyFull(
    opts: { batchSize?: number; startedBy?: string; maxBreaks?: number } = {},
  ): Promise<ChainVerifyResult & { runId: string }> {
    const batchSize = Math.min(Math.max(opts.batchSize ?? 5_000, 100), 20_000);
    const maxBreaks = opts.maxBreaks ?? 10_000;
    const run = await this.prisma.auditChainVerificationRun.create({
      data: { runType: 'FULL', status: 'RUNNING', startedBy: opts.startedBy ?? null },
      select: { id: true },
    });

    try {
      const breaks: ChainBreak[] = [];
      let prevHash: string | null = null;
      let prevSeq: bigint | null = null;
      let rowsChecked = 0;
      let cursorSeq: bigint | null = null;
      let first = true;

      for (;;) {
        const rows = (await this.prisma.auditLog.findMany({
          where: cursorSeq != null ? { sequenceNumber: { gt: cursorSeq } } : undefined,
          orderBy: { sequenceNumber: 'asc' },
          take: batchSize,
          select: ROW_SELECT,
        })) as AuditRow[];
        if (rows.length === 0) break;

        if (first && rows[0]!.prevHash !== null) {
          breaks.push(this.mk(rows[0]!.id, 'GENESIS_INVALID', 'genesis row has non-null prevHash', rows[0]!.createdAt));
        }
        first = false;

        for (const r of rows) {
          rowsChecked += 1;
          this.checkRow(r, prevHash, prevSeq, breaks);
          prevHash = r.hash;
          prevSeq = r.sequenceNumber;
          if (breaks.length >= maxBreaks) break;
        }
        cursorSeq = rows[rows.length - 1]!.sequenceNumber;
        if (rows.length < batchSize || breaks.length >= maxBreaks) break;
      }

      const result: ChainVerifyResult = {
        anchorSequence: null,
        anchorCreatedAt: null,
        rowsChecked,
        breaks,
      };
      await this.finishRun(run.id, result, 'FULL', opts.startedBy);
      return { ...result, runId: run.id };
    } catch (err) {
      await this.failRun(run.id, err);
      throw err;
    }
  }

  // ── Sampling (#9) ─────────────────────────────────────────────────────────

  /**
   * Verify a contiguous sequence-number range [fromSeq, toSeq]. The span is
   * capped (50k sequence values) so a "sample" can't become a full scan; a
   * larger range silently clamps `toSeq` down.
   */
  async verifyRange(
    fromSeq: bigint,
    toSeqRaw: bigint,
    startedBy?: string,
  ): Promise<ChainVerifyResult & { runId: string }> {
    const MAX_SPAN = 50_000n;
    const toSeq = toSeqRaw - fromSeq > MAX_SPAN ? fromSeq + MAX_SPAN : toSeqRaw;
    const run = await this.prisma.auditChainVerificationRun.create({
      data: { runType: 'SAMPLE', status: 'RUNNING', startedBy: startedBy ?? null },
      select: { id: true },
    });
    try {
      // Anchor the walk on the row immediately before the range so prevHash
      // linkage is checkable at the boundary.
      const before = (await this.prisma.auditLog.findFirst({
        where: { sequenceNumber: { lt: fromSeq } },
        orderBy: { sequenceNumber: 'desc' },
        select: ROW_SELECT,
      })) as AuditRow | null;

      const rows = (await this.prisma.auditLog.findMany({
        where: { sequenceNumber: { gte: fromSeq, lte: toSeq } },
        orderBy: { sequenceNumber: 'asc' },
        select: ROW_SELECT,
      })) as AuditRow[];

      const breaks: ChainBreak[] = [];
      const rowsChecked = this.walk(
        rows,
        before?.hash ?? null,
        before?.sequenceNumber ?? null,
        breaks,
      );
      const result: ChainVerifyResult = {
        anchorSequence: null,
        anchorCreatedAt: null,
        rowsChecked,
        breaks,
      };
      await this.finishRun(run.id, result, 'SAMPLE', startedBy);
      return { ...result, runId: run.id };
    } catch (err) {
      await this.failRun(run.id, err);
      throw err;
    }
  }

  // ── Shared walk + per-row checks ─────────────────────────────────────────

  /** Walk a contiguous (ascending sequence) slice; returns rows checked. */
  private walk(
    rows: AuditRow[],
    seedPrevHash: string | null,
    seedPrevSeq: bigint | null,
    breaks: ChainBreak[],
  ): number {
    let prevHash = seedPrevHash;
    let prevSeq = seedPrevSeq;
    let checked = 0;
    for (const r of rows) {
      checked += 1;
      this.checkRow(r, prevHash, prevSeq, breaks);
      prevHash = r.hash;
      prevSeq = r.sequenceNumber;
    }
    return checked;
  }

  private checkRow(
    r: AuditRow,
    prevHash: string | null,
    prevSeq: bigint | null,
    breaks: ChainBreak[],
  ): void {
    // Linkage.
    if (r.prevHash !== prevHash) {
      breaks.push(
        this.mk(r.id, 'PREVIOUS_HASH_MISMATCH',
          `expected prevHash ${prevHash ?? 'null'}, got ${r.prevHash ?? 'null'}`,
          r.createdAt, prevHash, r.prevHash),
      );
    }
    // Sequence continuity (only meaningful within a contiguous walk).
    if (prevSeq != null) {
      if (r.sequenceNumber === prevSeq) {
        breaks.push(this.mk(r.id, 'DUPLICATE_SEQUENCE', `duplicate sequence ${r.sequenceNumber}`, r.createdAt));
      } else if (r.sequenceNumber < prevSeq) {
        breaks.push(this.mk(r.id, 'OUT_OF_ORDER_ROW', `sequence ${r.sequenceNumber} < previous ${prevSeq}`, r.createdAt));
      } else if (r.sequenceNumber > prevSeq + 1n) {
        breaks.push(
          this.mk(r.id, 'MISSING_SEQUENCE',
            `gap: jumped from ${prevSeq} to ${r.sequenceNumber}`, r.createdAt),
        );
      }
    }
    // Content (#5/#6) — HARD-FAIL on a recomputable v2 row.
    this.checkContent(r, breaks);
  }

  private checkContent(r: AuditRow, breaks: ChainBreak[]): void {
    const recomputed = recomputeStoredRowHash(r);
    if (recomputed !== null && recomputed !== r.hash) {
      breaks.push(
        this.mk(r.id, 'HASH_MISMATCH',
          'stored hash does not match recomputed content hash',
          r.createdAt, recomputed, r.hash),
      );
    }
  }

  private mk(
    id: string | null,
    issueType: AuditChainIssueTypeValue,
    reason: string,
    createdAt: Date | null,
    expectedHash?: string | null,
    actualHash?: string | null,
  ): ChainBreak {
    return { id, issueType, severity: SEVERITY[issueType], reason, createdAt, expectedHash, actualHash };
  }

  // ── Run persistence + alerting + self-audit ──────────────────────────────

  private async finishRun(
    runId: string,
    result: ChainVerifyResult,
    runType: 'FAST' | 'FULL' | 'SAMPLE',
    startedBy?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (result.breaks.length > 0) {
        await tx.auditChainVerificationIssue.createMany({
          data: result.breaks.map((b) => ({
            verificationRunId: runId,
            auditLogId: b.id,
            issueType: b.issueType as any,
            severity: b.severity,
            expectedHash: b.expectedHash ?? null,
            actualHash: b.actualHash ?? null,
            details: b.reason,
          })),
        });
      }
      await tx.auditChainVerificationRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          rowsChecked: result.rowsChecked,
          issuesFound: result.breaks.length,
          resultSummary: {
            runType,
            anchorSequence: result.anchorSequence,
            byType: this.countByType(result.breaks),
          } as any,
        },
      });
    });

    // #4 — self-audit the verification itself (best-effort; never block the run).
    try {
      await this.events.publish({
        eventName: AUDIT_SELF_ACTIONS.CHAIN_VERIFIED,
        aggregate: 'AuditChainVerificationRun',
        aggregateId: runId,
        occurredAt: new Date(),
        payload: {
          runId,
          runType,
          startedBy: startedBy ?? null,
          rowsChecked: result.rowsChecked,
          issuesFound: result.breaks.length,
        },
      });
    } catch (e) {
      this.logger.warn(`chain.verified self-audit emit failed: ${(e as Error).message}`);
    }

    // #7 — alert on any break. The handler raises an AdminTask / forwards to
    // SIEM (external transport SURFACED). DomainEventLogHandler also persists
    // this into EventLog, giving a durable record even if no handler runs.
    if (result.breaks.length > 0) {
      this.logger.error(
        `AUDIT CHAIN BREAK: run ${runId} found ${result.breaks.length} issue(s): ` +
          JSON.stringify(this.countByType(result.breaks)),
      );
      try {
        await this.events.publish({
          eventName: AUDIT_SELF_ACTIONS.CHAIN_BREAK_DETECTED,
          aggregate: 'AuditChainVerificationRun',
          aggregateId: runId,
          occurredAt: new Date(),
          payload: {
            runId,
            runType,
            issuesFound: result.breaks.length,
            byType: this.countByType(result.breaks),
            firstBreaks: result.breaks.slice(0, 20).map((b) => ({
              id: b.id,
              issueType: b.issueType,
              severity: b.severity,
              reason: b.reason,
            })),
          },
        });
      } catch (e) {
        this.logger.error(`chain.break_detected emit failed: ${(e as Error).message}`);
      }
    }
  }

  private async failRun(runId: string, err: unknown): Promise<void> {
    await this.prisma.auditChainVerificationRun
      .update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: (err as Error)?.message?.slice(0, 1000) ?? 'unknown error',
        },
      })
      .catch(() => undefined);
  }

  private countByType(breaks: ChainBreak[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const b of breaks) out[b.issueType] = (out[b.issueType] ?? 0) + 1;
    return out;
  }
}
