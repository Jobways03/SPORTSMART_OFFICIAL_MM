import { Inject, Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { assertTransition } from '../../../../core/fsm/status-transitions';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
import {
  RETURN_REPOSITORY,
  ReturnRepository,
} from '../../domain/repositories/return.repository.interface';
import { ReturnAutoApprovalService } from './return-auto-approval.service';
import { ReturnEligibilityService } from './return-eligibility.service';
import { ReturnStockRestorationService } from './return-stock-restoration.service';
import { ReturnCommissionReversalService } from './return-commission-reversal.service';
import { RefundGatewayService } from './refund-gateway.service';

export interface CreateReturnInput {
  subOrderId: string;
  items: Array<{
    orderItemId: string;
    quantity: number;
    reasonCategory: string;
    reasonDetail?: string;
  }>;
  customerNotes?: string;
}

export interface ListCustomerReturnsParams {
  page: number;
  limit: number;
  status?: string;
}

export interface ListAllReturnsParams {
  page: number;
  limit: number;
  status?: string;
  customerId?: string;
  subOrderId?: string;
  fulfillmentNodeType?: string;
  fromDate?: Date;
  toDate?: Date;
  search?: string;
}

export interface SchedulePickupInput {
  pickupScheduledAt: Date;
  pickupAddress?: any; // optional override; default to shipping address
  pickupTrackingNumber?: string;
  pickupCourier?: string;
}

export interface SubmitQcDecisionInput {
  decisions: Array<{
    returnItemId: string;
    qcOutcome: 'APPROVED' | 'REJECTED' | 'PARTIAL' | 'DAMAGED';
    qcQuantityApproved: number;
    qcNotes?: string;
  }>;
  overallNotes?: string;
}

export interface ConfirmRefundInput {
  refundReference: string;
  refundMethod?: string;
  notes?: string;
}

const REFUND_MAX_RETRY_ATTEMPTS = 5;

@Injectable()
export class ReturnService {
  constructor(
    @Inject(RETURN_REPOSITORY)
    private readonly returnRepo: ReturnRepository,
    private readonly prisma: PrismaService,
    private readonly eligibilityService: ReturnEligibilityService,
    private readonly autoApprovalService: ReturnAutoApprovalService,
    private readonly stockRestorationService: ReturnStockRestorationService,
    private readonly commissionReversalService: ReturnCommissionReversalService,
    private readonly refundGateway: RefundGatewayService,
    private readonly cloudinaryAdapter: CloudinaryAdapter,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('ReturnService');
  }

  // ── Eligibility ────────────────────────────────────────────────────────

  async getOrderEligibility(masterOrderId: string, customerId: string) {
    return this.eligibilityService.checkOrderEligibility(
      masterOrderId,
      customerId,
    );
  }

  // ── Create ─────────────────────────────────────────────────────────────

  async createReturn(customerId: string, input: CreateReturnInput) {
    // Validate
    const { subOrder, masterOrder } =
      await this.eligibilityService.validateReturnRequest({
        customerId,
        subOrderId: input.subOrderId,
        items: input.items.map((i) => ({
          orderItemId: i.orderItemId,
          quantity: i.quantity,
        })),
      });

    // Generate return number
    const returnNumber = await this.returnRepo.generateNextReturnNumber();

    // Create return
    const created = await this.returnRepo.create({
      returnNumber,
      subOrderId: subOrder.id,
      masterOrderId: masterOrder.id,
      customerId,
      initiatedBy: 'CUSTOMER',
      initiatorId: customerId,
      customerNotes: input.customerNotes,
      items: input.items.map((i) => ({
        orderItemId: i.orderItemId,
        quantity: i.quantity,
        reasonCategory: i.reasonCategory,
        reasonDetail: i.reasonDetail,
      })),
    });

    // Publish requested event (best-effort)
    try {
      await this.eventBus.publish({
        eventName: 'returns.return.requested',
        aggregate: 'Return',
        aggregateId: created.id,
        occurredAt: new Date(),
        payload: {
          returnId: created.id,
          returnNumber,
          customerId,
          subOrderId: subOrder.id,
          masterOrderId: masterOrder.id,
          itemCount: input.items.length,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Return ${returnNumber} created by customer ${customerId}`,
    );

    // ── Auto-approval evaluation ────────────────────────────────────────
    const fullReturn = await this.returnRepo.findByIdWithItems(created.id);
    const autoApprovalDecision =
      this.autoApprovalService.evaluateAutoApproval(fullReturn);

    if (autoApprovalDecision.autoApprove) {
      await this.returnRepo.update(created.id, {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: 'SYSTEM',
      });
      await this.returnRepo.recordStatusChange(
        created.id,
        'REQUESTED',
        'APPROVED',
        'SYSTEM',
        undefined,
        `Auto-approved: ${autoApprovalDecision.reason}`,
      );

      try {
        await this.eventBus.publish({
          eventName: 'returns.return.approved',
          aggregate: 'Return',
          aggregateId: created.id,
          occurredAt: new Date(),
          payload: {
            returnId: created.id,
            returnNumber,
            approvedBy: 'SYSTEM',
            autoApproved: true,
          },
        });
      } catch {
        // events are best-effort
      }

      this.logger.log(
        `Return ${returnNumber} auto-approved: ${autoApprovalDecision.reason}`,
      );
    } else {
      this.logger.log(
        `Return ${returnNumber} not auto-approved: ${autoApprovalDecision.reason}`,
      );
    }

    return this.returnRepo.findByIdWithItems(created.id);
  }

  // ── List customer returns ──────────────────────────────────────────────

  async listCustomerReturns(
    customerId: string,
    params: ListCustomerReturnsParams,
  ) {
    const { returns, total } = await this.returnRepo.findByCustomerId(
      customerId,
      params,
    );

    return {
      returns,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
    };
  }

  // ── Return detail ──────────────────────────────────────────────────────

  async getReturnDetail(returnId: string, customerId: string) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) {
      throw new NotFoundAppException('Return not found');
    }
    if (ret.customerId !== customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    return ret;
  }

  // ── Cancel ─────────────────────────────────────────────────────────────

  async cancelReturn(returnId: string, customerId: string) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) {
      throw new NotFoundAppException('Return not found');
    }
    if (ret.customerId !== customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    if (ret.status !== 'REQUESTED') {
      throw new BadRequestAppException(
        'Return can only be cancelled while in REQUESTED status',
      );
    }

    const updated = await this.returnRepo.update(returnId, {
      status: 'CANCELLED',
      closedAt: new Date(),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'REQUESTED',
      'CANCELLED',
      'CUSTOMER',
      customerId,
      'Cancelled by customer',
    );

    // Publish event (best-effort)
    try {
      await this.eventBus.publish({
        eventName: 'returns.return.cancelled',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          customerId,
          cancelledBy: 'CUSTOMER',
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Return ${ret.returnNumber} cancelled by customer ${customerId}`,
    );
    return updated;
  }

  // ── Admin: list all returns ────────────────────────────────────────────

  async listAllReturns(params: ListAllReturnsParams) {
    const { returns, total } = await this.returnRepo.findAllPaginated(params);
    return {
      returns,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
    };
  }

  // ── Admin: get return by id ────────────────────────────────────────────

  async getReturnByIdAdmin(returnId: string) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    return ret;
  }

  // ── Admin: approve ─────────────────────────────────────────────────────

  async approveReturn(returnId: string, adminId: string, notes?: string) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REQUESTED') {
      throw new BadRequestAppException(
        `Return must be in REQUESTED status to approve (current: ${ret.status})`,
      );
    }

    const updated = await this.returnRepo.update(returnId, {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: adminId,
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'REQUESTED',
      'APPROVED',
      'ADMIN',
      adminId,
      notes,
    );

    // Publish event (best-effort)
    try {
      await this.eventBus.publish({
        eventName: 'returns.return.approved',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          approvedBy: adminId,
          autoApproved: false,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Return ${ret.returnNumber} approved by admin ${adminId}`,
    );
    return updated;
  }

  // ── Admin: reject ──────────────────────────────────────────────────────

  async rejectReturn(returnId: string, adminId: string, reason: string) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REQUESTED') {
      throw new BadRequestAppException(
        `Return must be in REQUESTED status to reject (current: ${ret.status})`,
      );
    }

    const updated = await this.returnRepo.update(returnId, {
      status: 'REJECTED',
      rejectedAt: new Date(),
      rejectedBy: adminId,
      rejectionReason: reason,
      closedAt: new Date(),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'REQUESTED',
      'REJECTED',
      'ADMIN',
      adminId,
      reason,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.rejected',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          reason,
          rejectedBy: adminId,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Return ${ret.returnNumber} rejected by admin ${adminId}`,
    );
    return updated;
  }

  // ── Admin: schedule pickup ─────────────────────────────────────────────

  async schedulePickup(
    returnId: string,
    adminId: string,
    input: SchedulePickupInput,
  ) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'APPROVED') {
      throw new BadRequestAppException(
        `Return must be APPROVED to schedule pickup (current: ${ret.status})`,
      );
    }

    const updated = await this.returnRepo.update(returnId, {
      status: 'PICKUP_SCHEDULED',
      pickupScheduledAt: input.pickupScheduledAt,
      pickupAddress:
        input.pickupAddress || ret.masterOrder?.shippingAddressSnapshot,
      pickupTrackingNumber: input.pickupTrackingNumber,
      pickupCourier: input.pickupCourier,
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'APPROVED',
      'PICKUP_SCHEDULED',
      'ADMIN',
      adminId,
      `Pickup scheduled for ${input.pickupScheduledAt.toISOString()}`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.pickup_scheduled',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          pickupScheduledAt: input.pickupScheduledAt,
          tracking: input.pickupTrackingNumber,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Pickup scheduled for return ${ret.returnNumber} by admin ${adminId}`,
    );
    return updated;
  }

  // ── Mark in transit (customer or admin) ────────────────────────────────

  async markInTransit(
    returnId: string,
    actorType: string,
    actorId: string,
    trackingNumber?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'PICKUP_SCHEDULED' && ret.status !== 'APPROVED') {
      throw new BadRequestAppException(
        `Return must be APPROVED or PICKUP_SCHEDULED to mark in transit (current: ${ret.status})`,
      );
    }

    const updateData: Record<string, unknown> = { status: 'IN_TRANSIT' };
    if (trackingNumber) updateData.pickupTrackingNumber = trackingNumber;

    const updated = await this.returnRepo.update(returnId, updateData);

    await this.returnRepo.recordStatusChange(
      returnId,
      ret.status,
      'IN_TRANSIT',
      actorType,
      actorId,
      'Package handed over for pickup',
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.in_transit',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          trackingNumber,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Return ${ret.returnNumber} marked in transit by ${actorType} ${actorId}`,
    );
    return updated;
  }

  // ── Customer marks handed over ─────────────────────────────────────────

  async markHandedOverByCustomer(
    returnId: string,
    customerId: string,
    trackingNumber?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.customerId !== customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    return this.markInTransit(returnId, 'CUSTOMER', customerId, trackingNumber);
  }

  // ── Phase R3: Warehouse receipt & QC ────────────────────────────────────

  /**
   * Mark a return as received at the warehouse/fulfillment node.
   * Allowed from IN_TRANSIT (preferred) or directly from PICKUP_SCHEDULED.
   */
  async markReceived(
    returnId: string,
    actorType: string,
    actorId: string,
    notes?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'IN_TRANSIT' && ret.status !== 'PICKUP_SCHEDULED') {
      throw new BadRequestAppException(
        `Return must be IN_TRANSIT to mark received (current: ${ret.status})`,
      );
    }

    const updated = await this.returnRepo.update(returnId, {
      status: 'RECEIVED',
      receivedAt: new Date(),
      receivedBy: actorId,
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      ret.status,
      'RECEIVED',
      actorType,
      actorId,
      notes,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.received',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          receivedBy: actorId,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Return ${ret.returnNumber} marked RECEIVED by ${actorType} ${actorId}`,
    );
    return updated;
  }

  /**
   * Upload a QC evidence image for a return (saved to Cloudinary).
   */
  async uploadQcEvidence(
    returnId: string,
    actorType: string,
    actorId: string,
    fileBuffer: Buffer,
    fileMimetype: string,
    description?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (!['RECEIVED', 'IN_TRANSIT'].includes(ret.status)) {
      throw new BadRequestAppException(
        `Cannot upload QC evidence in status ${ret.status}`,
      );
    }

    // Upload to Cloudinary
    const uploadResult = await this.cloudinaryAdapter.upload(fileBuffer, {
      folder: `returns/${returnId}/evidence`,
    });

    const evidence = await this.returnRepo.addEvidence({
      returnId,
      uploadedBy: actorType,
      uploaderId: actorId,
      fileType: fileMimetype,
      fileUrl: uploadResult.secureUrl,
      publicId: uploadResult.publicId,
      description,
    });

    this.logger.log(
      `QC evidence uploaded for return ${ret.returnNumber} by ${actorType} ${actorId}`,
    );
    return evidence;
  }

  /**
   * Submit per-item QC decisions. Updates each return item, triggers stock
   * restoration and commission reversal, and moves the return to the
   * appropriate terminal QC state.
   */
  async submitQcDecision(
    returnId: string,
    actorType: string,
    actorId: string,
    input: SubmitQcDecisionInput,
  ) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'RECEIVED') {
      throw new BadRequestAppException(
        `Return must be RECEIVED to submit QC (current: ${ret.status})`,
      );
    }

    // Validate decisions match return items
    for (const decision of input.decisions) {
      const item = ret.items.find((i: any) => i.id === decision.returnItemId);
      if (!item) {
        throw new BadRequestAppException(
          `Return item ${decision.returnItemId} not found`,
        );
      }
      if (decision.qcQuantityApproved > item.quantity) {
        throw new BadRequestAppException(
          `qcQuantityApproved (${decision.qcQuantityApproved}) cannot exceed return quantity (${item.quantity})`,
        );
      }
      if (decision.qcQuantityApproved < 0) {
        throw new BadRequestAppException(
          `qcQuantityApproved cannot be negative`,
        );
      }
    }

    // Pre-compute per-item refund amounts (no DB writes yet — just math).
    const perItemRefunds = input.decisions.map((decision) => {
      const item = ret.items.find((i: any) => i.id === decision.returnItemId);
      const unitPrice = Number(item.orderItem?.unitPrice ?? 0);
      return {
        returnItemId: decision.returnItemId,
        qcOutcome: decision.qcOutcome,
        qcQuantityApproved: decision.qcQuantityApproved,
        qcNotes: decision.qcNotes,
        refundAmount:
          Math.round(decision.qcQuantityApproved * unitPrice * 100) / 100,
      };
    });

    // Determine overall outcome
    const allApproved = input.decisions.every(
      (d) => d.qcOutcome === 'APPROVED' && d.qcQuantityApproved > 0,
    );
    const noneApproved = input.decisions.every(
      (d) => d.qcQuantityApproved === 0,
    );

    let newStatus: string;
    let qcDecision: string;
    if (noneApproved) {
      newStatus = 'QC_REJECTED';
      qcDecision = 'REJECTED';
    } else if (allApproved) {
      newStatus = 'QC_APPROVED';
      qcDecision = 'APPROVED';
    } else {
      newStatus = 'PARTIALLY_APPROVED';
      qcDecision = 'PARTIAL';
    }

    // FSM enforcement — RECEIVED is the only valid source state for QC
    // outcomes. The check at the top of this method already validates
    // ret.status === 'RECEIVED' but pinning the rule centrally here means
    // the FSM module is the single source of truth.
    assertTransition('ReturnStatus', ret.status, newStatus);

    const isFranchise = ret.subOrder?.fulfillmentNodeType === 'FRANCHISE';

    // For FRANCHISE returns, stock + commission reversal flow through the
    // franchise facade which manages its own transactions across the module
    // boundary. Run those FIRST so that if they fail we have not yet
    // mutated any return state — admin can retry safely.
    //
    // For SELLER returns, all writes are local Prisma writes and run inside
    // the single transaction below for full atomicity.
    if (isFranchise) {
      // Build a temporary return view with the QC decisions applied so the
      // helper services compute the right amounts.
      const projectedReturn = {
        ...ret,
        items: ret.items.map((it: any) => {
          const decision = perItemRefunds.find(
            (d) => d.returnItemId === it.id,
          );
          return decision
            ? { ...it, qcQuantityApproved: decision.qcQuantityApproved }
            : it;
        }),
      };
      await this.stockRestorationService.restoreStockForReturn(
        projectedReturn,
        input.decisions,
      );
      await this.commissionReversalService.reverseCommissionForReturn(
        projectedReturn,
      );
    }

    // Single atomic transaction wrapping all return-side writes plus the
    // seller-path stock + commission reversal (no-ops for franchise path).
    const refundAmount = await this.prisma.$transaction(async (tx) => {
      // 1. Update each return item with QC decision
      for (const decision of perItemRefunds) {
        await tx.returnItem.update({
          where: { id: decision.returnItemId },
          data: {
            qcOutcome: decision.qcOutcome as any,
            qcQuantityApproved: decision.qcQuantityApproved,
            qcNotes: decision.qcNotes,
            refundAmount: decision.refundAmount,
          },
        });
      }

      // 2. For seller path: restore stock + reverse commission inside tx.
      //    For franchise path: helpers no-op on the local DB (they only call
      //    the franchise facade which already ran above).
      const projectedReturn = {
        ...ret,
        items: ret.items.map((it: any) => {
          const decision = perItemRefunds.find(
            (d) => d.returnItemId === it.id,
          );
          return decision
            ? { ...it, qcQuantityApproved: decision.qcQuantityApproved }
            : it;
        }),
      };
      if (!isFranchise) {
        await this.stockRestorationService.restoreStockForReturn(
          projectedReturn,
          input.decisions,
          tx,
        );
      }
      const totalRefund = !isFranchise
        ? await this.commissionReversalService.reverseCommissionForReturn(
            projectedReturn,
            tx,
          )
        : // For franchise path the commission has already been reversed
          // above via the facade — just compute the refund amount locally
          // for the return record.
          this.computeRefundAmount(projectedReturn);

      // 3. Update the return record itself
      await tx.return.update({
        where: { id: returnId },
        data: {
          status: newStatus as any,
          qcCompletedAt: new Date(),
          qcDecision: qcDecision as any,
          qcNotes: input.overallNotes,
          refundAmount: totalRefund,
        },
      });

      // 4. Append status history
      await tx.returnStatusHistory.create({
        data: {
          returnId,
          fromStatus: 'RECEIVED' as any,
          toStatus: newStatus as any,
          changedBy: actorType,
          changedById: actorId,
          notes: input.overallNotes,
        },
      });

      return totalRefund;
    });

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.qc_completed',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          qcDecision,
          refundAmount,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `QC completed for return ${ret.returnNumber}: ${qcDecision}, refund=₹${refundAmount}`,
    );

    // Auto-initiate refund for QC_APPROVED and PARTIALLY_APPROVED returns with refund > 0
    if (
      refundAmount > 0 &&
      (newStatus === 'QC_APPROVED' || newStatus === 'PARTIALLY_APPROVED')
    ) {
      try {
        await this.initiateRefund(returnId, 'SYSTEM', actorId);
        this.logger.log(
          `Refund auto-initiated for return ${ret.returnNumber} after QC approval`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to auto-initiate refund for return ${ret.returnNumber}: ${(err as Error).message}`,
        );
        // Don't throw — QC succeeded; admin can manually initiate refund if needed
      }
    }

    return this.returnRepo.findByIdWithItems(returnId);
  }

  /**
   * Compute the total refund amount for a return based on the QC-approved
   * quantities. Used for the franchise path where the commission reversal
   * helper has already executed via the facade and only the local refund
   * total is needed for the return record.
   */
  private computeRefundAmount(returnRecord: any): number {
    let total = 0;
    for (const item of returnRecord.items ?? []) {
      const orderItem = item.orderItem;
      if (!orderItem) continue;
      const approvedQty = item.qcQuantityApproved || 0;
      total += approvedQty * Number(orderItem.unitPrice);
    }
    return Math.round(total * 100) / 100;
  }

  // ── Phase R3: Fulfillment node helpers ──────────────────────────────────

  async listReturnsForFulfillmentNode(params: {
    nodeType: 'SELLER' | 'FRANCHISE';
    nodeId: string;
    page: number;
    limit: number;
    status?: string;
  }) {
    const { returns, total } =
      await this.returnRepo.findReturnsForFulfillmentNode(params);
    return {
      returns,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
    };
  }

  async getReturnDetailForNode(
    returnId: string,
    nodeType: 'SELLER' | 'FRANCHISE',
    nodeId: string,
  ) {
    await this.assertNodeOwnsReturn(returnId, nodeType, nodeId);
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    return ret;
  }

  async assertNodeOwnsReturn(
    returnId: string,
    nodeType: 'SELLER' | 'FRANCHISE',
    nodeId: string,
  ): Promise<void> {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    const subOrder = ret.subOrder;
    if (!subOrder) throw new NotFoundAppException('Sub-order not loaded');

    if (nodeType === 'SELLER' && subOrder.sellerId !== nodeId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    if (nodeType === 'FRANCHISE' && subOrder.franchiseId !== nodeId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
  }

  // ── Phase R4: Refund processing ─────────────────────────────────────────

  /**
   * Initiate refund processing for a QC_APPROVED or PARTIALLY_APPROVED return.
   * Transitions the return to REFUND_PROCESSING. Attempts gateway processing;
   * if the gateway cannot process (COD / stubbed), the return stays in
   * REFUND_PROCESSING and requires manual confirmation by an admin.
   */
  async initiateRefund(
    returnId: string,
    actorType: string,
    actorId: string,
    refundMethod?: string,
  ) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    if (ret.status === 'REFUND_PROCESSING' || ret.status === 'REFUNDED') {
      throw new BadRequestAppException(
        'Refund already in progress or completed',
      );
    }

    const validStatuses = ['QC_APPROVED', 'PARTIALLY_APPROVED'];
    if (!validStatuses.includes(ret.status)) {
      throw new BadRequestAppException(
        `Return must be QC_APPROVED or PARTIALLY_APPROVED to initiate refund (current: ${ret.status})`,
      );
    }

    if (!ret.refundAmount || Number(ret.refundAmount) <= 0) {
      throw new BadRequestAppException(
        'No refund amount calculated for this return',
      );
    }

    const masterOrder = ret.masterOrder;
    if (!masterOrder) {
      throw new BadRequestAppException(
        'Master order not loaded for this return',
      );
    }

    // Determine refund method based on original payment
    const detectedMethod =
      refundMethod ||
      (masterOrder.paymentMethod === 'COD'
        ? 'BANK_TRANSFER'
        : 'ORIGINAL_PAYMENT');

    // Try gateway processing
    const gatewayResult = await this.refundGateway.processRefund({
      orderId: masterOrder.id,
      orderNumber: masterOrder.orderNumber,
      paymentMethod: masterOrder.paymentMethod,
      amount: Number(ret.refundAmount),
      customerId: ret.customerId,
      returnId: ret.id,
      returnNumber: ret.returnNumber,
    });

    // Audit: record the gateway attempt before updating return state
    await this.prisma.refundTransaction.create({
      data: {
        returnId,
        attemptNumber: (ret.refundAttempts ?? 0) + 1,
        amount: Number(ret.refundAmount),
        gatewayRefundId: gatewayResult.gatewayRefundId ?? null,
        status: gatewayResult.success ? 'INITIATED' : 'FAILED',
        failureReason: gatewayResult.failureReason ?? null,
        actorType,
        actorId,
      },
    });

    // Update return state
    const updateData: Record<string, unknown> = {
      status: 'REFUND_PROCESSING',
      refundMethod: detectedMethod,
      refundInitiatedBy: actorType,
      refundInitiatedAt: new Date(),
      refundAttempts: { increment: 1 },
      refundLastAttemptAt: new Date(),
    };

    if (gatewayResult.success && gatewayResult.gatewayRefundId) {
      updateData.refundReference = gatewayResult.gatewayRefundId;
      updateData.refundFailureReason = null;
    } else if (gatewayResult.failureReason) {
      updateData.refundFailureReason = gatewayResult.failureReason;
    }

    const updated = await this.returnRepo.update(returnId, updateData);

    await this.returnRepo.recordStatusChange(
      returnId,
      ret.status,
      'REFUND_PROCESSING',
      actorType,
      actorId,
      `Refund initiated — method: ${detectedMethod}${
        gatewayResult.requiresManualProcessing
          ? ' (manual processing required)'
          : ''
      }`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.refund.initiated',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          refundAmount: Number(ret.refundAmount),
          refundMethod: detectedMethod,
          requiresManualProcessing: gatewayResult.requiresManualProcessing,
          gatewayRefundId: gatewayResult.gatewayRefundId,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Refund initiated for return ${ret.returnNumber}: ₹${ret.refundAmount} via ${detectedMethod}`,
    );

    return updated;
  }

  /**
   * Confirm that a refund has been completed (either by admin after manual
   * processing or after polling the gateway). Transitions REFUND_PROCESSING
   * to REFUNDED and records the refund reference.
   */
  async confirmRefund(
    returnId: string,
    actorType: string,
    actorId: string,
    input: ConfirmRefundInput,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REFUND_PROCESSING') {
      throw new BadRequestAppException(
        `Return must be REFUND_PROCESSING to confirm refund (current: ${ret.status})`,
      );
    }

    const updateData: Record<string, unknown> = {
      status: 'REFUNDED',
      refundReference: input.refundReference,
      refundProcessedAt: new Date(),
      refundFailureReason: null,
    };
    if (input.refundMethod) updateData.refundMethod = input.refundMethod;

    const updated = await this.returnRepo.update(returnId, updateData);

    await this.returnRepo.recordStatusChange(
      returnId,
      'REFUND_PROCESSING',
      'REFUNDED',
      actorType,
      actorId,
      input.notes || `Refund completed — reference: ${input.refundReference}`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.refund.completed',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          refundAmount: Number(ret.refundAmount),
          refundReference: input.refundReference,
          processedBy: actorId,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Refund confirmed for return ${ret.returnNumber}: ${input.refundReference}`,
    );
    return updated;
  }

  /**
   * Record a refund attempt failure. Return remains in REFUND_PROCESSING so
   * it can be retried. The failure reason and timestamp are captured.
   */
  async markRefundFailed(
    returnId: string,
    actorType: string,
    actorId: string,
    reason: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REFUND_PROCESSING') {
      throw new BadRequestAppException(
        `Return must be REFUND_PROCESSING to mark refund failed (current: ${ret.status})`,
      );
    }

    // Don't change status — keep as REFUND_PROCESSING so it can be retried.
    // Just record the failure.
    const updated = await this.returnRepo.update(returnId, {
      refundFailureReason: reason,
      refundLastAttemptAt: new Date(),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'REFUND_PROCESSING',
      'REFUND_PROCESSING',
      actorType,
      actorId,
      `Refund attempt failed: ${reason}`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.refund.failed',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          reason,
          attemptNumber: (ret.refundAttempts ?? 0) + 1,
        },
      });
    } catch {
      // events are best-effort
    }

    return updated;
  }

  /**
   * Retry the refund gateway call for a return currently in REFUND_PROCESSING.
   * Enforces a maximum retry count. Attempt is recorded regardless of outcome.
   */
  async retryRefund(returnId: string, actorType: string, actorId: string) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REFUND_PROCESSING') {
      throw new BadRequestAppException(
        `Return must be REFUND_PROCESSING to retry refund (current: ${ret.status})`,
      );
    }

    if ((ret.refundAttempts ?? 0) >= REFUND_MAX_RETRY_ATTEMPTS) {
      throw new BadRequestAppException(
        `Maximum retry attempts (${REFUND_MAX_RETRY_ATTEMPTS}) exceeded for this refund`,
      );
    }

    const masterOrder = ret.masterOrder;
    if (!masterOrder) {
      throw new BadRequestAppException(
        'Master order not loaded for this return',
      );
    }

    // Try gateway again
    const gatewayResult = await this.refundGateway.processRefund({
      orderId: masterOrder.id,
      orderNumber: masterOrder.orderNumber,
      paymentMethod: masterOrder.paymentMethod,
      amount: Number(ret.refundAmount),
      customerId: ret.customerId,
      returnId: ret.id,
      returnNumber: ret.returnNumber,
    });

    await this.returnRepo.recordRefundAttempt(returnId, {
      gatewayRefundId: gatewayResult.gatewayRefundId,
      success: gatewayResult.success,
      failureReason: gatewayResult.failureReason,
    });

    // Audit row for this retry attempt
    await this.prisma.refundTransaction.create({
      data: {
        returnId,
        attemptNumber: (ret.refundAttempts ?? 0) + 1,
        amount: Number(ret.refundAmount),
        gatewayRefundId: gatewayResult.gatewayRefundId ?? null,
        status: gatewayResult.success ? 'INITIATED' : 'FAILED',
        failureReason: gatewayResult.failureReason ?? null,
        actorType,
        actorId,
      },
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'REFUND_PROCESSING',
      'REFUND_PROCESSING',
      actorType,
      actorId,
      `Refund retry attempt ${(ret.refundAttempts ?? 0) + 1}: ${
        gatewayResult.success
          ? 'succeeded'
          : gatewayResult.failureReason || 'failed'
      }`,
    );

    this.logger.log(
      `Refund retry for return ${ret.returnNumber}: ${
        gatewayResult.success ? 'succeeded' : 'failed'
      }`,
    );

    return this.returnRepo.findByIdWithItems(returnId);
  }

  /**
   * Close a return — moves it to COMPLETED. Allowed from REFUNDED or
   * QC_REJECTED (in cases where there is nothing to refund).
   */
  async closeReturn(returnId: string, actorType: string, actorId: string) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    const closeableStatuses = ['REFUNDED', 'QC_REJECTED'];
    if (!closeableStatuses.includes(ret.status)) {
      throw new BadRequestAppException(
        `Return cannot be closed from status ${ret.status}. Must be REFUNDED or QC_REJECTED.`,
      );
    }

    const updated = await this.returnRepo.update(returnId, {
      status: 'COMPLETED',
      closedAt: new Date(),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      ret.status,
      'COMPLETED',
      actorType,
      actorId,
      'Return closed',
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.closed',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: { returnId, returnNumber: ret.returnNumber },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Return ${ret.returnNumber} closed by ${actorType} ${actorId}`,
    );
    return updated;
  }

  // ── Analytics (Phase R6) ───────────────────────────────────────────────

  async getAnalytics(fromDate?: Date, toDate?: Date) {
    return this.returnRepo.getAnalyticsSummary({ fromDate, toDate });
  }

  async getReturnsTrend(
    fromDate: Date,
    toDate: Date,
    groupBy: 'day' | 'week' | 'month',
  ) {
    return this.returnRepo.getReturnsByPeriod({ fromDate, toDate, groupBy });
  }

  async getTopReturnReasons(limit: number, fromDate?: Date, toDate?: Date) {
    return this.returnRepo.getTopReturnReasons(limit, fromDate, toDate);
  }

  async getCustomerReturnHistory(customerId: string) {
    return this.returnRepo.getReturnsByCustomer(customerId);
  }
}
