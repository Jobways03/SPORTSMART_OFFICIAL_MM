import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
  ConflictAppException,
} from '../../../../core/exceptions';
import {
  AdminControlTowerRepository,
  ADMIN_CONTROL_TOWER_REPOSITORY,
} from '../../domain/repositories/admin-control-tower.repository.interface';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface BulkPricingUpdate {
  productId: string;
  price?: number;
  variantUpdates?: { variantId: string; price: number }[];
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

  constructor(
    @Inject(ADMIN_CONTROL_TOWER_REPOSITORY)
    private readonly repo: AdminControlTowerRepository,
  ) {}

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
        const product = await this.repo.findProductById(update.productId);

        if (!product) {
          errors.push({ productId: update.productId, error: 'Product not found' });
          continue;
        }

        if (product.isDeleted) {
          errors.push({ productId: update.productId, error: 'Product is deleted' });
          continue;
        }

        // Update product platform price
        if (update.price !== undefined) {
          if (update.price < 0) {
            errors.push({ productId: update.productId, error: 'Platform price must be non-negative' });
            continue;
          }
          await this.repo.updateProductPrice(update.productId, update.price);
          updatedProducts++;
        }

        // Update variant platform prices
        if (update.variantUpdates && update.variantUpdates.length > 0) {
          for (const vu of update.variantUpdates) {
            if (vu.price < 0) {
              errors.push({ productId: update.productId, error: `Variant ${vu.variantId}: price must be non-negative` });
              continue;
            }
            try {
              const variant = await this.repo.findVariantForProduct(vu.variantId, update.productId);
              if (!variant) {
                errors.push({ productId: update.productId, error: `Variant ${vu.variantId} not found` });
                continue;
              }
              await this.repo.updateVariantPrice(vu.variantId, vu.price);
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
    const subOrder = await this.repo.findSubOrderWithItems(subOrderId);

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
    const newSeller = await this.repo.findSellerById(newSellerId);

    if (!newSeller) {
      throw new NotFoundAppException(`Seller ${newSellerId} not found`);
    }

    if (newSeller.status !== 'ACTIVE') {
      throw new BadRequestAppException(`Seller ${newSellerId} is not active (status: ${newSeller.status})`);
    }

    // 3. For each item, verify the new seller has a mapping and sufficient stock
    for (const item of subOrder.items) {
      const mapping = await this.repo.findActiveSellerMapping(
        newSellerId,
        item.productId,
        item.variantId,
      );

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
    await this.repo.executeReassignment(async (tx) => {
      // Release current seller's reservations for this sub-order
      const currentReservations = await tx.findReservationsForRelease(
        subOrder.masterOrderId,
        previousSellerId,
      );

      for (const res of currentReservations) {
        if (res.status === 'RESERVED') {
          await tx.releaseReservation(res.id, res.mappingId, res.quantity);
        }
      }

      // Create new reservations for the new seller
      for (const item of subOrder.items) {
        const newMapping = await tx.findSellerMapping(
          newSellerId,
          item.productId,
          item.variantId,
        );

        if (newMapping) {
          await tx.createConfirmedReservation(
            newMapping.id,
            item.quantity,
            subOrder.masterOrderId,
          );
          await tx.incrementMappingReservedQty(newMapping.id, item.quantity);
        }
      }

      // Update sub-order seller
      await tx.updateSubOrderSeller(subOrderId, newSellerId);

      // Log the override in allocation_logs
      for (const item of subOrder.items) {
        await tx.createAllocationLog({
          productId: item.productId,
          variantId: item.variantId,
          customerPincode: 'ADMIN_OVERRIDE',
          allocatedSellerId: newSellerId,
          allocationReason: `Admin override: reassigned from seller ${previousSellerId} to ${newSellerId}`,
          isReallocated: true,
          orderId: subOrder.masterOrderId,
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

    const seller = await this.repo.findSellerBasic(sellerId);

    if (!seller) {
      throw new NotFoundAppException(`Seller ${sellerId} not found`);
    }

    if (seller.isDeleted) {
      throw new BadRequestAppException(`Seller ${sellerId} is deleted`);
    }

    const affectedMappings = await this.repo.suspendSellerMappings(sellerId);

    this.logger.log(
      `Suspended ${affectedMappings} mappings for seller ${sellerId} (${seller.sellerName})`,
    );

    return {
      sellerId,
      affectedMappings,
      action: 'suspended',
    };
  }

  async activateSellerMappings(sellerId: string): Promise<MappingSuspensionResult> {
    if (!sellerId) throw new BadRequestAppException('sellerId is required');

    const seller = await this.repo.findSellerBasic(sellerId);

    if (!seller) {
      throw new NotFoundAppException(`Seller ${sellerId} not found`);
    }

    if (seller.isDeleted) {
      throw new BadRequestAppException(`Seller ${sellerId} is deleted`);
    }

    const affectedMappings = await this.repo.activateSellerMappings(sellerId);

    this.logger.log(
      `Activated ${affectedMappings} mappings for seller ${sellerId} (${seller.sellerName})`,
    );

    return {
      sellerId,
      affectedMappings,
      action: 'activated',
    };
  }
}
