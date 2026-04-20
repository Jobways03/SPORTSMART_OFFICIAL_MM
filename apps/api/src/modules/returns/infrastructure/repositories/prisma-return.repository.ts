import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  CreateReturnData,
  FindAllPaginatedParams,
  FindByCustomerParams,
  FindReturnsForFulfillmentNodeParams,
  ReturnRepository,
} from '../../domain/repositories/return.repository.interface';

const NON_ACTIVE_STATUSES = ['REJECTED', 'CANCELLED'] as const;
const NON_COUNTABLE_STATUSES = ['REJECTED', 'CANCELLED', 'COMPLETED'] as const;

@Injectable()
export class PrismaReturnRepository implements ReturnRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ────────────────────────────────────────────────────────────────

  async findById(id: string): Promise<any | null> {
    return this.prisma.return.findUnique({ where: { id } });
  }

  async findByIdWithItems(id: string): Promise<any | null> {
    return this.prisma.return.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            orderItem: true,
          },
        },
        subOrder: true,
        masterOrder: true,
        evidence: true,
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async findByReturnNumber(returnNumber: string): Promise<any | null> {
    return this.prisma.return.findUnique({
      where: { returnNumber },
      include: {
        items: {
          include: {
            orderItem: true,
          },
        },
      },
    });
  }

  async findByCustomerId(
    customerId: string,
    params: FindByCustomerParams,
  ): Promise<{ returns: any[]; total: number }> {
    const { page, limit, status } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ReturnWhereInput = { customerId };
    if (status) {
      where.status = status as any;
    }

    const [returns, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        include: {
          items: {
            include: {
              orderItem: {
                select: {
                  id: true,
                  productTitle: true,
                  variantTitle: true,
                  sku: true,
                  imageUrl: true,
                  unitPrice: true,
                  quantity: true,
                },
              },
            },
          },
          subOrder: {
            select: {
              id: true,
              fulfillmentStatus: true,
              masterOrder: {
                select: {
                  id: true,
                  orderNumber: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { returns, total };
  }

  async findBySubOrderId(subOrderId: string): Promise<any[]> {
    return this.prisma.return.findMany({
      where: { subOrderId },
      include: {
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllPaginated(
    params: FindAllPaginatedParams,
  ): Promise<{ returns: any[]; total: number }> {
    const {
      page,
      limit,
      status,
      customerId,
      subOrderId,
      fulfillmentNodeType,
      fromDate,
      toDate,
      search,
    } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ReturnWhereInput = {};

    if (status) {
      where.status = status as any;
    }
    if (customerId) {
      where.customerId = customerId;
    }
    if (subOrderId) {
      where.subOrderId = subOrderId;
    }
    if (fulfillmentNodeType) {
      where.subOrder = {
        ...(where.subOrder as any),
        fulfillmentNodeType,
      };
    }
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) (where.createdAt as any).gte = fromDate;
      if (toDate) (where.createdAt as any).lte = toDate;
    }
    if (search && search.trim().length > 0) {
      const term = search.trim();
      where.OR = [
        { returnNumber: { contains: term, mode: 'insensitive' } },
        {
          masterOrder: {
            orderNumber: { contains: term, mode: 'insensitive' },
          },
        },
      ];
    }

    const [returns, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        include: {
          items: {
            include: {
              orderItem: {
                select: {
                  id: true,
                  productTitle: true,
                  variantTitle: true,
                  sku: true,
                  imageUrl: true,
                  unitPrice: true,
                  quantity: true,
                },
              },
            },
          },
          subOrder: {
            select: {
              id: true,
              fulfillmentStatus: true,
              fulfillmentNodeType: true,
              sellerId: true,
              franchiseId: true,
              masterOrder: {
                select: {
                  id: true,
                  orderNumber: true,
                },
              },
            },
          },
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { returns, total };
  }

  async findReturnsForFulfillmentNode(
    params: FindReturnsForFulfillmentNodeParams,
  ): Promise<{ returns: any[]; total: number }> {
    const { nodeType, nodeId, page, limit, status } = params;
    const skip = (page - 1) * limit;

    const subOrderFilter: Prisma.SubOrderWhereInput = {
      fulfillmentNodeType: nodeType,
    };
    if (nodeType === 'SELLER') {
      subOrderFilter.sellerId = nodeId;
    } else {
      subOrderFilter.franchiseId = nodeId;
    }

    const where: Prisma.ReturnWhereInput = {
      subOrder: subOrderFilter,
    };
    if (status) {
      where.status = status as any;
    }

    const [returns, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({
        where,
        include: {
          items: {
            include: {
              orderItem: {
                select: {
                  id: true,
                  productTitle: true,
                  variantTitle: true,
                  sku: true,
                  imageUrl: true,
                  unitPrice: true,
                  quantity: true,
                },
              },
            },
          },
          subOrder: {
            select: {
              id: true,
              fulfillmentStatus: true,
              fulfillmentNodeType: true,
              sellerId: true,
              franchiseId: true,
              masterOrder: {
                select: {
                  id: true,
                  orderNumber: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.return.count({ where }),
    ]);

    return { returns, total };
  }

  async create(data: CreateReturnData): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.return.create({
        data: {
          returnNumber: data.returnNumber,
          subOrderId: data.subOrderId,
          masterOrderId: data.masterOrderId,
          customerId: data.customerId,
          status: 'REQUESTED',
          initiatedBy: data.initiatedBy,
          initiatorId: data.initiatorId,
          customerNotes: data.customerNotes,
          items: {
            create: data.items.map((item) => ({
              orderItemId: item.orderItemId,
              quantity: item.quantity,
              reasonCategory: item.reasonCategory as any,
              reasonDetail: item.reasonDetail,
            })),
          },
        },
        include: {
          items: true,
        },
      });

      await tx.returnStatusHistory.create({
        data: {
          returnId: created.id,
          fromStatus: null,
          toStatus: 'REQUESTED',
          changedBy: data.initiatedBy,
          changedById: data.initiatorId,
          notes: 'Return request submitted',
        },
      });

      return created;
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<any> {
    return this.prisma.return.update({
      where: { id },
      data: data as any,
    });
  }

  // ── Status history ──────────────────────────────────────────────────────

  async recordStatusChange(
    returnId: string,
    fromStatus: string | null,
    toStatus: string,
    changedBy: string,
    changedById?: string,
    notes?: string,
  ): Promise<any> {
    return this.prisma.returnStatusHistory.create({
      data: {
        returnId,
        fromStatus: fromStatus as any,
        toStatus: toStatus as any,
        changedBy,
        changedById,
        notes,
      },
    });
  }

  // ── Sequence ────────────────────────────────────────────────────────────

  async generateNextReturnNumber(): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        const seq = await tx.returnSequence.upsert({
          where: { id: 1 },
          create: { id: 1, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
        });
        const year = new Date().getFullYear();
        const padded = String(seq.lastNumber).padStart(6, '0');
        return `RET-${year}-${padded}`;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  // ── Eligibility helpers ─────────────────────────────────────────────────

  async countActiveReturnsForOrderItem(orderItemId: string): Promise<number> {
    return this.prisma.return.count({
      where: {
        items: { some: { orderItemId } },
        status: {
          notIn: NON_COUNTABLE_STATUSES as unknown as any[],
        },
      },
    });
  }

  async getReturnedQuantityForOrderItem(orderItemId: string): Promise<number> {
    const result = await this.prisma.returnItem.aggregate({
      _sum: { quantity: true },
      where: {
        orderItemId,
        return: {
          status: {
            notIn: NON_ACTIVE_STATUSES as unknown as any[],
          },
        },
      },
    });
    return result._sum.quantity ?? 0;
  }

  // ── QC (Phase R3) ───────────────────────────────────────────────────────

  async addEvidence(data: {
    returnId: string;
    uploadedBy: string;
    uploaderId?: string;
    fileType: string;
    fileUrl: string;
    publicId?: string;
    description?: string;
  }): Promise<any> {
    return this.prisma.returnEvidence.create({
      data: {
        returnId: data.returnId,
        uploadedBy: data.uploadedBy,
        uploaderId: data.uploaderId,
        fileType: data.fileType,
        fileUrl: data.fileUrl,
        publicId: data.publicId,
        description: data.description,
      },
    });
  }

  async updateReturnItemQc(
    itemId: string,
    data: {
      qcOutcome: string;
      qcQuantityApproved: number;
      qcNotes?: string;
      refundAmount?: number;
    },
  ): Promise<any> {
    return this.prisma.returnItem.update({
      where: { id: itemId },
      data: {
        qcOutcome: data.qcOutcome as any,
        qcQuantityApproved: data.qcQuantityApproved,
        qcNotes: data.qcNotes,
        refundAmount: data.refundAmount,
      },
    });
  }

  // ── Refund processing (Phase R4) ────────────────────────────────────────

  async recordRefundAttempt(
    returnId: string,
    data: {
      gatewayRefundId?: string;
      success: boolean;
      failureReason?: string;
    },
  ): Promise<any> {
    return this.prisma.return.update({
      where: { id: returnId },
      data: {
        refundAttempts: { increment: 1 },
        refundLastAttemptAt: new Date(),
        ...(data.success
          ? {
              refundReference: data.gatewayRefundId,
              refundFailureReason: null,
            }
          : { refundFailureReason: data.failureReason }),
      },
    });
  }

  async incrementRefundAttempts(returnId: string): Promise<any> {
    return this.prisma.return.update({
      where: { id: returnId },
      data: {
        refundAttempts: { increment: 1 },
        refundLastAttemptAt: new Date(),
      },
    });
  }

  // ── Analytics (Phase R6) ────────────────────────────────────────────────

  async getAnalyticsSummary(params?: { fromDate?: Date; toDate?: Date }) {
    const dateFilter: Prisma.ReturnWhereInput = {};
    if (params?.fromDate || params?.toDate) {
      dateFilter.createdAt = {};
      if (params.fromDate) (dateFilter.createdAt as any).gte = params.fromDate;
      if (params.toDate) (dateFilter.createdAt as any).lte = params.toDate;
    }

    const returns = await this.prisma.return.findMany({
      where: dateFilter,
      select: {
        id: true,
        status: true,
        refundAmount: true,
        createdAt: true,
        closedAt: true,
        items: { select: { reasonCategory: true } },
      },
    });

    const totalReturns = returns.length;
    let totalRefundAmount = 0;
    const byStatus: Record<string, number> = {};
    const byReasonCategory: Record<string, number> = {};
    let processedSum = 0;
    let processedCount = 0;
    let refundedCount = 0;
    let rejectedCount = 0;
    let pendingCount = 0;
    let inProgressCount = 0;

    const pendingStatuses = [
      'REQUESTED',
      'APPROVED',
      'PICKUP_SCHEDULED',
      'IN_TRANSIT',
      'RECEIVED',
    ];
    const inProgressStatuses = [
      'QC_APPROVED',
      'PARTIALLY_APPROVED',
      'REFUND_PROCESSING',
    ];

    for (const r of returns) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.refundAmount) totalRefundAmount += Number(r.refundAmount);

      if (r.status === 'REFUNDED' || r.status === 'COMPLETED') refundedCount++;
      if (
        r.status === 'REJECTED' ||
        r.status === 'QC_REJECTED' ||
        r.status === 'CANCELLED'
      )
        rejectedCount++;
      if (pendingStatuses.includes(r.status)) pendingCount++;
      if (inProgressStatuses.includes(r.status)) inProgressCount++;

      if (r.closedAt) {
        const days =
          (r.closedAt.getTime() - r.createdAt.getTime()) /
          (1000 * 60 * 60 * 24);
        processedSum += days;
        processedCount++;
      }

      for (const item of r.items) {
        byReasonCategory[item.reasonCategory] =
          (byReasonCategory[item.reasonCategory] || 0) + 1;
      }
    }

    const averageProcessingDays =
      processedCount > 0 ? processedSum / processedCount : 0;
    const totalProcessed = refundedCount + rejectedCount;
    const refundSuccessRate =
      totalProcessed > 0 ? (refundedCount / totalProcessed) * 100 : 0;

    return {
      totalReturns,
      totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
      byStatus,
      byReasonCategory,
      averageProcessingDays: Math.round(averageProcessingDays * 100) / 100,
      refundedCount,
      rejectedCount,
      pendingCount,
      inProgressCount,
      refundSuccessRate: Math.round(refundSuccessRate * 100) / 100,
    };
  }

  async getReturnsByPeriod(params: {
    fromDate: Date;
    toDate: Date;
    groupBy: 'day' | 'week' | 'month';
  }) {
    const truncFn =
      params.groupBy === 'day'
        ? 'day'
        : params.groupBy === 'week'
        ? 'week'
        : 'month';

    const result = await this.prisma.$queryRaw<
      Array<{ period: Date; count: bigint; refund_amount: any }>
    >`
      SELECT
        date_trunc(${truncFn}, "created_at") as period,
        COUNT(*) as count,
        COALESCE(SUM("refund_amount"), 0) as refund_amount
      FROM returns
      WHERE "created_at" >= ${params.fromDate} AND "created_at" <= ${params.toDate}
      GROUP BY period
      ORDER BY period ASC
    `;

    return result.map((row) => ({
      period: row.period.toISOString(),
      count: Number(row.count),
      refundAmount: Number(row.refund_amount),
    }));
  }

  async getTopReturnReasons(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
  ) {
    const where: Prisma.ReturnItemWhereInput = {};
    if (fromDate || toDate) {
      where.return = {};
      if (fromDate) (where.return as any).createdAt = { gte: fromDate };
      if (toDate)
        (where.return as any).createdAt = {
          ...((where.return as any).createdAt || {}),
          lte: toDate,
        };
    }

    const results = await this.prisma.returnItem.groupBy({
      by: ['reasonCategory'],
      where,
      _count: { id: true },
      _sum: { quantity: true },
      orderBy: { _count: { id: 'desc' } },
      take: limit,
    });

    return results.map((r) => ({
      reasonCategory: r.reasonCategory as string,
      count: r._count.id,
      totalQuantity: r._sum.quantity || 0,
    }));
  }

  async getReturnsByCustomer(customerId: string) {
    const [totalReturns, refundedAgg, recentReturns] = await Promise.all([
      this.prisma.return.count({ where: { customerId } }),
      this.prisma.return.aggregate({
        where: {
          customerId,
          status: { in: ['REFUNDED', 'COMPLETED'] },
        },
        _sum: { refundAmount: true },
      }),
      this.prisma.return.findMany({
        where: { customerId },
        include: {
          items: true,
          masterOrder: { select: { orderNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return {
      totalReturns,
      totalRefunded: Number(refundedAgg._sum.refundAmount || 0),
      recentReturns,
    };
  }
}
