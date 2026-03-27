import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface BulkPricingUpdate {
  productId: string;
  platformPrice?: number;
  variantUpdates?: { variantId: string; platformPrice: number }[];
}

export interface BulkPricingResult {
  updatedProducts: number;
  updatedVariants: number;
  errors: { productId: string; error: string }[];
}

export interface ReassignResult {
  subOrderId: string;
  previousSellerId: string;
  newSellerId: string;
  message: string;
}

export interface MappingSuspensionResult {
  sellerId: string;
  affectedMappings: number;
  action: 'suspended' | 'activated';
}

// ── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class AdminOperationsService {
  private readonly logger = new Logger(AdminOperationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── T5: Bulk pricing management ─────────────────────────────────────────

  async bulkUpdatePricing(updates: BulkPricingUpdate[]): Promise<BulkPricingResult> {
    if (!updates || updates.length === 0) {
      throw new BadRequestAppException('No updates provided');
    }
    if (updates.length > 50) {
      throw new BadRequestAppException('Maximum 50 updates per request');
    }

    let updatedProducts = 0;
    let updatedVariants = 0;
    const errors: { productId: string; error: string }[] = [];

    for (const update of updates) {
      try {
        // Validate product exists
        const product = await this.prisma.product.findUnique({
          where: { id: update.productId },
          select: { id: true, isDeleted: true },
        });

        if (!product) {
          errors.push({ productId: update.productId, error: 'Product not found' });
          continue;
        }

        if (product.isDeleted) {
          errors.push({ productId: update.productId, error: 'Product is deleted' });
          continue;
        }

        // Update product platform price
        if (update.platformPrice !== undefined) {
          if (update.platformPrice < 0) {
            errors.push({ productId: update.productId, error: 'Platform price must be non-negative' });
            continue;
          }
          await this.prisma.product.update({
            where: { id: update.productId },
            data: { platformPrice: update.platformPrice },
          });
          updatedProducts++;
        }

        // Update variant platform prices
        if (update.variantUpdates && update.variantUpdates.length > 0) {
          for (const vu of update.variantUpdates) {
            if (vu.platformPrice < 0) {
              errors.push({ productId: update.productId, error: `Variant ${vu.variantId}: price must be non-negative` });
              continue;
            }
            try {
              const variant = await this.prisma.productVariant.findFirst({
                where: { id: vu.variantId, productId: update.productId, isDeleted: false },
              });
              if (!variant) {
                errors.push({ productId: update.productId, error: `Variant ${vu.variantId} not found` });
                continue;
              }
              await this.prisma.productVariant.update({
                where: { id: vu.variantId },
                data: { platformPrice: vu.platformPrice },
              });
              updatedVariants++;
            } catch (err) {
              errors.push({
                productId: update.productId,
                error: `Variant ${vu.variantId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
              });
            }
          }
        }
      } catch (err) {
        errors.push({
          productId: update.productId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return { updatedProducts, updatedVariants, errors };
  }

  // ── T6: Override allocation (reassign sub-order) ────────────────────────

  async reassignSubOrder(subOrderId: string, newSellerId: string): Promise<ReassignResult> {
    if (!subOrderId) throw new BadRequestAppException('subOrderId is required');
    if (!newSellerId) throw new BadRequestAppException('sellerId is required');

    // 1. Get the sub-order with items
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        items: true,
        masterOrder: { select: { id: true, orderNumber: true } },
      },
    });

    if (!subOrder) {
      throw new NotFoundAppException(`Sub-order ${subOrderId} not found`);
    }

    if (subOrder.sellerId === newSellerId) {
      throw new BadRequestAppException('Sub-order is already assigned to this seller');
    }

    // Only allow reassignment for OPEN sub-orders
    if (subOrder.acceptStatus !== 'OPEN') {
      throw new BadRequestAppException(
        `Cannot reassign sub-order with accept status ${subOrder.acceptStatus}. Only OPEN sub-orders can be reassigned.`,
      );
    }

    const previousSellerId = subOrder.sellerId;

    // 2. Validate new seller exists and is active
    const newSeller = await this.prisma.seller.findUnique({
      where: { id: newSellerId },
      select: { id: true, status: true, sellerName: true },
    });

    if (!newSeller) {
      throw new NotFoundAppException(`Seller ${newSellerId} not found`);
    }

    if (newSeller.status !== 'ACTIVE') {
      throw new BadRequestAppException(`Seller ${newSellerId} is not active (status: ${newSeller.status})`);
    }

    // 3. For each item, verify the new seller has a mapping and sufficient stock
    for (const item of subOrder.items) {
      const mapping = await this.prisma.sellerProductMapping.findFirst({
        where: {
          sellerId: newSellerId,
          productId: item.productId,
          variantId: item.variantId,
          isActive: true,
        },
      });

      if (!mapping) {
        throw new BadRequestAppException(
          `Seller ${newSellerId} does not have an active mapping for product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''}`,
        );
      }

      const available = mapping.stockQty - mapping.reservedQty;
      if (available < item.quantity) {
        throw new ConflictAppException(
          `Seller ${newSellerId} has insufficient stock for product ${item.productId}: available=${available}, required=${item.quantity}`,
        );
      }
    }

    // 4. Execute reassignment in a transaction
    await this.prisma.$transaction(async (tx) => {
      // Release current seller's reservations for this sub-order
      const currentReservations = await tx.stockReservation.findMany({
        where: {
          orderId: subOrder.masterOrderId,
          status: { in: ['RESERVED', 'CONFIRMED'] },
          mapping: { sellerId: previousSellerId },
        },
      });

      for (const res of currentReservations) {
        if (res.status === 'RESERVED') {
          await tx.stockReservation.update({
            where: { id: res.id },
            data: { status: 'RELEASED' },
          });
          await tx.sellerProductMapping.update({
            where: { id: res.mappingId },
            data: { reservedQty: { decrement: res.quantity } },
          });
        }
      }

      // Create new reservations for the new seller
      for (const item of subOrder.items) {
        const newMapping = await tx.sellerProductMapping.findFirst({
          where: {
            sellerId: newSellerId,
            productId: item.productId,
            variantId: item.variantId,
            isActive: true,
          },
        });

        if (newMapping) {
          await tx.stockReservation.create({
            data: {
              mappingId: newMapping.id,
              quantity: item.quantity,
              status: 'CONFIRMED',
              orderId: subOrder.masterOrderId,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
          });

          await tx.sellerProductMapping.update({
            where: { id: newMapping.id },
            data: { reservedQty: { increment: item.quantity } },
          });
        }
      }

      // Update sub-order seller
      await tx.subOrder.update({
        where: { id: subOrderId },
        data: { sellerId: newSellerId },
      });

      // Log the override in allocation_logs
      for (const item of subOrder.items) {
        await tx.allocationLog.create({
          data: {
            productId: item.productId,
            variantId: item.variantId,
            customerPincode: 'ADMIN_OVERRIDE',
            allocatedSellerId: newSellerId,
            allocationReason: `Admin override: reassigned from seller ${previousSellerId} to ${newSellerId}`,
            isReallocated: true,
            orderId: subOrder.masterOrderId,
          },
        });
      }
    });

    this.logger.log(
      `Sub-order ${subOrderId} reassigned from seller ${previousSellerId} to ${newSellerId}`,
    );

    return {
      subOrderId,
      previousSellerId,
      newSellerId,
      message: `Sub-order successfully reassigned to seller ${newSeller.sellerName}`,
    };
  }

  // ── T7: Seller mapping suspension ───────────────────────────────────────

  async suspendSellerMappings(sellerId: string): Promise<MappingSuspensionResult> {
    if (!sellerId) throw new BadRequestAppException('sellerId is required');

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, sellerName: true, isDeleted: true },
    });

    if (!seller) {
      throw new NotFoundAppException(`Seller ${sellerId} not found`);
    }

    if (seller.isDeleted) {
      throw new BadRequestAppException(`Seller ${sellerId} is deleted`);
    }

    const result = await this.prisma.sellerProductMapping.updateMany({
      where: { sellerId, isActive: true },
      data: { isActive: false },
    });

    this.logger.log(
      `Suspended ${result.count} mappings for seller ${sellerId} (${seller.sellerName})`,
    );

    return {
      sellerId,
      affectedMappings: result.count,
      action: 'suspended',
    };
  }

  async activateSellerMappings(sellerId: string): Promise<MappingSuspensionResult> {
    if (!sellerId) throw new BadRequestAppException('sellerId is required');

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, sellerName: true, isDeleted: true },
    });

    if (!seller) {
      throw new NotFoundAppException(`Seller ${sellerId} not found`);
    }

    if (seller.isDeleted) {
      throw new BadRequestAppException(`Seller ${sellerId} is deleted`);
    }

    const result = await this.prisma.sellerProductMapping.updateMany({
      where: { sellerId, isActive: false },
      data: { isActive: true },
    });

    this.logger.log(
      `Activated ${result.count} mappings for seller ${sellerId} (${seller.sellerName})`,
    );

    return {
      sellerId,
      affectedMappings: result.count,
      action: 'activated',
    };
  }
}
