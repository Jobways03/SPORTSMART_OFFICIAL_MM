import { Injectable, Inject } from '@nestjs/common';
import {
  FranchiseInventoryRepository,
  FRANCHISE_INVENTORY_REPOSITORY,
} from '../../domain/repositories/franchise-inventory.repository.interface';
import {
  FranchiseCatalogRepository,
  FRANCHISE_CATALOG_REPOSITORY,
} from '../../domain/repositories/franchise-catalog.repository.interface';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';

@Injectable()
export class FranchiseInventoryService {
  constructor(
    @Inject(FRANCHISE_INVENTORY_REPOSITORY)
    private readonly inventoryRepo: FranchiseInventoryRepository,
    @Inject(FRANCHISE_CATALOG_REPOSITORY)
    private readonly catalogRepo: FranchiseCatalogRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('FranchiseInventoryService');
  }

  // Phase 159o (audit #18) — emit a stock-movement event so downstream
  // listeners (low-stock alerting, dashboards) can subscribe. Fire-and-forget.
  private publishMovement(args: {
    franchiseId: string;
    productId: string;
    variantId: string | null;
    movementType: string;
    quantityDelta: number;
    referenceId?: string;
  }): void {
    this.eventBus
      .publish({
        eventName: 'franchise.inventory.moved',
        aggregate: 'franchise',
        aggregateId: args.franchiseId,
        occurredAt: new Date(),
        payload: { ...args },
      })
      .catch(() => undefined);
  }

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

    // Phase 159n (audit #7) — a franchise must not hold/adjust stock for a SKU
    // it isn't approved to carry. Require an APPROVED + active catalog mapping
    // before any manual stock movement.
    const mapping = await this.catalogRepo.findApprovedActiveByFranchiseAndProduct(
      franchiseId,
      productId,
      variantId ?? null,
    );
    if (!mapping) {
      throw new BadRequestAppException(
        `Cannot adjust stock: product ${productId}${variantId ? ` / variant ${variantId}` : ''} is not an approved, active mapping in this franchise's catalog`,
      );
    }

    // Determine which field to update based on adjustment type
    const updateField: 'onHandQty' | 'damagedQty' =
      adjustmentType === 'DAMAGE' ? 'damagedQty' : 'onHandQty';

    // For DAMAGE, we also need to deduct from onHandQty
    // For DAMAGE: positive quantity means items damaged, so deduct from onHand and add to damaged
    if (adjustmentType === 'DAMAGE' && quantity > 0) {
      // Phase 159o (audit #4) — both legs (deduct onHand, add damaged) now run
      // in ONE transaction. Previously each was its own $transaction, so a
      // failure between them left onHand decremented but damaged unincremented
      // (inventory evaporated).
      const result = await this.prisma.$transaction(async (tx) => {
        await this.inventoryRepo.adjustStockWithLedger(
          {
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
          },
          tx,
        );
        return this.inventoryRepo.adjustStockWithLedger(
          {
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
          },
          tx,
        );
      });
      this.publishMovement({
        franchiseId,
        productId,
        variantId: variantId ?? null,
        movementType: adjustmentType,
        quantityDelta: -quantity,
      });
      return result;
    }

    // Resolve globalSku from existing stock record
    const existingStock = await this.inventoryRepo.findStock(
      franchiseId,
      productId,
      variantId ?? null,
    );
    const globalSku = existingStock?.globalSku || '';

    const result = await this.inventoryRepo.adjustStockWithLedger({
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
    this.publishMovement({
      franchiseId,
      productId,
      variantId: variantId ?? null,
      movementType: adjustmentType,
      quantityDelta: quantity,
    });
    return result;
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

    // Idempotent release. A cancellation can fire unreserve more than once —
    // retries, or because the reserve and its release carry different
    // correlation ids (reserve stamps OrderItem.stockReservationId, the cancel
    // path passes the order / master-order id), so a prior release can't be
    // de-duped. Releasing more than is currently held is therefore an EXPECTED,
    // benign no-op rather than an error. Clamp to what's actually reserved
    // instead of throwing — the old throw logged a noisy "Cannot unreserve more
    // than reserved" WARN on every redundant cancel (every caller already
    // catches it best-effort, so it never blocked a cancellation; it was pure
    // noise). The over-release guard's real invariant — reservedQty can never
    // go negative — is preserved here because we release at most what is held.
    const releaseQty = Math.min(quantity, stock.reservedQty);
    if (releaseQty <= 0) {
      // Already fully released — nothing to do.
      return { stock, ledgerEntry: null };
    }
    if (releaseQty < quantity) {
      // Partial: held less than requested. Rarer than the plain redundant
      // cancel and worth surfacing (a possible reserve/release imbalance), but
      // it no longer throws — we release what's there and carry on.
      this.logger.warn(
        `Clamped franchise unreserve for ${franchiseId} product ${productId}` +
          `${variantId ? ` / variant ${variantId}` : ''}: requested ${quantity}, ` +
          `only ${stock.reservedQty} reserved — released ${releaseQty}.`,
      );
    }

    return this.inventoryRepo.adjustStockWithLedger({
      franchiseId,
      productId,
      variantId,
      globalSku: stock.globalSku,
      movementType: 'ORDER_UNRESERVE',
      quantityDelta: -releaseQty,
      referenceType: 'ORDER',
      referenceId: orderId,
      remarks: `Unreserved ${releaseQty} units`,
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

    // Phase 159o (audit #16) — idempotent on (order, product, variant). A
    // retried confirmShipment must not double-decrement: if an ORDER_SHIP
    // ledger row already exists for this order+SKU, this is a replay → no-op.
    const alreadyShipped = await this.prisma.franchiseInventoryLedger.findFirst({
      where: {
        movementType: 'ORDER_SHIP',
        referenceType: 'ORDER',
        referenceId: orderId,
        franchiseId,
        productId,
        variantId: variantId ?? null,
      },
      select: { id: true },
    });
    if (alreadyShipped) {
      return { stock, ledgerEntry: null };
    }

    // Phase 159o (audit #5) — both legs (reduce reserved, deduct onHand) in ONE
    // transaction. Previously two separate $transactions: a partial failure
    // left reserved decremented but onHand still holding the shipped units.
    const result = await this.prisma.$transaction(async (tx) => {
      await this.inventoryRepo.adjustStockWithLedger(
        {
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
        },
        tx,
      );
      return this.inventoryRepo.adjustStockWithLedger(
        {
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
        },
        tx,
      );
    });
    this.publishMovement({
      franchiseId,
      productId,
      variantId: variantId ?? null,
      movementType: 'ORDER_SHIP',
      quantityDelta: -quantity,
      referenceId: orderId,
    });
    return result;
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

    const result = await this.inventoryRepo.adjustStockWithLedger({
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
    this.publishMovement({
      franchiseId,
      productId,
      variantId,
      movementType: 'ORDER_RETURN',
      quantityDelta: quantity,
      referenceId: orderId,
    });
    return result;
  }

  /**
   * Add stock from procurement (called when franchise confirms receipt).
   *
   * Phase 55 (2026-05-21) — accepts actorId + optional actorType
   * (audit Gap #2) so the ledger row attributes the receipt to the
   * franchise user who confirmed it, not the catch-all 'SYSTEM'.
   * Also accepts an optional tx so the outer
   * procurement.confirmReceipt transaction can compose this call
   * into a single atomic unit (audit Gap #4).
   */
  async addProcurementStock(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    globalSku: string,
    quantity: number,
    procurementId: string,
    actorId: string,
    franchiseSku?: string,
    actorType: string = 'FRANCHISE_USER',
    tx?: import('@prisma/client').Prisma.TransactionClient,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('Procurement quantity must be positive');
    }

    // Ensure stock record exists (initialize if needed). Outside the
    // optional outer tx because initializeStock has its own retry
    // semantics on the unique constraint.
    await this.inventoryRepo.initializeStock(
      franchiseId,
      productId,
      variantId,
      globalSku,
      franchiseSku,
    );

    return this.inventoryRepo.adjustStockWithLedger(
      {
        franchiseId,
        productId,
        variantId,
        globalSku,
        movementType: 'PROCUREMENT_IN',
        quantityDelta: quantity,
        referenceType: 'PROCUREMENT',
        referenceId: procurementId,
        remarks: `Received ${quantity} units from procurement`,
        actorType,
        actorId,
        updateField: 'onHandQty',
      },
      tx,
    );
  }

  /**
   * Phase 55 (2026-05-21) — increments FranchiseStock.damagedQty and
   * writes a DAMAGE ledger row with referenceType='PROCUREMENT' so
   * damaged units from a procurement shipment are no longer
   * forensically invisible (audit Gap #3). Pre-Phase-55 the
   * confirmReceipt flow silently dropped damaged units — they were
   * subtracted out of goodQty but never recorded anywhere.
   */
  async addDamagedFromProcurement(
    franchiseId: string,
    productId: string,
    variantId: string | null,
    globalSku: string,
    quantity: number,
    procurementId: string,
    actorId: string,
    tx?: import('@prisma/client').Prisma.TransactionClient,
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('Damaged quantity must be positive');
    }
    return this.inventoryRepo.adjustStockWithLedger(
      {
        franchiseId,
        productId,
        variantId,
        globalSku,
        movementType: 'DAMAGE',
        quantityDelta: quantity,
        referenceType: 'PROCUREMENT',
        referenceId: procurementId,
        remarks: `Procurement receipt: ${quantity} unit(s) reported damaged`,
        actorType: 'FRANCHISE_USER',
        actorId,
        updateField: 'damagedQty',
      },
      tx,
    );
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
    // Phase 159q (audit #2) — accept the POS sale's outer transaction so the
    // stock deduction commits/rolls-back atomically with the sale row.
    tx?: import('@prisma/client').Prisma.TransactionClient,
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

    const result = await this.inventoryRepo.adjustStockWithLedger(
      {
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
      },
      tx,
    );
    this.publishMovement({
      franchiseId,
      productId,
      variantId,
      movementType: 'POS_SALE',
      quantityDelta: -quantity,
      referenceId: saleId,
    });
    return result;
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
    // Phase 159q (audit #14) — accept the return's outer transaction.
    tx?: import('@prisma/client').Prisma.TransactionClient,
    // Phase 159r — POS void/return audit:
    //   #8 movementType: 'POS_VOID' for a void restock vs 'POS_RETURN' for a
    //      genuine customer return (daily reconciliation distinguishes them).
    //   #7 toDamaged: a DAMAGED return restocks damagedQty, not sellable
    //      onHandQty.
    opts?: { movementType?: 'POS_RETURN' | 'POS_VOID'; toDamaged?: boolean },
  ): Promise<{ stock: any; ledgerEntry: any }> {
    if (quantity <= 0) {
      throw new BadRequestAppException('POS return quantity must be positive');
    }

    const stock = await this.inventoryRepo.findStock(franchiseId, productId, variantId);
    if (!stock) {
      throw new NotFoundAppException('Stock record not found for this product');
    }

    const movementType = opts?.movementType ?? 'POS_RETURN';
    const updateField = opts?.toDamaged ? 'damagedQty' : 'onHandQty';
    const verb = movementType === 'POS_VOID' ? 'void' : 'return';
    const result = await this.inventoryRepo.adjustStockWithLedger(
      {
        franchiseId,
        productId,
        variantId,
        globalSku: stock.globalSku,
        movementType,
        quantityDelta: quantity,
        referenceType: 'POS_SALE',
        referenceId: saleId,
        remarks: `POS ${verb} of ${quantity} units${opts?.toDamaged ? ' (damaged → damagedQty)' : ''}`,
        actorType: 'FRANCHISE_OWNER',
        actorId,
        updateField,
      },
      tx,
    );
    this.publishMovement({
      franchiseId,
      productId,
      variantId,
      movementType,
      quantityDelta: quantity,
      referenceId: saleId,
    });
    return result;
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
