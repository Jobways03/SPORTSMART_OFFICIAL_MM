// Phase E (P1.1) — Discount lifecycle events.
//
// One small service that owns the standard discount event names +
// payloads so the lifecycle services (CRUD / reservation /
// allocation) don't repeat audit/outbox boilerplate.
//
// Two sinks:
//   - AuditLog (compliance + ops debug, hash-chained tamper detection)
//   - Outbox event (transactional outbox; downstream consumers like
//     analytics / external webhook delivery)
//
// Both are best-effort: a failure to write either should NEVER block
// the underlying business operation. Reservation, allocation, and
// settlement correctness are owned by their respective DB writes;
// audit/outbox are observability layers on top.

import { Injectable, Logger } from '@nestjs/common';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

/** All discount lifecycle event names — single source of truth. */
export const DiscountEventName = {
  // CRUD
  Created: 'discount.created',
  Updated: 'discount.updated',
  Deleted: 'discount.deleted',
  Activated: 'discount.activated',
  Disabled: 'discount.disabled',
  // Redemption lifecycle
  RedemptionReserved: 'discount.redemption.reserved',
  Redeemed: 'discount.redemption.redeemed',
  RedemptionReleased: 'discount.redemption.released',
  MaxUsageReached: 'discount.max_usage_reached',
  // Allocation / financial
  LiabilityRecorded: 'discount.liability.recorded',
  RefundProrated: 'discount.refund.prorated',
  TaxCalculated: 'discount.tax.calculated',
  CreditNoteProrated: 'discount.credit_note.prorated',
} as const;

export type DiscountEventNameValue =
  (typeof DiscountEventName)[keyof typeof DiscountEventName];

/** Common audit-context fields supplied by the caller (admin route). */
export interface AuditContext {
  actorId?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class DiscountEventsService {
  private readonly logger = new Logger(DiscountEventsService.name);

  constructor(
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Admin discount CRUD — write audit with old/new diff + outbox.
   *
   * The diff captures only the financially-relevant fields per
   * spec (code, type, value, fundingType, startsAt, endsAt,
   * maxUses, status). Caller sends the full Discount snapshot;
   * we narrow + diff here to keep payload size sensible.
   */
  async emitDiscountCrud(args: {
    action: 'created' | 'updated' | 'deleted' | 'activated' | 'disabled';
    discountId: string;
    oldValue?: Record<string, unknown> | null;
    newValue?: Record<string, unknown> | null;
    context?: AuditContext;
  }): Promise<void> {
    const eventName = `discount.${args.action}`;
    await this.write({
      eventName,
      action: eventName,
      resource: 'discount',
      resourceId: args.discountId,
      oldValue: args.oldValue ? this.narrowFinancialFields(args.oldValue) : null,
      newValue: args.newValue ? this.narrowFinancialFields(args.newValue) : null,
      aggregate: 'Discount',
      aggregateId: args.discountId,
      payload: {
        discountId: args.discountId,
        action: args.action,
        old: args.oldValue ? this.narrowFinancialFields(args.oldValue) : null,
        new: args.newValue ? this.narrowFinancialFields(args.newValue) : null,
      },
      context: args.context,
    });
  }

  /** Reservation lifecycle. */
  async emitRedemptionEvent(args: {
    action: 'reserved' | 'redeemed' | 'released';
    redemptionId: string;
    discountId: string;
    customerId: string;
    masterOrderId?: string | null;
    discountAmountInPaise: bigint;
    reason?: string;
    context?: AuditContext;
  }): Promise<void> {
    const map = {
      reserved: DiscountEventName.RedemptionReserved,
      redeemed: DiscountEventName.Redeemed,
      released: DiscountEventName.RedemptionReleased,
    } as const;
    const eventName = map[args.action];
    await this.write({
      eventName,
      action: eventName,
      resource: 'discount_redemption',
      resourceId: args.redemptionId,
      newValue: {
        action: args.action,
        discountId: args.discountId,
        customerId: args.customerId,
        masterOrderId: args.masterOrderId ?? null,
        discountAmountInPaise: args.discountAmountInPaise.toString(),
        reason: args.reason ?? null,
      },
      aggregate: 'DiscountRedemption',
      aggregateId: args.redemptionId,
      payload: {
        redemptionId: args.redemptionId,
        discountId: args.discountId,
        customerId: args.customerId,
        masterOrderId: args.masterOrderId ?? null,
        discountAmountInPaise: args.discountAmountInPaise.toString(),
        reason: args.reason ?? null,
      },
      context: args.context,
    });
  }

  /** Liability ledger entry written. */
  async emitLiabilityRecorded(args: {
    masterOrderId: string;
    discountId: string;
    liabilityParty: string;
    amountInPaise: bigint;
    fundingType: string;
  }): Promise<void> {
    await this.write({
      eventName: DiscountEventName.LiabilityRecorded,
      action: DiscountEventName.LiabilityRecorded,
      resource: 'discount_liability_ledger',
      resourceId: args.masterOrderId,
      newValue: {
        masterOrderId: args.masterOrderId,
        discountId: args.discountId,
        liabilityParty: args.liabilityParty,
        fundingType: args.fundingType,
        amountInPaise: args.amountInPaise.toString(),
      },
      aggregate: 'MasterOrder',
      aggregateId: args.masterOrderId,
      payload: {
        masterOrderId: args.masterOrderId,
        discountId: args.discountId,
        liabilityParty: args.liabilityParty,
        fundingType: args.fundingType,
        amountInPaise: args.amountInPaise.toString(),
      },
    });
  }

  /** Refund proration on QC approval. */
  async emitRefundProrated(args: {
    returnId: string;
    returnItemId: string;
    orderItemId: string;
    grossReturnedInPaise: bigint;
    discountReversalInPaise: bigint;
    totalCreditNoteInPaise: bigint;
  }): Promise<void> {
    await this.write({
      eventName: DiscountEventName.RefundProrated,
      action: DiscountEventName.RefundProrated,
      resource: 'return_tax_reversal_line',
      resourceId: args.returnItemId,
      newValue: {
        returnId: args.returnId,
        returnItemId: args.returnItemId,
        orderItemId: args.orderItemId,
        grossReturnedInPaise: args.grossReturnedInPaise.toString(),
        discountReversalInPaise: args.discountReversalInPaise.toString(),
        totalCreditNoteInPaise: args.totalCreditNoteInPaise.toString(),
      },
      aggregate: 'Return',
      aggregateId: args.returnId,
      payload: {
        returnId: args.returnId,
        returnItemId: args.returnItemId,
        orderItemId: args.orderItemId,
        grossReturnedInPaise: args.grossReturnedInPaise.toString(),
        discountReversalInPaise: args.discountReversalInPaise.toString(),
        totalCreditNoteInPaise: args.totalCreditNoteInPaise.toString(),
      },
    });
  }

  /** maxUses reached — admin alert + downstream notification hook. */
  async emitMaxUsageReached(args: {
    discountId: string;
    maxUses: number;
  }): Promise<void> {
    await this.write({
      eventName: DiscountEventName.MaxUsageReached,
      action: DiscountEventName.MaxUsageReached,
      resource: 'discount',
      resourceId: args.discountId,
      newValue: { discountId: args.discountId, maxUses: args.maxUses },
      aggregate: 'Discount',
      aggregateId: args.discountId,
      payload: { discountId: args.discountId, maxUses: args.maxUses },
    });
  }


  // ────────────────────────────────────────────────────────────
  // Internal — single sink that writes both audit + outbox
  // best-effort. Failures are logged but never thrown.
  // ────────────────────────────────────────────────────────────

  private async write(args: {
    eventName: string;
    action: string;
    resource: string;
    resourceId: string;
    oldValue?: unknown;
    newValue?: unknown;
    aggregate: string;
    aggregateId: string;
    payload: unknown;
    context?: AuditContext;
  }): Promise<void> {
    // Audit + outbox in parallel — both best-effort. If one sink is
    // down the other still records. Catch + log per-sink so a
    // partial failure doesn't dark-hole both.
    const auditPromise = this.audit
      .writeAuditLog({
        actorId: args.context?.actorId ?? undefined,
        actorRole: args.context?.actorRole ?? undefined,
        action: args.action,
        module: 'discounts',
        resource: args.resource,
        resourceId: args.resourceId,
        oldValue: args.oldValue ?? null,
        newValue: args.newValue ?? null,
        ipAddress: args.context?.ipAddress ?? undefined,
        userAgent: args.context?.userAgent ?? undefined,
      })
      .catch((e) => {
        this.logger.warn(
          `AuditLog write failed for ${args.action}: ${(e as Error).message}`,
        );
      });

    const outboxPromise = this.eventBus
      .publish({
        eventName: args.eventName,
        aggregate: args.aggregate,
        aggregateId: args.aggregateId,
        occurredAt: new Date(),
        payload: args.payload as Record<string, unknown>,
      })
      .catch((e) => {
        this.logger.warn(
          `Outbox publish failed for ${args.eventName}: ${(e as Error).message}`,
        );
      });

    await Promise.all([auditPromise, outboxPromise]);
  }

  /**
   * Narrow a Discount snapshot to the fields that matter for audit.
   * Spec lists: code, type, value, fundingType, startsAt, endsAt,
   * maxUses, budget, status. We include a few more (commissionBasis,
   * onePerCustomer) since they materially affect financial outcome.
   */
  private narrowFinancialFields(
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> {
    const fields = [
      'code',
      'title',
      'type',
      'method',
      'valueType',
      'value',
      'startsAt',
      'endsAt',
      'maxUses',
      'onePerCustomer',
      'status',
      'fundingType',
      'platformFundingPercent',
      'sellerFundingPercent',
      'brandFundingPercent',
      'commissionBasis',
      'discountNature',
      'combineProduct',
      'combineOrder',
      'combineShipping',
      // Approval/budget — present for P2 forward-compat.
      'approvalStatus',
      'totalBudgetInPaise',
      'budgetEnforcement',
    ];
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(snapshot, f)) {
        const value = snapshot[f];
        // Serialize Date → ISO so audit JSON is comparable.
        out[f] = value instanceof Date ? value.toISOString() : value;
      }
    }
    return out;
  }
}
