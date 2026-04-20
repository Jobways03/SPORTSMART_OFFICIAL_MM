import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class RoutingHealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Snapshot of routing-engine health. Surfaces operational risks that are
   * hard to see otherwise:
   *  - stuck orders in EXCEPTION_QUEUE
   *  - auto-reassign volume (how often the engine is saving a stall)
   *  - top rejecting nodes (bad actors or capacity issues)
   *  - pincodes where no node was serviceable (coverage gaps)
   */
  async getHealthSnapshot() {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [
      exceptionQueueCount,
      reassignLast7d,
      autoRejectLast7d,
      topRejectingNodes,
      unservicablePincodes,
    ] = await Promise.all([
      this.prisma.masterOrder.count({
        where: { orderStatus: 'EXCEPTION_QUEUE' },
      }),
      this.prisma.orderReassignmentLog.count({
        where: { createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.orderReassignmentLog.count({
        where: {
          createdAt: { gte: sevenDaysAgo },
          reason: { contains: 'SLA_TIMEOUT', mode: 'insensitive' },
        },
      }),
      this.prisma.orderReassignmentLog.groupBy({
        by: ['fromSellerId'],
        where: { createdAt: { gte: sevenDaysAgo } },
        _count: { _all: true },
        orderBy: { _count: { fromSellerId: 'desc' } },
        take: 10,
      }),
      this.prisma.allocationLog.groupBy({
        by: ['customerPincode'],
        where: {
          createdAt: { gte: thirtyDaysAgo },
          allocatedNodeType: null,
        },
        _count: { _all: true },
        orderBy: { _count: { customerPincode: 'desc' } },
        take: 20,
      }),
    ]);

    const [exceptionQueueOldestAgeMs] = await Promise.all([
      this.prisma.masterOrder
        .findFirst({
          where: { orderStatus: 'EXCEPTION_QUEUE' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        })
        .then((o) => (o ? now - o.createdAt.getTime() : null)),
    ]);

    return {
      generatedAt: new Date(),
      exceptionQueue: {
        count: exceptionQueueCount,
        oldestAgeHours:
          exceptionQueueOldestAgeMs != null
            ? Math.round(exceptionQueueOldestAgeMs / (60 * 60 * 1000))
            : null,
      },
      reassignments: {
        last7dTotal: reassignLast7d,
        last7dFromSlaTimeout: autoRejectLast7d,
      },
      topRejectingNodes: topRejectingNodes.map((r) => ({
        nodeId: r.fromSellerId,
        rejectionsLast7d: r._count._all,
      })),
      unservicablePincodes: unservicablePincodes.map((p) => ({
        pincode: p.customerPincode,
        failedAllocationsLast30d: p._count._all,
      })),
    };
  }
}
