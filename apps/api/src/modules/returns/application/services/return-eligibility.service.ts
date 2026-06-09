import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import type { ReturnReasonCategory } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { CaseDuplicateService } from '../../../../core/case-duplicate/case-duplicate.service';
import {
  RETURN_REPOSITORY,
  ReturnRepository,
} from '../../domain/repositories/return.repository.interface';
import {
  resolveReturnPolicy,
  type ResolvedReturnPolicy,
} from '../../domain/return-policy-resolver';
// Phase 92 follow-up (2026-05-23) — Gap #16 facade refactor.
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';

export type IneligibleReason =
  | 'WINDOW_EXPIRED'
  | 'ALREADY_RETURNED'
  | 'PREVIOUSLY_REJECTED'
  | 'PRODUCT_NON_RETURNABLE'
  | 'CATEGORY_NON_RETURNABLE'
  | 'ITEM_KIND_NON_RETURNABLE'
  | 'ACCOUNT_REVIEW'
  | 'ORDER_CANCELLED'
  | 'WINDOW_TIMESTAMP_MISSING';

export interface EligibleItem {
  orderItemId: string;
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  // Phase 92 — Gap #16 BigInt-safe serialisation. Pre-Phase-92 the
  // Decimal → Number cast lost precision on high-value items.
  unitPriceInPaise: string;
  alreadyReturnedQty: number;
  availableForReturn: number;
  // Phase 92 — Gap #12 partial-quantity policy.
  allowPartialReturn: boolean;
  eligible: boolean;
  // True if this item was part of a return that was REJECTED (pre-pickup
  // or at QC). Under the forfeit policy the customer cannot try again.
  previouslyRejected?: boolean;
  ineligibleReason?: IneligibleReason;
  ineligibleReasonDetail?: string;
  // Phase 92 — Gap #3 / #19 server-driven reason list.
  validReasonCategories: ReturnReasonCategory[];
  requiresEvidenceFor: ReturnReasonCategory[];
  policySource: 'PRODUCT' | 'CATEGORY' | 'GLOBAL' | 'ITEM_KIND';
  windowDays: number;
}

export interface EligibleSubOrder {
  subOrderId: string;
  orderNumber: string;
  deliveredAt: Date | null;
  returnWindowEndsAt: Date | null;
  windowExpired: boolean;
  // Phase 92 — Gap #18 days-remaining countdown computed server-side.
  daysRemaining: number | null;
  items: EligibleItem[];
}

export interface OrderEligibilityResult {
  eligible: boolean;
  reason?: string;
  // Phase 92 — Gap #10 customer risk band exposed for transparency.
  customerRiskBand?: 'GREEN' | 'YELLOW' | 'RED';
  eligibleSubOrders: EligibleSubOrder[];
}

export interface ValidatedReturnRequest {
  subOrder: any;
  masterOrder: any;
  validatedItems: Array<{
    orderItemId: string;
    quantity: number;
    orderItem: any;
  }>;
}

@Injectable()
export class ReturnEligibilityService {
  // Phase 92 — Gap #15 rejected-cooldown window. Default 90 days
  // after which a previously-rejected return no longer permanently
  // blocks the customer from filing again on the same item from a
  // fresh purchase. Env-tunable so ops can shorten/lengthen.
  private readonly rejectedCooldownDays: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RETURN_REPOSITORY)
    private readonly returnRepo: ReturnRepository,
    private readonly caseDuplicates: CaseDuplicateService,
    // Phase 92 — Gap #4 global return window resolver (env-driven).
    @Optional() private readonly env?: EnvService,
    // Phase 92 follow-up (2026-05-23) — Gap #16 facade refactor.
    // @Optional + forwardRef so legacy specs that inject this service
    // without DI still construct; falls back to direct Prisma access
    // when undefined.
    @Optional()
    @Inject(forwardRef(() => OrdersPublicFacade))
    private readonly ordersFacade?: OrdersPublicFacade,
  ) {
    this.rejectedCooldownDays = this.env?.getNumber(
      'RETURN_REJECTED_COOLDOWN_DAYS' as any,
      90,
    ) ?? 90;
  }

  private get globalWindowDays(): number {
    return this.env?.getNumber('RETURN_WINDOW_DAYS' as any, 14) ?? 14;
  }

  async checkOrderEligibility(
    masterOrderId: string,
    customerId: string,
    auditContext?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<OrderEligibilityResult> {
    // Phase 92 follow-up (2026-05-23) — Gap #16 facade refactor.
    // Pre-Phase-92 this was a direct prisma.masterOrder.findFirst with
    // a TODO to route through OrdersPublicFacade. Phase 92's master-
    // status filter (Gap #6) lands in the facade so this service no
    // longer reaches across module boundaries.
    const masterOrder: any = this.ordersFacade
      ? await this.ordersFacade.getMasterOrderWithDeliveredSubOrders(
          masterOrderId,
          customerId,
          // OrderStatus has NO `REFUNDED` member — the dead terminals are
          // CANCELLED and REJECTED. Passing 'REFUNDED' made Prisma reject the
          // enum filter (`Invalid value for argument notIn. Expected
          // OrderStatus`), which 500-ed EVERY return-eligibility check.
          { excludeMasterStatuses: ['CANCELLED', 'REJECTED'] },
        )
      : await this.prisma.masterOrder.findFirst({
          where: {
            id: masterOrderId,
            customerId,
            orderStatus: { notIn: ['CANCELLED', 'REJECTED'] } as any,
          },
          include: {
            subOrders: {
              where: { fulfillmentStatus: 'DELIVERED' },
              include: { items: true },
            },
          },
        });
    // Phase 92 — Gap #1/#2. Side-load product policy (OrderItem has
    // no direct `product` relation in the schema). One round-trip
    // batch keyed on the distinct productIds in the order.
    const productPolicies = await this.loadProductPolicies(masterOrder);

    if (!masterOrder) {
      return {
        eligible: false,
        reason: 'Order not found',
        eligibleSubOrders: [],
      };
    }
    if (masterOrder.subOrders.length === 0) {
      return {
        eligible: false,
        reason: 'No delivered items in this order',
        eligibleSubOrders: [],
      };
    }

    const now = new Date();
    const globalWindowDays = this.globalWindowDays;
    const eligibleSubOrders: EligibleSubOrder[] = [];

    for (const subOrder of masterOrder.subOrders) {
      // Phase 92 — Gap #7 null-window guard. Pre-Phase-92 returnWindowEndsAt=null
      // silently treated items as eligible forever; data-corruption /
      // migration drift would let DELIVERED-without-window sub-orders
      // pass the gate indefinitely. Now we either derive from
      // deliveredAt+globalWindow or fail closed.
      let windowEnd = subOrder.returnWindowEndsAt;
      if (!windowEnd && subOrder.deliveredAt) {
        windowEnd = new Date(
          subOrder.deliveredAt.getTime() +
            globalWindowDays * 24 * 60 * 60 * 1000,
        );
      }
      const windowExpired = windowEnd ? now > windowEnd : true;
      const daysRemaining = windowEnd
        ? Math.max(
            0,
            Math.ceil((windowEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
          )
        : null;

      const orderItemIds = subOrder.items.map((i: any) => i.id);

      // Phase 92 — Gap #5 batched returned-quantity lookup. Pre-Phase-92
      // this was N+1: one aggregate per item. Single groupBy for the
      // whole sub-order is O(1) regardless of cart size.
      const returnedByItem = await this.batchReturnedQuantities(orderItemIds);
      // Phase 92 — Gap #15 cooldown-aware previously-rejected lookup.
      const rejectedRows = await this.prisma.returnItem.findMany({
        where: {
          orderItemId: { in: orderItemIds },
          return: {
            status: { in: ['REJECTED', 'QC_REJECTED'] },
            createdAt: {
              gte: new Date(
                Date.now() - this.rejectedCooldownDays * 24 * 60 * 60 * 1000,
              ),
            },
          },
        },
        select: { orderItemId: true },
      });
      const rejectedItemIds = new Set(rejectedRows.map((r) => r.orderItemId));

      const items: EligibleItem[] = subOrder.items.map((item: any) => {
        const policy = resolveReturnPolicy({
          itemKind: (item as any).itemKind,
          isReturnableSnapshot: (item as any).isReturnableSnapshot,
          returnWindowDaysSnapshot: (item as any).returnWindowDaysSnapshot,
          allowedReturnReasonsJsonSnapshot: (item as any)
            .allowedReturnReasonsJsonSnapshot,
          allowPartialReturnSnapshot: (item as any)
            .allowPartialReturnSnapshot,
          nonReturnableReasonSnapshot: (item as any)
            .nonReturnableReasonSnapshot,
          productIsReturnable: productPolicies.get(item.productId)?.isReturnable,
          productNonReturnableReason: productPolicies.get(item.productId)?.nonReturnableReason,
          productReturnWindowDaysOverride:
            productPolicies.get(item.productId)?.returnWindowDaysOverride,
          productAllowedReturnReasonsJson:
            productPolicies.get(item.productId)?.allowedReturnReasonsJson,
          productAllowPartialReturn:
            productPolicies.get(item.productId)?.allowPartialReturn,
          categoryIsReturnable: productPolicies.get(item.productId)?.category?.isReturnable,
          categoryDefaultReturnWindowDays:
            productPolicies.get(item.productId)?.category?.defaultReturnWindowDays,
          categoryDefaultAllowedReasonsJson:
            productPolicies.get(item.productId)?.category?.defaultAllowedReasonsJson,
          globalWindowDays,
        });

        const alreadyReturnedQty = returnedByItem.get(item.id) ?? 0;
        const availableForReturn = policy.allowPartialReturn
          ? item.quantity - alreadyReturnedQty
          : alreadyReturnedQty === 0
            ? item.quantity
            : 0;
        const previouslyRejected = rejectedItemIds.has(item.id);

        let ineligibleReason: IneligibleReason | undefined;
        let ineligibleReasonDetail: string | undefined;
        if (!policy.isReturnable) {
          ineligibleReason =
            policy.source === 'CATEGORY'
              ? 'CATEGORY_NON_RETURNABLE'
              : policy.source === 'ITEM_KIND'
                ? 'ITEM_KIND_NON_RETURNABLE'
                : 'PRODUCT_NON_RETURNABLE';
          ineligibleReasonDetail = policy.nonReturnableReason ?? undefined;
        } else if (windowExpired) {
          ineligibleReason = subOrder.returnWindowEndsAt
            ? 'WINDOW_EXPIRED'
            : 'WINDOW_TIMESTAMP_MISSING';
        } else if (previouslyRejected) {
          ineligibleReason = 'PREVIOUSLY_REJECTED';
        } else if (availableForReturn <= 0) {
          ineligibleReason = 'ALREADY_RETURNED';
        }

        return {
          orderItemId: item.id,
          productTitle: item.productTitle,
          variantTitle: item.variantTitle,
          sku: item.sku,
          imageUrl: item.imageUrl,
          quantity: item.quantity,
          // Phase 92 — Gap #16 BigInt-safe unit price.
          unitPriceInPaise: (item.unitPriceInPaise ?? 0n).toString(),
          alreadyReturnedQty,
          availableForReturn,
          allowPartialReturn: policy.allowPartialReturn,
          previouslyRejected,
          ineligibleReason,
          ineligibleReasonDetail,
          validReasonCategories: policy.allowedReasons,
          requiresEvidenceFor: policy.requiresEvidenceFor,
          policySource: policy.source,
          windowDays: policy.windowDays,
          eligible:
            policy.isReturnable &&
            !windowExpired &&
            !previouslyRejected &&
            availableForReturn > 0,
        };
      });

      eligibleSubOrders.push({
        subOrderId: subOrder.id,
        // Phase 92 — Gap #17 prefer sub-order number when present.
        orderNumber:
          (subOrder as any).subOrderNumber ?? masterOrder.orderNumber,
        deliveredAt: subOrder.deliveredAt,
        returnWindowEndsAt: windowEnd,
        windowExpired,
        daysRemaining,
        items,
      });
    }

    const hasEligibleItem = eligibleSubOrders.some((so) =>
      so.items.some((i) => i.eligible),
    );
    const reason = hasEligibleItem
      ? undefined
      : 'No eligible items for return (window expired, already returned, or item not returnable)';

    // Phase 92 follow-up (2026-05-23) — Gap #21 audit log. Best-effort;
    // never blocks the eligibility response on the customer's path.
    const itemCount = eligibleSubOrders.reduce(
      (acc, so) => acc + so.items.length,
      0,
    );
    const eligibleCount = eligibleSubOrders.reduce(
      (acc, so) => acc + so.items.filter((i) => i.eligible).length,
      0,
    );
    void this.writeEligibilityAudit({
      masterOrderId,
      customerId,
      ipAddress: auditContext?.ipAddress ?? null,
      userAgent: auditContext?.userAgent ?? null,
      resultEligible: hasEligibleItem,
      resultReason: reason ?? null,
      itemCount,
      eligibleCount,
    }).catch(() => undefined);

    return {
      eligible: hasEligibleItem,
      reason,
      eligibleSubOrders,
    };
  }

  /**
   * Phase 92 follow-up (2026-05-23) — Gap #21 chain of custody.
   */
  private async writeEligibilityAudit(args: {
    masterOrderId: string;
    customerId: string;
    ipAddress: string | null;
    userAgent: string | null;
    resultEligible: boolean;
    resultReason: string | null;
    itemCount: number;
    eligibleCount: number;
  }): Promise<void> {
    await (this.prisma as any).returnEligibilityAudit.create({
      data: args,
    });
  }

  /**
   * Phase 92 (2026-05-23) — Gap #1/#2 product + category policy
   * side-load. OrderItem has no `product` relation in the schema, so
   * we batch-fetch distinct products in a single query and key by id.
   */
  private async loadProductPolicies(
    masterOrder: any,
  ): Promise<
    Map<
      string,
      {
        isReturnable: boolean;
        nonReturnableReason: string | null;
        returnWindowDaysOverride: number | null;
        allowedReturnReasonsJson: unknown;
        allowPartialReturn: boolean;
        category: {
          isReturnable: boolean;
          defaultReturnWindowDays: number | null;
          defaultAllowedReasonsJson: unknown;
        } | null;
      }
    >
  > {
    const result = new Map();
    if (!masterOrder?.subOrders) return result;
    const productIds = new Set<string>();
    for (const so of masterOrder.subOrders) {
      for (const it of so.items) productIds.add(it.productId);
    }
    if (productIds.size === 0) return result;
    const products = await (this.prisma as any).product.findMany({
      where: { id: { in: Array.from(productIds) } },
      select: {
        id: true,
        isReturnable: true,
        nonReturnableReason: true,
        returnWindowDaysOverride: true,
        allowedReturnReasonsJson: true,
        allowPartialReturn: true,
        category: {
          select: {
            isReturnable: true,
            defaultReturnWindowDays: true,
            defaultAllowedReasonsJson: true,
          },
        },
      },
    });
    for (const p of products as any[]) {
      result.set(p.id, {
        isReturnable: p.isReturnable,
        nonReturnableReason: p.nonReturnableReason,
        returnWindowDaysOverride: p.returnWindowDaysOverride,
        allowedReturnReasonsJson: p.allowedReturnReasonsJson,
        allowPartialReturn: p.allowPartialReturn,
        category: p.category ?? null,
      });
    }
    return result;
  }

  /**
   * Phase 92 (2026-05-23) — Gap #5 batched returned-quantity lookup.
   * Single groupBy replaces the N+1 per-item aggregate.
   */
  private async batchReturnedQuantities(
    orderItemIds: string[],
  ): Promise<Map<string, number>> {
    if (orderItemIds.length === 0) return new Map();
    const rows = await this.prisma.returnItem.groupBy({
      by: ['orderItemId'],
      where: {
        orderItemId: { in: orderItemIds },
        return: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
      },
      _sum: { quantity: true },
    });
    const out = new Map<string, number>();
    for (const r of rows) {
      out.set(r.orderItemId, r._sum.quantity ?? 0);
    }
    return out;
  }

  async validateReturnRequest(input: {
    customerId: string;
    subOrderId: string;
    items: Array<{ orderItemId: string; quantity: number; reasonCategory?: string }>;
  }): Promise<ValidatedReturnRequest> {
    // Phase 92 (2026-05-23) — Gap #4 TOCTOU lock. SELECT FOR UPDATE
    // serialises concurrent submits so two parallel POSTs requesting
    // the same availableForReturn quantity cannot both succeed. The
    // outer caller (return.service.createReturn) is expected to wrap
    // its insert in the same transaction; this helper runs the lock
    // inline so the validate-and-insert sequence is atomic when
    // called as part of a tx, and self-contained when called standalone.
    await this.prisma.$queryRaw`SELECT id FROM sub_orders WHERE id = ${input.subOrderId} FOR UPDATE`;

    const subOrder: any = await this.prisma.subOrder.findFirst({
      where: { id: input.subOrderId },
      include: { masterOrder: true, items: true },
    });
    // Phase 92 — Gap #1/#2 side-load product policy.
    const productIds = new Set<string>(
      ((subOrder?.items ?? []) as any[]).map((i) => i.productId),
    );
    const productPolicies = productIds.size
      ? await (this.prisma as any).product.findMany({
          where: { id: { in: Array.from(productIds) } },
          select: {
            id: true,
            isReturnable: true,
            nonReturnableReason: true,
            returnWindowDaysOverride: true,
            allowedReturnReasonsJson: true,
            allowPartialReturn: true,
            category: {
              select: {
                isReturnable: true,
                defaultReturnWindowDays: true,
                defaultAllowedReasonsJson: true,
              },
            },
          },
        })
      : [];
    const policyByProduct = new Map<string, any>(
      (productPolicies as any[]).map((p) => [p.id, p]),
    );

    if (!subOrder) {
      throw new NotFoundAppException('Sub-order not found');
    }
    if (subOrder.masterOrder.customerId !== input.customerId) {
      throw new ForbiddenAppException('You do not own this order');
    }
    if (subOrder.fulfillmentStatus !== 'DELIVERED') {
      throw new BadRequestAppException('Can only return delivered orders');
    }
    // Phase 92 — Gap #6 master-order status guard.
    const masterStatus = (subOrder.masterOrder as any).orderStatus;
    // 'REFUNDED' is not an OrderStatus value (no-op compare); the real dead
    // terminals are CANCELLED and REJECTED.
    if (masterStatus === 'CANCELLED' || masterStatus === 'REJECTED') {
      throw new BadRequestAppException(
        'Master order is no longer eligible for returns.',
      );
    }

    // Check return window — Gap #7 null-window defaults to expired.
    const now = new Date();
    let windowEnd = subOrder.returnWindowEndsAt;
    if (!windowEnd && subOrder.deliveredAt) {
      windowEnd = new Date(
        subOrder.deliveredAt.getTime() +
          this.globalWindowDays * 24 * 60 * 60 * 1000,
      );
    }
    if (!windowEnd) {
      throw new BadRequestAppException(
        'Return window information is missing for this order. Contact support.',
      );
    }
    if (now > windowEnd) {
      throw new BadRequestAppException('Return window has expired');
    }

    // Validate each item
    const validatedItems: ValidatedReturnRequest['validatedItems'] = [];
    for (const requestedItem of input.items) {
      const orderItem = subOrder.items.find(
        (i: any) => i.id === requestedItem.orderItemId,
      );
      if (!orderItem) {
        throw new BadRequestAppException(
          `Order item ${requestedItem.orderItemId} not found in sub-order`,
        );
      }
      if (requestedItem.quantity < 1) {
        throw new BadRequestAppException('Return quantity must be at least 1');
      }

      // Phase 92 (2026-05-23) — Gap #1/#2/#9 policy resolver + reason
      // enforcement. Refuse the submit if the product/category is
      // non-returnable OR if reasonCategory is outside the allowed set.
      const policy = resolveReturnPolicy({
        itemKind: (orderItem as any).itemKind,
        isReturnableSnapshot: (orderItem as any).isReturnableSnapshot,
        returnWindowDaysSnapshot: (orderItem as any).returnWindowDaysSnapshot,
        allowedReturnReasonsJsonSnapshot: (orderItem as any)
          .allowedReturnReasonsJsonSnapshot,
        allowPartialReturnSnapshot: (orderItem as any)
          .allowPartialReturnSnapshot,
        nonReturnableReasonSnapshot: (orderItem as any)
          .nonReturnableReasonSnapshot,
        productIsReturnable: policyByProduct.get(orderItem.productId)?.isReturnable,
        productNonReturnableReason: policyByProduct.get(orderItem.productId)?.nonReturnableReason,
        productReturnWindowDaysOverride: policyByProduct.get(orderItem.productId)?.returnWindowDaysOverride,
        productAllowedReturnReasonsJson: policyByProduct.get(orderItem.productId)?.allowedReturnReasonsJson,
        productAllowPartialReturn: policyByProduct.get(orderItem.productId)?.allowPartialReturn,
        categoryIsReturnable: policyByProduct.get(orderItem.productId)?.category?.isReturnable,
        categoryDefaultReturnWindowDays: policyByProduct.get(orderItem.productId)?.category?.defaultReturnWindowDays,
        categoryDefaultAllowedReasonsJson: policyByProduct.get(orderItem.productId)?.category?.defaultAllowedReasonsJson,
        globalWindowDays: this.globalWindowDays,
      });
      if (!policy.isReturnable) {
        throw new BadRequestAppException(
          `${orderItem.productTitle} is not eligible for return: ${
            policy.nonReturnableReason ?? 'product policy'
          }`,
        );
      }
      if (
        requestedItem.reasonCategory &&
        !policy.allowedReasons.includes(
          requestedItem.reasonCategory as ReturnReasonCategory,
        )
      ) {
        throw new BadRequestAppException(
          `Reason "${requestedItem.reasonCategory}" is not allowed for ${orderItem.productTitle}. Allowed: ${policy.allowedReasons.join(', ')}`,
        );
      }

      const alreadyReturnedQty =
        await this.returnRepo.getReturnedQuantityForOrderItem(orderItem.id);
      const availableForReturn = policy.allowPartialReturn
        ? orderItem.quantity - alreadyReturnedQty
        : alreadyReturnedQty === 0
          ? orderItem.quantity
          : 0;
      if (requestedItem.quantity > availableForReturn) {
        throw new BadRequestAppException(
          `Cannot return ${requestedItem.quantity} of ${orderItem.productTitle}. Only ${availableForReturn} available for return.`,
        );
      }
      // Phase 92 — Gap #12 enforce all-or-nothing.
      if (!policy.allowPartialReturn && requestedItem.quantity !== orderItem.quantity) {
        throw new BadRequestAppException(
          `${orderItem.productTitle} does not allow partial returns. Return the full quantity (${orderItem.quantity}).`,
        );
      }

      // Phase 92 — Gap #15 cooldown-aware forfeit lookup. Pre-Phase-92
      // the forfeit was permanent; now a rejection older than the
      // cooldown window no longer blocks fresh submissions on a
      // fresh purchase of the same SKU.
      const cooldownCutoff = new Date(
        Date.now() - this.rejectedCooldownDays * 24 * 60 * 60 * 1000,
      );
      const hasRejectedReturn = await this.prisma.returnItem.findFirst({
        where: {
          orderItemId: orderItem.id,
          return: {
            status: { in: ['REJECTED', 'QC_REJECTED'] },
            createdAt: { gte: cooldownCutoff },
          },
        },
        select: { id: true },
      });
      if (hasRejectedReturn) {
        throw new BadRequestAppException(
          `A previous return for ${orderItem.productTitle} was rejected within the last ${this.rejectedCooldownDays} days. Under the forfeit policy you accepted, re-submission is not allowed for this item.`,
        );
      }
      validatedItems.push({
        orderItemId: requestedItem.orderItemId,
        quantity: requestedItem.quantity,
        orderItem,
      });
    }

    // Phase 1.5 — duplicate prevention. Runs AFTER item validation so
    // ineligibility errors take precedence over duplicate errors (a
    // customer trying to return an out-of-window item shouldn't get
    // "you already opened a return" first). No-op when the
    // CASE_DUPLICATE_PREVENTION_ENABLED flag is off.
    for (const v of validatedItems) {
      await this.caseDuplicates.assertNoActiveReturnForOrderItem({
        orderItemId: v.orderItemId,
        actor: { type: 'CUSTOMER', id: input.customerId },
      });
    }

    return {
      subOrder,
      masterOrder: subOrder.masterOrder,
      validatedItems,
    };
  }
}
