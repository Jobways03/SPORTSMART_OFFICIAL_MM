import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';

@Injectable()
export class CommissionProcessorService implements OnModuleInit {
  private readonly logger = new Logger(CommissionProcessorService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Check every 15 seconds for sub-orders past return window
    setInterval(() => this.processCommissions(), 15_000);
    this.logger.log('Commission processor started (15s interval)');
  }

  async processCommissions() {
    try {
      const subOrders = await this.prisma.subOrder.findMany({
        where: {
          fulfillmentStatus: 'DELIVERED',
          commissionProcessed: false,
          returnWindowEndsAt: { lte: new Date() },
          paymentStatus: { not: 'CANCELLED' },
        },
        include: {
          items: true,
          masterOrder: { select: { orderNumber: true } },
          seller: { select: { sellerShopName: true } },
        },
      });

      if (subOrders.length === 0) return;

      let settings = await this.prisma.commissionSetting.findUnique({
        where: { id: 'global' },
      });
      if (!settings) {
        settings = await this.prisma.commissionSetting.create({
          data: { id: 'global' },
        });
      }

      const cType = settings.commissionType;
      const cVal = Number(settings.commissionValue);
      const cVal2 = Number(settings.secondCommissionValue);

      for (const so of subOrders) {
        await this.prisma.$transaction(async (tx) => {
          const sellerName = so.seller?.sellerShopName || 'Unknown';
          const orderNumber = so.masterOrder.orderNumber;

          for (const item of so.items) {
            // Skip if commission already exists for this item
            const existing = await tx.commissionRecord.findUnique({
              where: { orderItemId: item.id },
            });
            if (existing) continue;

            const up = Number(item.unitPrice);
            let unitCommission = 0;
            let rateLabel = '';

            if (cType === 'PERCENTAGE') {
              unitCommission = up * (cVal / 100);
              rateLabel = `${cVal.toFixed(2)} %`;
            } else if (cType === 'FIXED') {
              unitCommission = cVal;
              rateLabel = `${cVal.toFixed(2)} FIXED`;
            } else if (cType === 'PERCENTAGE_PLUS_FIXED') {
              unitCommission = up * (cVal / 100) + cVal2;
              rateLabel = `${cVal.toFixed(2)} % + ${cVal2.toFixed(2)} FIXED`;
            } else if (cType === 'FIXED_PLUS_PERCENTAGE') {
              const remaining = up - cVal;
              const pctPart = remaining > 0 ? remaining * (cVal2 / 100) : 0;
              unitCommission = cVal + pctPart;
              rateLabel = `${cVal.toFixed(2)} FIXED + ${cVal2.toFixed(2)} %`;
            }

            if (
              settings!.enableMaxCommission &&
              settings!.maxCommissionAmount
            ) {
              const maxCap = Number(settings!.maxCommissionAmount);
              if (unitCommission > maxCap) unitCommission = maxCap;
            }

            unitCommission = Math.round(unitCommission * 100) / 100;
            const totalCommission = unitCommission * item.quantity;
            const totalItemPrice = Number(item.totalPrice);
            const productEarning = totalItemPrice - totalCommission;

            await tx.commissionRecord.create({
              data: {
                orderItemId: item.id,
                subOrderId: so.id,
                masterOrderId: so.masterOrderId,
                sellerId: so.sellerId,
                productId: item.productId,
                productTitle: item.productTitle,
                orderNumber,
                sellerName,
                unitPrice: up,
                quantity: item.quantity,
                totalPrice: totalItemPrice,
                commissionType: cType,
                commissionRate: rateLabel,
                unitCommission,
                totalCommission,
                adminEarning: totalCommission,
                productEarning,
              },
            });
          }

          await tx.subOrder.update({
            where: { id: so.id },
            data: { commissionProcessed: true },
          });
        });

        this.logger.log(
          `Commission processed for sub-order ${so.id} (order ${so.masterOrder.orderNumber})`,
        );
      }
    } catch (err) {
      this.logger.error('Commission processing error', err);
    }
  }
}
