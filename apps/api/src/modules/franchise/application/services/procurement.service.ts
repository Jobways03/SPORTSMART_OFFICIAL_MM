import { Injectable, Inject } from '@nestjs/common';
import {
  ProcurementRepository,
  PROCUREMENT_REPOSITORY,
} from '../../domain/repositories/procurement.repository.interface';
import {
  FranchiseCatalogRepository,
  FRANCHISE_CATALOG_REPOSITORY,
} from '../../domain/repositories/franchise-catalog.repository.interface';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';
import { FranchiseInventoryService } from './franchise-inventory.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  NotFoundAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FranchiseCommissionService } from './franchise-commission.service';

@Injectable()
export class ProcurementService {
  constructor(
    @Inject(PROCUREMENT_REPOSITORY)
    private readonly procurementRepo: ProcurementRepository,
    @Inject(FRANCHISE_CATALOG_REPOSITORY)
    private readonly catalogRepo: FranchiseCatalogRepository,
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    private readonly inventoryService: FranchiseInventoryService,
    private readonly commissionService: FranchiseCommissionService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext('ProcurementService');
  }

  // ═══════════════════════════════════════════════════════════════
  // Franchise-facing methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a new procurement request (DRAFT).
   */
  async createRequest(
    franchiseId: string,
    items: Array<{ productId: string; variantId?: string; quantity: number }>,
  ) {
    if (!items || items.length === 0) {
      throw new BadRequestAppException(
        'At least one item is required to create a procurement request',
      );
    }

    // Look up the franchise to get procurementFeeRate
    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise) {
      throw new NotFoundAppException('Franchise not found');
    }
    if (franchise.status !== 'ACTIVE' && franchise.status !== 'APPROVED') {
      throw new ForbiddenAppException(
        'Procurement is only available for active franchises',
      );
    }
    if (franchise.contractEndDate && new Date() > new Date(franchise.contractEndDate)) {
      throw new ForbiddenAppException(
        'Franchise contract has expired — cannot create procurement requests',
      );
    }

    const procurementFeeRate = Number(franchise.procurementFeeRate ?? 5);

    // Validate all items have catalog mappings and resolve product info
    const resolvedItems: Array<{
      productId: string;
      variantId?: string;
      globalSku: string;
      productTitle: string;
      variantTitle?: string;
      requestedQty: number;
    }> = [];

    for (const item of items) {
      const mapping = await this.catalogRepo.findByFranchiseAndProduct(
        franchiseId,
        item.productId,
        item.variantId ?? null,
      );

      if (!mapping) {
        throw new BadRequestAppException(
          `Product ${item.productId}${item.variantId ? ` / variant ${item.variantId}` : ''} is not in your catalog mappings`,
        );
      }

      // Resolve product title from the database
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        select: { title: true },
      });

      let variantTitle: string | undefined;
      if (item.variantId) {
        const variant = await this.prisma.productVariant.findUnique({
          where: { id: item.variantId },
          select: { title: true },
        });
        variantTitle = variant?.title ?? undefined;
      }

      resolvedItems.push({
        productId: item.productId,
        variantId: item.variantId,
        globalSku: mapping.globalSku,
        productTitle: product?.title ?? '',
        variantTitle,
        requestedQty: item.quantity,
      });
    }

    // Generate request number
    const requestNumber = await this.procurementRepo.generateNextRequestNumber();

    // Create the request
    const request = await this.procurementRepo.create({
      franchiseId,
      requestNumber,
      procurementFeeRate,
    });

    // Create items
    const createdItems = await this.procurementRepo.createItems(
      request.id,
      resolvedItems,
    );

    this.logger.log(
      `Procurement request ${requestNumber} created for franchise ${franchiseId} with ${createdItems.length} items`,
    );

    return { ...request, items: createdItems };
  }

  /**
   * Submit a draft request for admin review.
   */
  async submitRequest(franchiseId: string, requestId: string) {
    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (
      !franchise ||
      (franchise.status !== 'ACTIVE' && franchise.status !== 'APPROVED')
    ) {
      throw new ForbiddenAppException(
        'Cannot submit procurement — franchise is not active',
      );
    }

    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.franchiseId !== franchiseId) {
      throw new ForbiddenAppException(
        'You do not have access to this procurement request',
      );
    }
    if (request.status !== 'DRAFT') {
      throw new BadRequestAppException(
        `Cannot submit a request in ${request.status} status. Only DRAFT requests can be submitted.`,
      );
    }

    const updated = await this.procurementRepo.update(requestId, {
      status: 'SUBMITTED',
      requestedAt: new Date(),
    });

    await this.eventBus.publish({
      eventName: 'procurement.submitted',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId,
        requestNumber: request.requestNumber,
      },
    });

    this.logger.log(`Procurement request ${request.requestNumber} submitted`);

    return updated;
  }

  /**
   * List franchise's own procurement requests.
   */
  async getMyRequests(
    franchiseId: string,
    page: number,
    limit: number,
    status?: string,
  ) {
    return this.procurementRepo.findByFranchiseId(franchiseId, {
      page,
      limit,
      status,
    });
  }

  /**
   * Cancel a DRAFT or SUBMITTED procurement request.
   */
  async cancelRequest(franchiseId: string, requestId: string, reason?: string) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.franchiseId !== franchiseId) {
      throw new ForbiddenAppException('Not your request');
    }

    // Can only cancel DRAFT or SUBMITTED requests
    const cancellableStatuses = ['DRAFT', 'SUBMITTED'];
    if (!cancellableStatuses.includes(request.status)) {
      throw new BadRequestAppException(
        `Cannot cancel request in ${request.status} status. Only DRAFT and SUBMITTED requests can be cancelled.`,
      );
    }

    const updated = await this.procurementRepo.update(requestId, {
      status: 'CANCELLED',
      notes: reason
        ? `Cancelled by franchise: ${reason}`
        : 'Cancelled by franchise',
    });

    this.logger.log(
      `Procurement ${requestId} cancelled by franchise ${franchiseId}`,
    );

    return updated;
  }

  /**
   * Get a single procurement request with items (franchise-facing).
   */
  async getRequestDetail(franchiseId: string, requestId: string) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.franchiseId !== franchiseId) {
      throw new ForbiddenAppException(
        'You do not have access to this procurement request',
      );
    }
    return request;
  }

  /**
   * Franchise confirms receipt of dispatched goods.
   * This is when stock actually gets added to inventory.
   */
  async confirmReceipt(
    franchiseId: string,
    requestId: string,
    items: Array<{
      itemId: string;
      receivedQty: number;
      damagedQty?: number;
    }>,
  ) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.franchiseId !== franchiseId) {
      throw new ForbiddenAppException(
        'You do not have access to this procurement request',
      );
    }
    // Allow second-pass top-ups from PARTIALLY_RECEIVED so a franchise can
    // mark the remaining units as received when the rest of the shipment
    // arrives later.
    if (
      request.status !== 'DISPATCHED' &&
      request.status !== 'PARTIALLY_RECEIVED'
    ) {
      throw new BadRequestAppException(
        `Cannot confirm receipt for a request in ${request.status} status. Only DISPATCHED or PARTIALLY_RECEIVED requests can be received.`,
      );
    }

    // Process each item — only DISPATCHED (approved+dispatched) items can be received
    for (const receiptItem of items) {
      const existingItem = await this.procurementRepo.findItemById(
        receiptItem.itemId,
      );
      if (!existingItem) {
        throw new NotFoundAppException(
          `Procurement item ${receiptItem.itemId} not found`,
        );
      }
      if (existingItem.procurementRequestId !== requestId) {
        throw new BadRequestAppException(
          `Item ${receiptItem.itemId} does not belong to this procurement request`,
        );
      }

      // Skip items that were rejected — they were never dispatched
      if (existingItem.status === 'REJECTED') {
        this.logger.warn(
          `Skipping receipt for rejected item ${receiptItem.itemId} in request ${request.requestNumber}`,
        );
        continue;
      }

      const damagedQty = receiptItem.damagedQty ?? 0;

      // Determine item status based on received vs dispatched
      let itemStatus = 'RECEIVED';
      if (receiptItem.receivedQty === 0) {
        itemStatus = 'SHORT';
      } else if (damagedQty > 0 && damagedQty >= receiptItem.receivedQty) {
        itemStatus = 'DAMAGED';
      } else if (receiptItem.receivedQty < existingItem.dispatchedQty) {
        itemStatus = 'SHORT';
      }

      // Update the item
      await this.procurementRepo.updateItem(receiptItem.itemId, {
        receivedQty: receiptItem.receivedQty,
        damagedQty,
        status: itemStatus,
      });

      // Add received stock to inventory (only good units)
      const goodQty = receiptItem.receivedQty - damagedQty;
      if (goodQty > 0) {
        await this.inventoryService.addProcurementStock(
          franchiseId,
          existingItem.productId,
          existingItem.variantId ?? null,
          existingItem.globalSku,
          goodQty,
          requestId,
        );
      }
    }

    // Calculate totals
    const totals = await this.procurementRepo.calculateTotals(requestId);

    // Decide final request status by inspecting every non-REJECTED item.
    //   • all terminal (RECEIVED/DAMAGED) → RECEIVED
    //   • any still PENDING/SHORT        → PARTIALLY_RECEIVED (awaiting top-up)
    const refreshed = await this.procurementRepo.findByIdWithItems(requestId);
    const actionableItems = (refreshed?.items ?? []).filter(
      (i: any) => i.status !== 'REJECTED',
    );
    const anyShort = actionableItems.some(
      (i: any) => i.status === 'SHORT' || i.status === 'PENDING',
    );
    const finalStatus = anyShort ? 'PARTIALLY_RECEIVED' : 'RECEIVED';

    // Update request status and totals. Only stamp receivedAt when the
    // request is fully received — a partial top-up leaves it unset so the
    // final receipt date reflects completion.
    const updated = await this.procurementRepo.update(requestId, {
      status: finalStatus,
      ...(finalStatus === 'RECEIVED' ? { receivedAt: new Date() } : {}),
      totalApprovedAmount: totals.totalApprovedAmount,
      procurementFeeAmount: totals.procurementFeeAmount,
      finalPayableAmount: totals.finalPayableAmount,
    });

    await this.eventBus.publish({
      eventName:
        finalStatus === 'RECEIVED'
          ? 'procurement.received'
          : 'procurement.partially_received',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId,
        requestNumber: request.requestNumber,
        finalPayableAmount: totals.finalPayableAmount,
      },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} ${finalStatus === 'RECEIVED' ? 'fully received' : 'partially received'} by franchise`,
    );

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════
  // Admin-facing methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * Admin view of all procurement requests.
   */
  async listAllRequests(
    page: number,
    limit: number,
    status?: string,
    franchiseId?: string,
    search?: string,
  ) {
    return this.procurementRepo.findAllPaginated({
      page,
      limit,
      status,
      franchiseId,
      search,
    });
  }

  /**
   * Admin approves a procurement request, setting pricing per item.
   */
  async approveRequest(
    adminId: string,
    requestId: string,
    items: Array<{
      itemId: string;
      approvedQty: number;
      landedUnitCost: number;
      sourceSellerId?: string;
    }>,
  ) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.status !== 'SUBMITTED') {
      throw new BadRequestAppException(
        `Cannot approve a request in ${request.status} status. Only SUBMITTED requests can be approved.`,
      );
    }

    const feeRate = Number(request.procurementFeeRate);

    // Process each item individually
    const processedItems: Array<{ itemId: string; status: string }> = [];

    for (const approveItem of items) {
      const existingItem = await this.procurementRepo.findItemById(
        approveItem.itemId,
      );
      if (!existingItem) {
        throw new NotFoundAppException(
          `Procurement item ${approveItem.itemId} not found`,
        );
      }
      if (existingItem.procurementRequestId !== requestId) {
        throw new BadRequestAppException(
          `Item ${approveItem.itemId} does not belong to this procurement request`,
        );
      }

      const itemStatus =
        approveItem.approvedQty > 0 ? 'APPROVED' : 'REJECTED';

      if (approveItem.approvedQty > 0) {
        const procurementFeePerUnit =
          approveItem.landedUnitCost * (feeRate / 100);
        const finalUnitCostToFranchise =
          approveItem.landedUnitCost + procurementFeePerUnit;

        await this.procurementRepo.updateItem(approveItem.itemId, {
          approvedQty: approveItem.approvedQty,
          landedUnitCost: approveItem.landedUnitCost,
          procurementFeePerUnit,
          finalUnitCostToFranchise,
          sourceSellerId: approveItem.sourceSellerId ?? null,
          status: itemStatus,
        });
      } else {
        // Rejected item — zero out costs
        await this.procurementRepo.updateItem(approveItem.itemId, {
          approvedQty: 0,
          landedUnitCost: 0,
          procurementFeePerUnit: 0,
          finalUnitCostToFranchise: 0,
          sourceSellerId: approveItem.sourceSellerId ?? null,
          status: itemStatus,
        });
      }

      processedItems.push({ itemId: approveItem.itemId, status: itemStatus });
    }

    // Determine request-level status based on per-item decisions
    const approvedItems = processedItems.filter(i => i.status === 'APPROVED');
    const rejectedItems = processedItems.filter(i => i.status === 'REJECTED');

    let requestStatus: string;
    if (approvedItems.length === 0) {
      requestStatus = 'REJECTED';
    } else if (rejectedItems.length > 0) {
      requestStatus = 'PARTIALLY_APPROVED';
    } else {
      requestStatus = 'APPROVED';
    }

    // Calculate request-level totals
    const totals = await this.procurementRepo.calculateTotals(requestId);

    // Update request status
    const updated = await this.procurementRepo.update(requestId, {
      status: requestStatus,
      approvedAt: new Date(),
      approvedBy: adminId,
      totalApprovedAmount: totals.totalApprovedAmount,
      procurementFeeAmount: totals.procurementFeeAmount,
      finalPayableAmount: totals.finalPayableAmount,
    });

    await this.eventBus.publish({
      eventName: 'procurement.approved',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId: request.franchiseId,
        requestNumber: request.requestNumber,
        adminId,
        requestStatus,
        totalApprovedAmount: totals.totalApprovedAmount,
      },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} ${requestStatus} by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Admin rejects a procurement request.
   *
   * `reason` is stored on the dedicated `rejectionReason` column so the
   * free-form `notes` field stays clean. If the existing `notes` field is
   * empty, we also mirror the reason into it so callers that only read
   * `notes` keep working — but canonical source is `rejectionReason`.
   */
  async rejectRequest(adminId: string, requestId: string, reason?: string) {
    const request = await this.procurementRepo.findById(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.status !== 'SUBMITTED') {
      throw new BadRequestAppException(
        `Cannot reject a request in ${request.status} status. Only SUBMITTED requests can be rejected.`,
      );
    }

    const updated = await this.procurementRepo.update(requestId, {
      status: 'REJECTED',
      rejectionReason: reason ?? null,
    });

    await this.eventBus.publish({
      eventName: 'procurement.rejected',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId: request.franchiseId,
        requestNumber: request.requestNumber,
        adminId,
        reason,
      },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} rejected by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Admin marks a procurement request as dispatched. Shipment tracking
   * (number, carrier, ETA) is optional but recommended — it's what the
   * franchise sees on their detail page when the goods are in transit.
   */
  async markDispatched(
    adminId: string,
    requestId: string,
    shipment?: {
      trackingNumber?: string | null;
      carrierName?: string | null;
      expectedDeliveryAt?: Date | null;
    },
  ) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (
      request.status !== 'APPROVED' &&
      request.status !== 'PARTIALLY_APPROVED' &&
      request.status !== 'SOURCING'
    ) {
      throw new BadRequestAppException(
        `Cannot mark as dispatched. Request is in ${request.status} status. Only APPROVED, PARTIALLY_APPROVED, or SOURCING requests can be dispatched.`,
      );
    }

    // Only dispatch APPROVED items — skip REJECTED ones
    for (const item of request.items) {
      if (item.status === 'REJECTED') {
        // Leave rejected items unchanged
        continue;
      }
      if (
        item.status === 'APPROVED' ||
        item.status === 'SOURCED' ||
        item.status === 'PENDING'
      ) {
        await this.procurementRepo.updateItem(item.id, {
          status: 'DISPATCHED',
          dispatchedQty: item.approvedQty,
        });
      }
    }

    const updated = await this.procurementRepo.update(requestId, {
      status: 'DISPATCHED',
      dispatchedAt: new Date(),
      trackingNumber: shipment?.trackingNumber ?? null,
      carrierName: shipment?.carrierName ?? null,
      expectedDeliveryAt: shipment?.expectedDeliveryAt ?? null,
    });

    await this.eventBus.publish({
      eventName: 'procurement.dispatched',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId: request.franchiseId,
        requestNumber: request.requestNumber,
        adminId,
        trackingNumber: shipment?.trackingNumber ?? null,
        carrierName: shipment?.carrierName ?? null,
        expectedDeliveryAt: shipment?.expectedDeliveryAt ?? null,
      },
    });

    this.logger.log(
      `Procurement request ${request.requestNumber} dispatched by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Admin settles a received procurement request.
   */
  async settleRequest(adminId: string, requestId: string) {
    const request = await this.procurementRepo.findById(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    if (request.status !== 'RECEIVED') {
      throw new BadRequestAppException(
        `Cannot settle a request in ${request.status} status. Only RECEIVED requests can be settled.`,
      );
    }

    const updated = await this.procurementRepo.update(requestId, {
      status: 'SETTLED',
      settledAt: new Date(),
    });

    await this.eventBus.publish({
      eventName: 'procurement.settled',
      aggregate: 'ProcurementRequest',
      aggregateId: requestId,
      occurredAt: new Date(),
      payload: {
        requestId,
        franchiseId: request.franchiseId,
        requestNumber: request.requestNumber,
        adminId,
        finalPayableAmount: Number(request.finalPayableAmount),
      },
    });

    // Record procurement fee in finance ledger
    const totalLandedCost = Number(request.totalApprovedAmount ?? 0);
    const feeRate = Number(request.procurementFeeRate ?? 0);
    if (totalLandedCost > 0 && feeRate > 0) {
      try {
        await this.commissionService.recordProcurementFee({
          franchiseId: request.franchiseId,
          procurementRequestId: requestId,
          totalLandedCost,
          feeRate,
        });
      } catch (err) {
        this.logger.warn(
          `Failed to record procurement fee for request ${request.requestNumber}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Procurement request ${request.requestNumber} settled by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Get a single procurement request with items (admin-facing, no ownership check).
   */
  async getRequestDetailAdmin(requestId: string) {
    const request = await this.procurementRepo.findByIdWithItems(requestId);
    if (!request) {
      throw new NotFoundAppException('Procurement request not found');
    }
    return request;
  }
}
