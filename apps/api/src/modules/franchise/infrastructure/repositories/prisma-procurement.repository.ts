import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ProcurementRepository } from '../../domain/repositories/procurement.repository.interface';

@Injectable()
export class PrismaProcurementRepository implements ProcurementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<any | null> {
    return this.prisma.procurementRequest.findUnique({
      where: { id },
    });
  }

  async findByIdWithItems(id: string): Promise<any | null> {
    return this.prisma.procurementRequest.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { createdAt: 'asc' },
        },
        franchise: {
          select: {
            id: true,
            franchiseCode: true,
            businessName: true,
            ownerName: true,
          },
        },
      },
    });
  }

  async findByFranchiseId(
    franchiseId: string,
    params: { page: number; limit: number; status?: string },
  ): Promise<{ requests: any[]; total: number }> {
    const where: any = { franchiseId };

    if (params.status) {
      where.status = params.status;
    }

    const skip = (params.page - 1) * params.limit;

    const [requests, total] = await this.prisma.$transaction([
      this.prisma.procurementRequest.findMany({
        where,
        include: {
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.procurementRequest.count({ where }),
    ]);

    return { requests, total };
  }

  async findAllPaginated(params: {
    page: number;
    limit: number;
    status?: string;
    franchiseId?: string;
    search?: string;
  }): Promise<{ requests: any[]; total: number }> {
    const where: any = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.franchiseId) {
      where.franchiseId = params.franchiseId;
    }

    if (params.search) {
      where.OR = [
        { requestNumber: { contains: params.search, mode: 'insensitive' } },
        {
          franchise: {
            businessName: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          franchise: {
            franchiseCode: { contains: params.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const skip = (params.page - 1) * params.limit;

    const [requests, total] = await this.prisma.$transaction([
      this.prisma.procurementRequest.findMany({
        where,
        include: {
          franchise: {
            select: {
              id: true,
              franchiseCode: true,
              businessName: true,
              ownerName: true,
            },
          },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.procurementRequest.count({ where }),
    ]);

    return { requests, total };
  }

  async create(data: {
    franchiseId: string;
    requestNumber: string;
    procurementFeeRate: number;
  }): Promise<any> {
    return this.prisma.procurementRequest.create({
      data: {
        franchiseId: data.franchiseId,
        requestNumber: data.requestNumber,
        procurementFeeRate: data.procurementFeeRate,
        status: 'DRAFT',
      },
      include: {
        items: true,
      },
    });
  }

  async update(id: string, data: Record<string, unknown>): Promise<any> {
    return this.prisma.procurementRequest.update({
      where: { id },
      data,
      include: {
        items: true,
      },
    });
  }

  async createItems(
    procurementRequestId: string,
    items: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      productTitle: string;
      variantTitle?: string;
      requestedQty: number;
    }>,
  ): Promise<any[]> {
    const createData = items.map((item) => ({
      procurementRequestId,
      productId: item.productId,
      variantId: item.variantId ?? null,
      globalSku: item.globalSku,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle ?? null,
      requestedQty: item.requestedQty,
      status: 'PENDING' as const,
    }));

    await this.prisma.procurementRequestItem.createMany({
      data: createData,
    });

    return this.prisma.procurementRequestItem.findMany({
      where: { procurementRequestId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateItem(
    itemId: string,
    data: Record<string, unknown>,
  ): Promise<any> {
    return this.prisma.procurementRequestItem.update({
      where: { id: itemId },
      data,
    });
  }

  async findItemById(itemId: string): Promise<any | null> {
    return this.prisma.procurementRequestItem.findUnique({
      where: { id: itemId },
    });
  }

  async generateNextRequestNumber(): Promise<string> {
    const year = new Date().getFullYear();

    const sequence = await this.prisma.$transaction(async (tx) => {
      return tx.procurementSequence.upsert({
        where: { id: 1 },
        update: { lastNumber: { increment: 1 } },
        create: { id: 1, lastNumber: 1 },
      });
    }, { isolationLevel: 'Serializable' });

    const paddedNumber = String(sequence.lastNumber).padStart(6, '0');
    return `SM-PO-${year}-${paddedNumber}`;
  }

  async calculateTotals(id: string): Promise<{
    totalRequestedAmount: number;
    totalApprovedAmount: number;
    procurementFeeAmount: number;
    finalPayableAmount: number;
  }> {
    const request = await this.prisma.procurementRequest.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!request) {
      return {
        totalRequestedAmount: 0,
        totalApprovedAmount: 0,
        procurementFeeAmount: 0,
        finalPayableAmount: 0,
      };
    }

    let totalApprovedAmount = 0;
    let procurementFeeAmount = 0;
    let finalPayableAmount = 0;

    for (const item of request.items) {
      const landedCost = Number(item.landedUnitCost ?? 0);
      const feePerUnit = Number(item.procurementFeePerUnit ?? 0);
      const finalUnitCost = Number(item.finalUnitCostToFranchise ?? 0);
      const qty = item.receivedQty > 0 ? item.receivedQty : item.approvedQty;

      totalApprovedAmount += landedCost * item.approvedQty;
      procurementFeeAmount += feePerUnit * qty;
      finalPayableAmount += finalUnitCost * qty;
    }

    return {
      totalRequestedAmount: 0, // Requested amount is not priced yet at request time
      totalApprovedAmount,
      procurementFeeAmount,
      finalPayableAmount,
    };
  }
}
