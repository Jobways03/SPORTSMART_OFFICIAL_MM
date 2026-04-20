import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchisePosRepository } from '../../domain/repositories/franchise-pos.repository.interface';
import { PosSaleStatus } from '@prisma/client';

@Injectable()
export class PrismaFranchisePosRepository implements FranchisePosRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<any | null> {
    return this.prisma.franchisePosSale.findUnique({
      where: { id },
    });
  }

  async findByIdWithItems(id: string): Promise<any | null> {
    return this.prisma.franchisePosSale.findUnique({
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
    params: {
      page: number;
      limit: number;
      status?: string;
      saleType?: string;
      fromDate?: Date;
      toDate?: Date;
      search?: string;
    },
  ): Promise<{ sales: any[]; total: number }> {
    const where: any = { franchiseId };

    if (params.status) {
      where.status = params.status as PosSaleStatus;
    }

    if (params.saleType) {
      where.saleType = params.saleType;
    }

    if (params.fromDate || params.toDate) {
      where.soldAt = {};
      if (params.fromDate) {
        where.soldAt.gte = params.fromDate;
      }
      if (params.toDate) {
        where.soldAt.lte = params.toDate;
      }
    }

    if (params.search) {
      where.OR = [
        { saleNumber: { contains: params.search, mode: 'insensitive' } },
        { customerName: { contains: params.search, mode: 'insensitive' } },
        { customerPhone: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const skip = (params.page - 1) * params.limit;

    const [sales, total] = await this.prisma.$transaction([
      this.prisma.franchisePosSale.findMany({
        where,
        include: {
          _count: { select: { items: true } },
        },
        orderBy: { soldAt: 'desc' },
        skip,
        take: params.limit,
      }),
      this.prisma.franchisePosSale.count({ where }),
    ]);

    return { sales, total };
  }

  async createSale(data: {
    saleNumber: string;
    franchiseId: string;
    saleType: string;
    customerName?: string;
    customerPhone?: string;
    grossAmount: number;
    discountAmount: number;
    taxAmount: number;
    netAmount: number;
    paymentMethod: string;
    createdByStaffId?: string;
    items: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      productTitle: string;
      variantTitle?: string;
      quantity: number;
      unitPrice: number;
      lineDiscount: number;
      lineTotal: number;
    }>;
  }): Promise<any> {
    const { items, ...saleData } = data;

    return this.prisma.franchisePosSale.create({
      data: {
        ...saleData,
        status: 'COMPLETED',
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
            globalSku: item.globalSku,
            franchiseSku: item.franchiseSku ?? null,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle ?? null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineDiscount: item.lineDiscount,
            lineTotal: item.lineTotal,
          })),
        },
      },
      include: {
        items: true,
      },
    });
  }

  async updateSale(id: string, data: Record<string, unknown>): Promise<any> {
    return this.prisma.franchisePosSale.update({
      where: { id },
      data,
      include: {
        items: true,
      },
    });
  }

  async generateNextSaleNumber(franchiseCode: string): Promise<string> {
    const sequence = await this.prisma.$transaction(async (tx) => {
      return tx.posSaleSequence.upsert({
        where: { id: 1 },
        update: { lastNumber: { increment: 1 } },
        create: { id: 1, lastNumber: 1 },
      });
    }, { isolationLevel: 'Serializable' });

    const paddedNumber = String(sequence.lastNumber).padStart(6, '0');
    return `POS-${franchiseCode}-${paddedNumber}`;
  }

  async getDailyReport(
    franchiseId: string,
    date: Date,
  ): Promise<{
    totalSales: number;
    totalGrossAmount: number;
    totalDiscountAmount: number;
    totalNetAmount: number;
    salesByPaymentMethod: Record<string, { count: number; amount: number }>;
    salesByType: Record<string, { count: number; amount: number }>;
  }> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const sales = await this.prisma.franchisePosSale.findMany({
      where: {
        franchiseId,
        soldAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: { not: 'VOIDED' },
      },
    });

    const totalSales = sales.length;
    let totalGrossAmount = 0;
    let totalDiscountAmount = 0;
    let totalNetAmount = 0;

    const salesByPaymentMethod: Record<
      string,
      { count: number; amount: number }
    > = {};
    const salesByType: Record<string, { count: number; amount: number }> = {};

    for (const sale of sales) {
      const gross = Number(sale.grossAmount);
      const discount = Number(sale.discountAmount);
      const net = Number(sale.netAmount);

      totalGrossAmount += gross;
      totalDiscountAmount += discount;
      totalNetAmount += net;

      // By payment method
      if (!salesByPaymentMethod[sale.paymentMethod]) {
        salesByPaymentMethod[sale.paymentMethod] = { count: 0, amount: 0 };
      }
      salesByPaymentMethod[sale.paymentMethod].count += 1;
      salesByPaymentMethod[sale.paymentMethod].amount += net;

      // By sale type
      if (!salesByType[sale.saleType]) {
        salesByType[sale.saleType] = { count: 0, amount: 0 };
      }
      salesByType[sale.saleType].count += 1;
      salesByType[sale.saleType].amount += net;
    }

    return {
      totalSales,
      totalGrossAmount: Math.round(totalGrossAmount * 100) / 100,
      totalDiscountAmount: Math.round(totalDiscountAmount * 100) / 100,
      totalNetAmount: Math.round(totalNetAmount * 100) / 100,
      salesByPaymentMethod,
      salesByType,
    };
  }
}
