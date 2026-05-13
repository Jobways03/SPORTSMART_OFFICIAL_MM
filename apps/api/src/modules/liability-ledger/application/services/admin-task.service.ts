import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminTask,
  AdminTaskKind,
  AdminTaskStatus,
  LedgerSourceType,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

/**
 * Generic ops queue. Used when the saga can't auto-resolve and needs
 * a human:
 *   - REFUND_INSTRUCTION_FAILED — wallet credit step blew up
 *   - LOGISTICS_CLAIM_REVIEW — courier denied the claim
 *   - SELLER_DEBIT_DISPUTED — seller is contesting a debit
 *
 * Idempotent on (kind, sourceType, sourceId) so saga retries don't
 * queue the same problem multiple times for ops.
 */
@Injectable()
export class AdminTaskService {
  private readonly logger = new Logger(AdminTaskService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueue(args: {
    kind: AdminTaskKind;
    sourceType: LedgerSourceType;
    sourceId: string;
    reason: string;
    assignedTo?: string | null;
    /**
     * Phase 0 (PR 0.14) — hours from `now()` before the task counts as
     * SLA-breached. Drives the breach-detector cron. Set on first
     * enqueue only; idempotent recovery on P2002 preserves the
     * original deadline so retries don't sneakily extend the SLA.
     *
     * Default is null (no SLA) to keep legacy callers unchanged.
     */
    slaHours?: number | null;
  }): Promise<AdminTask> {
    const slaBreachAt =
      args.slaHours && args.slaHours > 0
        ? new Date(Date.now() + args.slaHours * 60 * 60 * 1000)
        : null;
    try {
      const row = await this.prisma.adminTask.create({
        data: {
          kind: args.kind,
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          reason: args.reason,
          assignedTo: args.assignedTo ?? null,
          slaBreachAt,
        },
      });
      this.logger.log(
        `AdminTask ${row.id} enqueued: kind=${args.kind} source=${args.sourceType}:${args.sourceId}` +
          (slaBreachAt
            ? ` slaBreachAt=${slaBreachAt.toISOString()}`
            : ''),
      );
      return row;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.prisma.adminTask.findUnique({
          where: {
            kind_sourceType_sourceId: {
              kind: args.kind,
              sourceType: args.sourceType,
              sourceId: args.sourceId,
            },
          },
        });
        if (existing) return existing;
      }
      throw err;
    }
  }

  async claim(id: string, adminId: string): Promise<AdminTask> {
    return this.prisma.adminTask.update({
      where: { id },
      data: {
        status: 'CLAIMED' as AdminTaskStatus,
        assignedTo: adminId,
        claimedAt: new Date(),
      },
    });
  }

  async resolve(id: string, adminId: string, note?: string): Promise<AdminTask> {
    return this.prisma.adminTask.update({
      where: { id },
      data: {
        status: 'RESOLVED' as AdminTaskStatus,
        resolvedBy: adminId,
        resolvedAt: new Date(),
        resolutionNote: note ?? null,
      },
    });
  }
}
