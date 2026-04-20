import { Injectable, Inject } from '@nestjs/common';
import {
  FranchiseInventoryRepository,
  FRANCHISE_INVENTORY_REPOSITORY,
} from '../../domain/repositories/franchise-inventory.repository.interface';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';

@Injectable()
export class FranchiseInventoryService {
  constructor(
    @Inject(FRANCHISE_INVENTORY_REPOSITORY)
    private readonly inventoryRepo: FranchiseInventoryRepository,
  ) {}

  /**
   * Get stock overview for franchise dashboard.
   */
  async getStockOverview(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      search?: string;
      lowStockOnly?: boolean;
    },
  ): Promise<{ stocks: any[]; total: number }> {
    return this.inventoryRepo.findStockByFranchise(franchiseId, params);
  }

  /**
   * Get stock detail for a specific product.
   */
  async getStockDetail(
    franchiseId: string,
    productId: string,
    variantId?: string,
  ): Promise<any | null> {
    return this.inventoryRepo.findStock(
      franchiseId,
      productId,
      variantId ?? null,
    );
  }

  /**
   * Get low stock alerts.
   */
  async getLowStockAlerts(franchiseId: string): Promise<any[]> {
    return this.inventoryRepo.findLowStockItems(franchiseId);
  }

  /**
   * Manual stock adjustment (admin or franchise owner action).
   */
  async adjustStock(
    franchiseId: string,
    input: {
      productId: string;
      variantId?: string;
      adjustmentType: 'DAMAGE' | 'LOSS' | 'ADJUSTMENT' | 'AUDIT_CORRECTION';
      quantity: number;
      reason: string;
      actorType: string;
      actorId: string;
    },
  ): Promise<{ stock: any; ledgerEntry: any }> {
    const { productId, variantId, adjustmentType, quantity, reason, actorType, actorId } = input;

    // Determine which field to update based on adjustment type
    const updateField: 'onHandQty' | 'damagedQty' =
      adjustmentType === 'DAMAGE' ? 'damagedQty' : 'onHandQty';

    // For DAMAGE, we also need to deduct from onHandQty
    // For DAMAGE: positive quantity means items damaged, so deduct from onHand and add to damaged
    if (adjustmentType === 'DAMAGE' && quantity > 0) {
      // First deduct from onHand
      await this.inventoryRepo.adjustStockWithLedger({
        franchiseId,
        productId,
        variantId: variantId ?? null,
        globalSku: '', // Will be resolved from existing stock
        movementType: adjustmentType,
        quantityDelta: -quantity,
        referenceType: 'MANUAL',
        remarks: reason,
        actorType,
        actorId,
        updateField: 'onHandQty',
      });

      // Then add to damagedQty
      return this.inventoryRepo.adjustStockWithLedger({
        franchiseId,
        productId,
        variantId: variantId ?? null,
        globalSku: '',
        movementType: adjustmentType,
        quantityDelta: quantity,
        referenceType: 'MANUAL',
        remarks: reason,
        actorType,
        actorId,
        updateField: 'damagedQty',
      });
    }

    // Resolve globalSku from existing stock record
    const existingStock = await this.inventoryRepo.findStock(
      franchiseId,
      productId,
      variantId ?? null,
    );
    const globalSku = existingStock?.globalSku || '';

    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId: variantId ?? null,
      globalSku,
      movementType: adjustmentType,
      quantityDelta: quantity,
      referenceType: 'MANUAL',
      remarks: reason,
      actorType,
      actorId,
      updateField,
    });
  }

  /**
   * Reserve stock for an online order (called by routing engine).
   */
  async reserveStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId?: string,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('Reserve quantity must be positive');
    }

    // Verify sufficient available stock
    const stock = await this.inventoryRepo.findStock(franchiseId, productId, variantId);
    if (!stock) {
      throw new NotFoundAppException('Stock record not found for this product');
    }
    if (stock.availableQty < quantity) {
      throw new BadRequestAppException(
        `Insufficient available stock: available=${stock.availableQty}, requested=${quantity}`,
      );
    }

    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku: stock.globalSku,
      movementType: 'ORDER_RESERVE',
      quantityDelta: quantity,
      referenceType: 'ORDER',
      referenceId: orderId,
      remarks: `Reserved ${quantity} units for order`,
      actorType: 'SYSTEM',
      updateField: 'reservedQty',
    });
  }

  /**
   * Unreserve stock (order cancelled before fulfillment).
   */
  async unreserveStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId?: string,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('Unreserve quantity must be positive');
    }

    const stock = await this.inventoryRepo.findStock(franchiseId, productId, variantId);
    if (!stock) {
      throw new NotFoundAppException('Stock record not found for this product');
    }
    if (stock.reservedQty < quantity) {
      throw new BadRequestAppException(
        `Cannot unreserve more than reserved: reserved=${stock.reservedQty}, requested=${quantity}`,
      );
    }

    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku: stock.globalSku,
      movementType: 'ORDER_UNRESERVE',
      quantityDelta: -quantity,
      referenceType: 'ORDER',
      referenceId: orderId,
      remarks: `Unreserved ${quantity} units`,
      actorType: 'SYSTEM',
      updateField: 'reservedQty',
    });
  }

  /**
   * Confirm shipment (reserved -> shipped, deducts from onHand).
   */
  async confirmShipment(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId: string,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('Ship quantity must be positive');
    }

    const stock = await this.inventoryRepo.findStock(franchiseId, productId, variantId);
    if (!stock) {
      throw new NotFoundAppException('Stock record not found for this product');
    }
    if (stock.reservedQty < quantity) {
      throw new BadRequestAppException(
        `Cannot ship more than reserved: reserved=${stock.reservedQty}, requested=${quantity}`,
      );
    }

    // First, reduce reserved qty
    await this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku: stock.globalSku,
      movementType: 'ORDER_SHIP',
      quantityDelta: -quantity,
      referenceType: 'ORDER',
      referenceId: orderId,
      remarks: `Shipped ${quantity} units — reducing reserved`,
      actorType: 'SYSTEM',
      updateField: 'reservedQty',
    });

    // Then, deduct from onHand
    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku: stock.globalSku,
      movementType: 'ORDER_SHIP',
      quantityDelta: -quantity,
      referenceType: 'ORDER',
      referenceId: orderId,
      remarks: `Shipped ${quantity} units — deducting on-hand`,
      actorType: 'SYSTEM',
      updateField: 'onHandQty',
    });
  }

  /**
   * Record return (adds back to onHand).
   */
  async recordReturn(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId: string,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('Return quantity must be positive');
    }

    const stock = await this.inventoryRepo.findStock(franchiseId, productId, variantId);
    if (!stock) {
      throw new NotFoundAppException('Stock record not found for this product');
    }

    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku: stock.globalSku,
      movementType: 'ORDER_RETURN',
      quantityDelta: quantity,
      referenceType: 'ORDER',
      referenceId: orderId,
      remarks: `Returned ${quantity} units`,
      actorType: 'SYSTEM',
      updateField: 'onHandQty',
    });
  }

  /**
   * Add stock from procurement (called when franchise confirms receipt).
   */
  async addProcurementStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    globalSku: string,
    quantity: number,
    procurementId: string,
    franchiseSku?: string,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('Procurement quantity must be positive');
    }

    // Ensure stock record exists (initialize if needed)
    await this.inventoryRepo.initializeStock(
      franchiseId,
      productId,
      variantId,
      globalSku,
      franchiseSku,
    );

    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku,
      movementType: 'PROCUREMENT_IN',
      quantityDelta: quantity,
      referenceType: 'PROCUREMENT',
      referenceId: procurementId,
      remarks: `Received ${quantity} units from procurement`,
      actorType: 'SYSTEM',
      updateField: 'onHandQty',
    });
  }

  /**
   * Deduct stock for POS sale.
   */
  async deductPosStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    saleId: string,
    actorId: string,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('POS sale quantity must be positive');
    }

    const stock = await this.inventoryRepo.findStock(franchiseId, productId, variantId);
    if (!stock) {
      throw new NotFoundAppException('Stock record not found for this product');
    }
    if (stock.availableQty < quantity) {
      throw new BadRequestAppException(
        `Insufficient available stock for POS sale: available=${stock.availableQty}, requested=${quantity}`,
      );
    }

    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku: stock.globalSku,
      movementType: 'POS_SALE',
      quantityDelta: -quantity,
      referenceType: 'POS_SALE',
      referenceId: saleId,
      remarks: `POS sale of ${quantity} units`,
      actorType: 'FRANCHISE_OWNER',
      actorId,
      updateField: 'onHandQty',
    });
  }

  /**
   * Return stock from POS return.
   */
  async returnPosStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    saleId: string,
    actorId: string,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('POS return quantity must be positive');
    }

    const stock = await this.inventoryRepo.findStock(franchiseId, productId, variantId);
    if (!stock) {
      throw new NotFoundAppException('Stock record not found for this product');
    }

    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku: stock.globalSku,
      movementType: 'POS_RETURN',
      quantityDelta: quantity,
      referenceType: 'POS_SALE',
      referenceId: saleId,
      remarks: `POS return of ${quantity} units`,
      actorType: 'FRANCHISE_OWNER',
      actorId,
      updateField: 'onHandQty',
    });
  }

  /**
   * Get movement history (ledger entries).
   */
  async getMovementHistory(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      productId?: string;
      movementType?: string;
      referenceType?: string;
      fromDate?: Date;
      toDate?: Date;
    },
  ): Promise<{ entries: any[]; total: number }> {
    return this.inventoryRepo.findLedgerEntries(franchiseId, params);
  }

  /**
   * Get available stock quantity for routing decisions.
   */
  async getAvailableStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<number> {
    const stock = await this.inventoryRepo.findStock(
      franchiseId,
      productId,
      variantId,
    );
    return stock?.availableQty ?? 0;
  }
}
