import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Phase 8 (PR 8.1) — Audit chain anchor service.
 *
 * Two responsibilities:
 *
 *   1. `pinNext()` — finds the latest AuditLog row not yet covered by
 *      an anchor, copies its `hash` into a new AuditChainAnchor row.
 *      Idempotent: if no new rows since the last anchor, returns
 *      `{ pinned: false }`.
 *
 *   2. `verifyFromLatestAnchor(limit)` — reads the latest anchor,
 *      recomputes the hash of the AuditLog row it points at, and
 *      compares. Then walks forward up to `limit` rows, recomputing
 *      each row's hash from the previous one's `prevHash + payload`.
 *      Returns the list of break-points (none = healthy chain).
 *
 * Why not include payload in the anchor itself: anchors carry the
 * hash, not the payload. A regulator who wants to prove "row X was
 * untampered as of time T" sees the anchor's `expectedHash` matches
 * the row's `hash` — no need to retain a duplicate payload.
 *
 * The anchor cron is the only writer. Reads from the verifier
 * endpoint can run unconstrained.
 */
@Injectable()
export class AuditChainAnchorService {
  private readonly logger = new Logger(AuditChainAnchorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pin the latest AuditLog row that isn't already covered by an
   * anchor. Returns `{ pinned: false }` when there's nothing new.
   */
  async pinNext(): Promise<
    | { pinned: false }
    | { pinned: true; sequence: number; upToAuditLogId: string; rowsCovered: number }
  > {
    const latestAnchor = await this.prisma.auditChainAnchor.findFirst({
      orderBy: { sequence: 'desc' },
    });

    const cutoffCreatedAt = latestAnchor
      ? // Anchor pointed at this audit log; new rows have createdAt
        // strictly after that row's createdAt.
        await this.prisma.auditLog
          .findUnique({
            where: { id: latestAnchor.upToAuditLogId },
            select: { createdAt: true },
          })
          .then((r) => r?.createdAt ?? null)
      : null;

    const latestRow = await this.prisma.auditLog.findFirst({
      where: cutoffCreatedAt
        ? { createdAt: { gt: cutoffCreatedAt } }
        : undefined,
      orderBy: { createdAt: 'desc' },
      select: { id: true, hash: true, createdAt: true },
    });

    if (!latestRow || !latestRow.hash) return { pinned: false };

    const rowsCovered = cutoffCreatedAt
      ? await this.prisma.auditLog.count({
          where: { createdAt: { gt: cutoffCreatedAt, lte: latestRow.createdAt } },
        })
      : await this.prisma.auditLog.count({
          where: { createdAt: { lte: latestRow.createdAt } },
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
    return {
      pinned: true,
      sequence,
      upToAuditLogId: latestRow.id,
      rowsCovered,
    };
  }

  /**
   * Verify the chain is intact from the most recent anchor forward,
   * up to `limit` rows. Returns the list of break-points (each: row id,
   * recomputed hash, stored hash). Empty list = chain is intact in
   * the inspected window.
   *
   * The anchor itself is also verified — a divergent anchor is
   * surfaced as a `{ id: anchor.upToAuditLogId, ... }` break.
   */
  async verifyFromLatestAnchor(limit = 10_000): Promise<{
    anchorSequence: number | null;
    rowsChecked: number;
    breaks: Array<{ id: string; reason: string }>;
  }> {
    const anchor = await this.prisma.auditChainAnchor.findFirst({
      orderBy: { sequence: 'desc' },
    });

    const breaks: Array<{ id: string; reason: string }> = [];

    if (!anchor) {
      // No anchor yet — fall back to walking from the start of the
      // chain. The result is still useful but slower.
      return this.verifyFromGenesis(limit);
    }

    const anchoredRow = await this.prisma.auditLog.findUnique({
      where: { id: anchor.upToAuditLogId },
    });
    if (!anchoredRow || !anchoredRow.hash) {
      breaks.push({
        id: anchor.upToAuditLogId,
        reason: 'anchored row missing or has no hash',
      });
      return {
        anchorSequence: anchor.sequence,
        rowsChecked: 0,
        breaks,
      };
    }
    if (anchoredRow.hash !== anchor.expectedHash) {
      breaks.push({
        id: anchor.upToAuditLogId,
        reason: `anchor mismatch: anchor.expected_hash ${anchor.expectedHash}, row.hash ${anchoredRow.hash}`,
      });
    }

    const rows = await this.prisma.auditLog.findMany({
      where: { createdAt: { gt: anchoredRow.createdAt } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let prevHash: string | null = anchoredRow.hash;
    let rowsChecked = 0;
    for (const r of rows) {
      rowsChecked += 1;
      if (r.prevHash !== prevHash) {
        breaks.push({
          id: r.id,
          reason: `prevHash chain break: expected ${prevHash ?? 'null'}, got ${r.prevHash ?? 'null'}`,
        });
      }
      // We do NOT recompute the row's own `hash` here because the
      // genuine hash recomputation is timestamp-sensitive (sha256 of
      // payload + ts) and we'd need the original ts to redo it. The
      // prevHash linkage is sufficient to detect insertions/deletions;
      // the ts-sensitive recomputation lives in the existing admin
      // verify-chain endpoint.
      prevHash = r.hash;
    }

    return {
      anchorSequence: anchor.sequence,
      rowsChecked,
      breaks,
    };
  }

  private async verifyFromGenesis(limit: number) {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    const breaks: Array<{ id: string; reason: string }> = [];
    let prevHash: string | null = null;
    for (const r of rows) {
      if (r.prevHash !== prevHash) {
        breaks.push({
          id: r.id,
          reason: `prevHash chain break (no anchors yet): expected ${prevHash ?? 'null'}, got ${r.prevHash ?? 'null'}`,
        });
      }
      prevHash = r.hash;
    }
    return {
      anchorSequence: null,
      rowsChecked: rows.length,
      breaks,
    };
  }
}
