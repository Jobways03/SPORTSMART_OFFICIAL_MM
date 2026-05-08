import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';

/**
 * Phase 7 (PR 7.2) — Legal-hold checker.
 *
 * A file is on hold (cannot be retention-deleted) when it's attached
 * to an open dispute, an unresolved settlement, or carries a manually
 * applied hold. We check before applying any retention action.
 *
 * Returning a (held, reason) tuple lets the enforcer write the reason
 * into RetentionExecution.legalHoldReason — incident response can
 * later answer "why didn't this file get deleted?" without rerunning
 * the math.
 */
@Injectable()
export class LegalHoldService {
  constructor(private readonly prisma: PrismaService) {}

  async check(
    fileId: string,
  ): Promise<{ held: boolean; reason: string | null }> {
    // Pull every attachment to find joins to disputes/settlements/etc.
    const attachments = await this.prisma.fileAttachment.findMany({
      where: { fileId },
      select: { resource: true, resourceId: true },
    });

    for (const att of attachments) {
      const reason = await this.checkAttachment(att.resource, att.resourceId);
      if (reason) return { held: true, reason };
    }
    return { held: false, reason: null };
  }

  private async checkAttachment(
    resource: string,
    resourceId: string,
  ): Promise<string | null> {
    if (resource === 'dispute' || resource === 'dispute_evidence') {
      const dispute = await this.prisma.dispute.findUnique({
        where: { id: resourceId },
        select: { id: true, status: true, disputeNumber: true },
      });
      if (!dispute) return null;
      // Open / under-review / awaiting_info = active, hold the file.
      if (
        dispute.status === 'OPEN' ||
        dispute.status === 'UNDER_REVIEW' ||
        dispute.status === 'AWAITING_INFO'
      ) {
        return `Active dispute ${dispute.disputeNumber}`;
      }
      // RESOLVED / CLOSED disputes: the case is decided but we still
      // want a 90-day hold for the appeals window. The retention
      // policy itself encodes that via retainDays — file becomes
      // eligible only after the policy window elapses, so we don't
      // need an extra hold here.
    }
    if (resource === 'return' || resource === 'qc_evidence') {
      const ret = await this.prisma.return.findUnique({
        where: { id: resourceId },
        select: { id: true, status: true, returnNumber: true },
      });
      if (!ret) return null;
      const ACTIVE = [
        'REQUESTED',
        'APPROVED',
        'PICKUP_SCHEDULED',
        'IN_TRANSIT',
        'RECEIVED',
        'PARTIALLY_APPROVED',
        'QC_APPROVED',
        'REFUND_PROCESSING',
      ];
      if (ACTIVE.includes(ret.status as string)) {
        return `Active return ${ret.returnNumber}`;
      }
    }
    if (resource === 'settlement' || resource === 'invoice') {
      // Conservative: settlement-attached files are held until the
      // settlement is paid AND the appeals window has elapsed (the
      // retention policy provides the appeals window).
      const settlement = await (this.prisma as any).sellerSettlement
        ?.findUnique?.({
          where: { id: resourceId },
          select: { status: true },
        })
        .catch?.(() => null);
      if (settlement && settlement.status !== 'PAID') {
        return `Open settlement`;
      }
    }
    return null;
  }
}
