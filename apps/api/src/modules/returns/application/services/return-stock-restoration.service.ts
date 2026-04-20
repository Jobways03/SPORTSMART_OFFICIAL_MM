import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { BadRequestAppException } from '../../../../core/exceptions';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';

export interface QcDecisionForRestoration {
  returnItemId: string;
  qcOutcome: 'APPROVED' | 'REJECTED' | 'PARTIAL' | 'DAMAGED';
  qcQuantityApproved: number;
  qcNotes?: string;
}

/**
 * Either a PrismaService instance or a transaction client. Both expose the
 * same model accessors so callers can pass `tx` from inside a $transaction
 * to make seller-path writes atomic with the surrounding return update.
 */
type PrismaLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ReturnStockRestorationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly franchiseFacade: FranchisePublicFacade,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ReturnStockRestorationService');
  }

  /**
   * Restore stock for a return based on QC outcome.
   * Handles both seller and franchise fulfillment paths.
   *
   * When `tx` is provided, seller-path writes (Prisma sellerProductMapping
   * updates) run inside that transaction so they can be rolled back together
   * with the surrounding return update. Franchise-path calls go through the
   * franchise facade and execute in their own internal transactions
   * regardless of `tx`.
   */
  async restoreStockForReturn(
    returnRecord: any,
    qcDecisions: QcDecisionForRestoration[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const subOrder = returnRecord?.subOrder;
    if (!subOrder) {
      throw new BadRequestAppException('Sub-order not loaded with return');
    }

    const isFranchise = subOrder.fulfillmentNodeType === 'FRANCHISE';
    const db: PrismaLike = tx ?? this.prisma;

    for (const decision of qcDecisions) {
      const returnItem = returnRecord.items.find(
        (i: any) => i.id === decision.returnItemId,
      );
      if (!returnItem) continue;

      const orderItem = returnItem.orderItem;
      if (!orderItem) continue;

      const totalReturnedQty = returnItem.quantity;
      const saleableQty = decision.qcQuantityApproved;
      const damagedQty = Math.max(0, totalReturnedQty - saleableQty);

      if (isFranchise) {
        // Franchise: restore to onHand via ORDER_RETURN, damaged to damagedQty
        if (saleableQty > 0) {
          try {
            await this.franchiseFacade.recordReturn(
              subOrder.franchiseId,
              orderItem.productId,
              orderItem.variantId,
              saleableQty,
              subOrder.id,
            );
            this.logger.log(
              `Restored ${saleableQty} units to franchise ${subOrder.franchiseId} for product ${orderItem.productId}`,
            );
          } catch (err) {
            this.logger.error(
              `Failed to restore franchise stock: ${(err as Error).message}`,
            );
            throw err;
          }
        }
        if (damagedQty > 0) {
          try {
            await this.franchiseFacade.recordDamagedReturn(
              subOrder.franchiseId,
              orderItem.productId,
              orderItem.variantId,
              damagedQty,
              subOrder.id,
              'SYSTEM_RETURN',
            );
            this.logger.log(
              `Marked ${damagedQty} units as damaged at franchise ${subOrder.franchiseId} for product ${orderItem.productId}`,
            );
          } catch (err) {
            this.logger.error(
              `Failed to mark franchise stock as damaged: ${(err as Error).message}`,
            );
          }
        }
      } else {
        // Seller: restore to SellerProductMapping.stockQty (saleable only)
        if (saleableQty > 0 && subOrder.sellerId) {
          const mapping = await db.sellerProductMapping.findFirst({
            where: {
              sellerId: subOrder.sellerId,
              productId: orderItem.productId,
              variantId: orderItem.variantId ?? null,
            },
          });
          if (mapping) {
            await db.sellerProductMapping.update({
              where: { id: mapping.id },
              data: { stockQty: { increment: saleableQty } },
            });
            this.logger.log(
              `Restored ${saleableQty} units to seller mapping ${mapping.id}`,
            );
          } else {
            this.logger.warn(
              `No seller mapping found for seller=${subOrder.sellerId}, product=${orderItem.productId}, variant=${orderItem.variantId ?? 'null'}`,
            );
          }
        }
        // Damaged seller stock — write off (not added back)
        if (damagedQty > 0) {
          this.logger.log(
            `${damagedQty} units written off as damaged for seller return on subOrder ${subOrder.id}`,
          );
        }
      }
    }
  }
}
