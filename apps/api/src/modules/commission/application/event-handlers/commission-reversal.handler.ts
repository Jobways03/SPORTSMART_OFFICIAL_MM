import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

interface ReturnApprovedPayload {
  returnId: string;
  returnNumber: string;
  approvedBy?: string;
}

interface RefundCompletedPayload {
  returnId: string;
  returnNumber: string;
  refundAmount: number;
}

/**
 * When a return is approved (or refund completes), flip the related
 * CommissionRecord(s) to REFUNDED so seller settlements deduct the
 * commission we won't collect.
 *
 * Resolution path:
 *   - Return → SubOrder → OrderItems → CommissionRecord(s) by orderItemId.
 *
 * Best-effort: failure logs but doesn't unwind the upstream transaction.
 */
@Injectable()
export class CommissionReversalHandler {
  private readonly logger = new Logger(CommissionReversalHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('returns.return.approved')
  async onApproved(event: DomainEvent<ReturnApprovedPayload>) {
    await this.reverseFor(event.payload.returnId, 'approved');
  }

  @OnEvent('returns.refund.completed')
  async onRefundCompleted(event: DomainEvent<RefundCompletedPayload>) {
    await this.reverseFor(event.payload.returnId, 'refund-completed');
  }

  private async reverseFor(returnId: string, trigger: string) {
    try {
      const ret = await this.prisma.return.findUnique({
        where: { id: returnId },
        select: {
          id: true,
          returnNumber: true,
          subOrderId: true,
          // Some return rows are at sub-order level; commissions are per
          // order_item. Pull the items via the sub-order relation.
        },
      });
      if (!ret) {
        this.logger.warn(`Return ${returnId} not found for commission reversal`);
        return;
      }

      const items = await this.prisma.orderItem.findMany({
        where: { subOrderId: ret.subOrderId },
        select: { id: true },
      });
      if (items.length === 0) return;

      const result = await this.prisma.commissionRecord.updateMany({
        where: {
          orderItemId: { in: items.map((i) => i.id) },
          status: { in: ['PENDING', 'ON_HOLD'] },
        },
        data: { status: 'REFUNDED' },
      });

      if (result.count > 0) {
        this.logger.log(
          `Reversed ${result.count} commission record(s) for return ${ret.returnNumber} (${trigger})`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Commission reversal for ${returnId} failed: ${(err as Error).message}`,
      );
    }
  }
}
