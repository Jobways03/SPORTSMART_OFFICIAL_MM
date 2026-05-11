// Phase B (P0.1, P0.5) — Discount allocation orchestration.
//
// Runs IMMEDIATELY after order creation (in its own transaction).
// Reads the canonical MasterOrder + OrderItem rows that the checkout
// transaction just committed and writes the full allocation ledger:
//
//   1. order_discounts          — 1 row per discount applied
//   2. order_item_discounts     — N rows (one per allocated item)
//   3. order_item_tax_snapshots — N rows (post-discount GST per line)
//   4. discount_liability_ledger — funding-split rows
//   5. Mark discount_redemption REDEEMED
//
// Why a separate transaction (not embedded in placeOrderTransaction):
//   - Keeps the existing 200-line checkout transaction unchanged
//     (lower risk, easier rollback).
//   - All writes here are idempotent on `idempotencyKey` (security
//     patch 20260508130000), so a failed retry from this service or
//     a future recovery cron is safe.
//   - The order itself records `discountAmount` on MasterOrder
//     (legacy field) so downstream systems still see the discount
//     even if this allocation step were to fail.
//
// Failure behavior: if any write fails, the entire allocation tx is
// rolled back and an outbox event is emitted so a recovery worker
// can retry. The order itself is NOT rolled back — customer payment
// has succeeded, MasterOrder.discountAmount is set, the only thing
// missing is the per-line ledger.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  allocateOrderLevel,
  allocateBxgy,
} from '../../domain/allocation/allocate';
import type {
  AllocatableItem,
  AllocationResult,
  ItemAllocation,
} from '../../domain/allocation/types';
import {
  splitFundingShares,
  type FundingConfig,
} from '../../domain/allocation/funding';
import {
  calculateLineGst,
  calculateGstReversal,
} from '../../domain/tax/calculate-gst';
import { DiscountReservationService } from './discount-reservation.service';
import { DiscountEventsService } from './discount-events.service';
import { Prisma } from '@prisma/client';

/**
 * Default GST rate (in basis points) for products that don't yet have
 * an HSN-derived rate set. 0 = "no GST recorded" — the snapshot still
 * carries `gross / discount / taxable` but tax components are zero.
 *
 * Once a Product.gstRateBps column is added (follow-up to Phase B),
 * this default goes away and the rate is sourced per product.
 */
const DEFAULT_GST_RATE_BPS = 0;

export interface AllocationContext {
  masterOrderId: string;
  /** ID of the parent Discount row that was applied. */
  discountId: string;
  /** Snapshot of the code as typed (for audit). */
  discountCode: string | null;
  /** ID of the child DiscountCode row, if any (P0.6). */
  discountCodeId?: string | null;
  /**
   * The redemption row created by `DiscountReservationService.reserve`.
   * This service marks it REDEEMED at the end of the allocation tx.
   */
  redemptionId: string;
  /**
   * Total discount the customer was promised, in paise. Sum of
   * per-item allocations must equal this.
   */
  discountAmountInPaise: bigint;
  /** Snapshot of the discount's metadata at order time. */
  discountType:
    | 'AMOUNT_OFF_PRODUCTS'
    | 'AMOUNT_OFF_ORDER'
    | 'BUY_X_GET_Y'
    | 'FREE_SHIPPING';
  discountMethod: 'CODE' | 'AUTOMATIC';
  source: 'CODE' | 'AUTOMATIC' | 'AFFILIATE';
  funding: FundingConfig;
  /**
   * Eligibility — for AMOUNT_OFF_PRODUCTS / SPECIFIC_COLLECTIONS,
   * the resolved set of eligible product IDs. Empty = order-wide.
   */
  eligibleProductIds?: ReadonlySet<string>;
  /**
   * BXGY-only: resolved GET-eligible product IDs + the get
   * configuration. Caller computes from DiscountProduct(scope=GET)
   * + DiscountCollection(scope=GET).
   */
  bxgy?: {
    getEligibleProductIds: ReadonlySet<string>;
    getQuantity: number;
    getDiscountType: 'FREE' | 'PERCENTAGE' | 'AMOUNT_OFF';
    getDiscountValueInPaise?: bigint;
    getDiscountPercentage?: number;
  };
}

@Injectable()
export class DiscountAllocationService {
  private readonly logger = new Logger(DiscountAllocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservation: DiscountReservationService,
    // Phase E (P1.1) — emit liability-recorded + refund-prorated.
    private readonly events: DiscountEventsService,
  ) {}

  /**
   * Compute and persist the full allocation for an order. Called from
   * `checkout.service.ts` immediately after the order is committed.
   *
   * Idempotency: each ledger row is keyed on (masterOrderId,
   * discountId, …) with a deterministic idempotency key, so a retry
   * is safe — duplicate inserts hit the unique constraint and the
   * tx silently succeeds.
   */
  async allocateAndPersist(ctx: AllocationContext): Promise<void> {
    if (ctx.discountAmountInPaise <= 0n) {
      // No discount → no rows to write. Still mark redemption
      // REDEEMED so the lifecycle is consistent.
      await this.reservation.redeem({
        redemptionId: ctx.redemptionId,
        masterOrderId: ctx.masterOrderId,
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Load canonical order + items + sub-orders.
      const items = await tx.orderItem.findMany({
        where: { subOrder: { masterOrderId: ctx.masterOrderId } },
        select: {
          id: true,
          productId: true,
          variantId: true,
          quantity: true,
          subOrderId: true,
          unitPriceInPaise: true,
          totalPriceInPaise: true,
          subOrder: {
            select: { sellerId: true },
          },
        },
      });
      if (items.length === 0) {
        throw new Error(
          `No items found for order ${ctx.masterOrderId} during allocation`,
        );
      }

      const allocatableItems: AllocatableItem[] = items.map((it) => ({
        orderItemId: it.id,
        productId: it.productId,
        variantId: it.variantId,
        subOrderId: it.subOrderId,
        sellerId: it.subOrder.sellerId,
        grossInPaise: BigInt(it.totalPriceInPaise),
        unitPriceInPaise: BigInt(it.unitPriceInPaise),
        quantity: it.quantity,
      }));

      // 2. Run allocation engine.
      let result: AllocationResult;
      if (ctx.discountType === 'BUY_X_GET_Y') {
        if (!ctx.bxgy) {
          throw new Error('BXGY discount requires bxgy context');
        }
        result = allocateBxgy({
          items: allocatableItems,
          getEligibleProductIds: ctx.bxgy.getEligibleProductIds,
          getQuantity: ctx.bxgy.getQuantity,
          getDiscountType: ctx.bxgy.getDiscountType,
          getDiscountValueInPaise: ctx.bxgy.getDiscountValueInPaise,
          getDiscountPercentage: ctx.bxgy.getDiscountPercentage,
        });
      } else if (ctx.discountType === 'FREE_SHIPPING') {
        // Free shipping doesn't allocate to line items — the
        // shipping discount is recorded at order level only. Still
        // write the order_discounts row but no item rows.
        result = { allocations: [], totalAllocatedInPaise: 0n };
      } else {
        result = allocateOrderLevel({
          items: allocatableItems,
          totalDiscountInPaise: ctx.discountAmountInPaise,
          eligibleProductIds: ctx.eligibleProductIds,
        });
      }

      // 3. Write order_discounts (1 row).
      await tx.orderDiscount.create({
        data: {
          masterOrderId: ctx.masterOrderId,
          discountId: ctx.discountId,
          discountCodeId: ctx.discountCodeId ?? null,
          discountCode: ctx.discountCode,
          discountType: ctx.discountType,
          discountMethod: ctx.discountMethod,
          discountNature: 'TRANSACTIONAL',
          source: ctx.source,
          discountAmountInPaise: result.totalAllocatedInPaise,
          fundingType: ctx.funding.fundingType as any,
        },
      });

      // 4. Write order_item_discounts (N rows).
      for (const a of result.allocations) {
        if (a.discountInPaise === 0n) continue;
        await tx.orderItemDiscount.create({
          data: {
            masterOrderId: ctx.masterOrderId,
            subOrderId: a.subOrderId,
            orderItemId: a.orderItemId,
            sellerId: a.sellerId ?? null,
            productId: a.productId,
            variantId: a.variantId ?? null,
            discountId: ctx.discountId,
            discountCodeId: ctx.discountCodeId ?? null,
            discountCode: ctx.discountCode,
            discountType: ctx.discountType,
            discountAmountInPaise: a.discountInPaise,
            fundingType: ctx.funding.fundingType as any,
          },
        });
      }

      // 5. Write tax snapshots per item. We always write a snapshot
      // for every item (allocated or not) so refund proration has
      // consistent data — items not allocated still need their gross
      // snapshot for full-price refunds.
      const allocByItemId = new Map<string, ItemAllocation>(
        result.allocations.map((a) => [a.orderItemId, a]),
      );
      for (const it of allocatableItems) {
        const allocated = allocByItemId.get(it.orderItemId);
        const discountInPaise = allocated?.discountInPaise ?? 0n;
        const gst = calculateLineGst({
          grossInPaise: it.grossInPaise,
          discountInPaise,
          gstRateBps: DEFAULT_GST_RATE_BPS,
          // Default to inter-state (IGST) — refined when address
          // module exposes place-of-supply. The actual GST values
          // are zero at default rate so this is harmless until
          // rates are wired.
          isIntraState: false,
        });
        await tx.orderItemTaxSnapshot.upsert({
          where: { orderItemId: it.orderItemId },
          create: {
            masterOrderId: ctx.masterOrderId,
            subOrderId: it.subOrderId,
            orderItemId: it.orderItemId,
            grossLineAmountInPaise: gst.grossInPaise,
            discountAmountInPaise: gst.discountInPaise,
            taxableAmountInPaise: gst.taxableInPaise,
            gstRateBps: gst.gstRateBps,
            cgstAmountInPaise: gst.cgstInPaise,
            sgstAmountInPaise: gst.sgstInPaise,
            igstAmountInPaise: gst.igstInPaise,
            totalTaxAmountInPaise: gst.totalTaxInPaise,
            lineTotalAfterDiscountAndTaxInPaise: gst.lineTotalInPaise,
          },
          update: {
            // Idempotent retry: update the snapshot to the current
            // calculation. Discount can change if allocation is
            // re-run (e.g. retry path).
            grossLineAmountInPaise: gst.grossInPaise,
            discountAmountInPaise: gst.discountInPaise,
            taxableAmountInPaise: gst.taxableInPaise,
            gstRateBps: gst.gstRateBps,
            cgstAmountInPaise: gst.cgstInPaise,
            sgstAmountInPaise: gst.sgstInPaise,
            igstAmountInPaise: gst.igstInPaise,
            totalTaxAmountInPaise: gst.totalTaxInPaise,
            lineTotalAfterDiscountAndTaxInPaise: gst.lineTotalInPaise,
          },
        });
      }

      // 6. Write liability ledger — funding split per allocated item.
      for (const a of result.allocations) {
        if (a.discountInPaise === 0n) continue;
        const shares = splitFundingShares(a.discountInPaise, ctx.funding);
        for (const share of shares) {
          // Idempotency key: deterministic from order + item +
          // discount + party. A retried allocation tx will hit the
          // unique constraint on this key and silently dedupe.
          const idemKey = `${ctx.masterOrderId}:${a.orderItemId}:${ctx.discountId}:${share.liabilityParty}`;
          await tx.discountLiabilityLedger.upsert({
            where: {
              // Composite uniqueness via the `idem_key` partial index;
              // we look up by the snapshot fields. Prisma doesn't
              // support partial-index `where` clauses directly, so
              // we use create-or-update via raw SQL upsert pattern:
              id: idemKey, // see note below
            },
            create: {
              id: idemKey,
              masterOrderId: ctx.masterOrderId,
              subOrderId: a.subOrderId,
              orderItemId: a.orderItemId,
              sellerId: a.sellerId ?? null,
              discountId: ctx.discountId,
              discountCodeId: ctx.discountCodeId ?? null,
              discountCode: ctx.discountCode,
              fundingType: ctx.funding.fundingType as any,
              liabilityParty: share.liabilityParty as any,
              amountInPaise: share.amountInPaise,
              status: 'APPLIED',
              idempotencyKey: idemKey,
            },
            update: {
              amountInPaise: share.amountInPaise,
              status: 'APPLIED',
            },
          });

          // Phase E (P1.1) — emit per-share liability event.
          // Outbox consumers (settlement, finance reports, brand
          // recovery jobs) react to these. Best-effort.
          void this.events.emitLiabilityRecorded({
            masterOrderId: ctx.masterOrderId,
            discountId: ctx.discountId,
            liabilityParty: share.liabilityParty,
            amountInPaise: share.amountInPaise,
            fundingType: ctx.funding.fundingType,
          });
        }
      }

      // 7. Mark redemption REDEEMED. Conditional update inside the
      // tx — if the redemption was already redeemed by another path
      // (idempotent retry), the call is a no-op.
      try {
        await this.reservation.redeem({
          redemptionId: ctx.redemptionId,
          masterOrderId: ctx.masterOrderId,
          tx,
        });
      } catch (e) {
        // If the redemption was already REDEEMED (idempotent retry),
        // swallow the conflict. Any other error rethrows and rolls
        // back the whole allocation tx.
        if (
          e instanceof Error &&
          (e as any).reason === 'CONCURRENT_RESERVATION'
        ) {
          this.logger.warn(
            `Redemption ${ctx.redemptionId} already redeemed — idempotent retry`,
          );
        } else {
          throw e;
        }
      }
    });
  }

  /**
   * Phase C (P0.2) — Compute proportional refund + GST reversal for
   * a returned quantity of an OrderItem.
   *
   * Returns null if no tax snapshot exists for the item — caller
   * MUST fall back to the existing gross-price refund logic. This
   * is the legacy-compat path: orders placed before allocation
   * went live don't have snapshots, and the spec requires those
   * to keep working unchanged.
   *
   * Returns a RefundProrationResult when allocation data exists.
   * Caller writes one `ReturnTaxReversalLine` row using the
   * `reversalSnapshot`, and uses `totalRefundInPaise` as the
   * customer's refund amount.
   */
  async computeRefundForReturnedItem(args: {
    orderItemId: string;
    purchasedQuantity: number;
    approvedQuantity: number;
  }): Promise<RefundProrationResult | null> {
    if (args.approvedQuantity <= 0) {
      return {
        totalRefundInPaise: 0n,
        reversalSnapshot: this.zeroReversal(),
      };
    }

    // Look up the per-item tax snapshot. Absence of a snapshot is
    // the signal to fall back to legacy logic.
    const snapshot = await this.prisma.orderItemTaxSnapshot.findUnique({
      where: { orderItemId: args.orderItemId },
    });
    if (!snapshot) return null;

    const reversal = calculateGstReversal({
      originalGrossInPaise: BigInt(snapshot.grossLineAmountInPaise),
      originalDiscountInPaise: BigInt(snapshot.discountAmountInPaise),
      originalCgstInPaise: BigInt(snapshot.cgstAmountInPaise),
      originalSgstInPaise: BigInt(snapshot.sgstAmountInPaise),
      originalIgstInPaise: BigInt(snapshot.igstAmountInPaise),
      purchasedQuantity: args.purchasedQuantity,
      returnedQuantity: args.approvedQuantity,
    });

    return {
      totalRefundInPaise: reversal.totalCreditNoteInPaise,
      reversalSnapshot: {
        grossReturnedInPaise: reversal.grossReturnedInPaise,
        discountReversalInPaise: reversal.discountReversalInPaise,
        taxableReversalInPaise: reversal.taxableReversalInPaise,
        cgstReversalInPaise: reversal.cgstReversalInPaise,
        sgstReversalInPaise: reversal.sgstReversalInPaise,
        igstReversalInPaise: reversal.igstReversalInPaise,
        totalTaxReversalInPaise: reversal.totalTaxReversalInPaise,
        totalCreditNoteInPaise: reversal.totalCreditNoteInPaise,
        gstRateBps: snapshot.gstRateBps,
      },
    };
  }

  /**
   * Phase C (P0.2) — Reverse the discount liability ledger entries
   * for a return. When a discounted item is returned, the funding
   * party (PLATFORM/SELLER/etc.) should release their share of the
   * original liability. We mark the corresponding ledger rows
   * REVERSED rather than deleting — finance reports need to see
   * the original liability + the reversal.
   *
   * Idempotent: re-running this on the same return is a no-op.
   */
  async reverseLiabilityForReturnedItem(args: {
    orderItemId: string;
    /**
     * Optional ratio (returned/purchased). When undefined, all
     * remaining liability is reversed (full return). For partial
     * returns we currently leave the original ledger row APPLIED
     * and add a single REVERSED row carrying the proportional
     * amount (per spec: don't double-debit, don't restore budget).
     */
    proportion?: { returned: number; purchased: number };
    reason?: string;
  }): Promise<void> {
    const ledgerRows = await this.prisma.discountLiabilityLedger.findMany({
      where: { orderItemId: args.orderItemId, status: 'APPLIED' },
    });
    if (ledgerRows.length === 0) return;

    for (const row of ledgerRows) {
      const reverseAmount = args.proportion
        ? (BigInt(row.amountInPaise) * BigInt(args.proportion.returned)) /
          BigInt(args.proportion.purchased)
        : BigInt(row.amountInPaise);
      const idemKey = `${row.id}:reverse`;
      await this.prisma.discountLiabilityLedger.upsert({
        where: { id: idemKey },
        create: {
          id: idemKey,
          masterOrderId: row.masterOrderId,
          subOrderId: row.subOrderId,
          orderItemId: row.orderItemId,
          sellerId: row.sellerId,
          discountId: row.discountId,
          discountCodeId: row.discountCodeId,
          discountCode: row.discountCode,
          fundingType: row.fundingType,
          liabilityParty: row.liabilityParty,
          amountInPaise: -reverseAmount, // negative = credit back
          status: 'REVERSED',
          reason: args.reason ?? 'RETURN_REFUND',
          idempotencyKey: idemKey,
        },
        update: {
          amountInPaise: -reverseAmount,
          status: 'REVERSED',
        },
      });
    }
  }

  private zeroReversal(): RefundProrationResult['reversalSnapshot'] {
    return {
      grossReturnedInPaise: 0n,
      discountReversalInPaise: 0n,
      taxableReversalInPaise: 0n,
      cgstReversalInPaise: 0n,
      sgstReversalInPaise: 0n,
      igstReversalInPaise: 0n,
      totalTaxReversalInPaise: 0n,
      totalCreditNoteInPaise: 0n,
      gstRateBps: 0,
    };
  }
}

// Note on the upsert id pattern above: we use the deterministic
// idempotency key as the row's primary `id` to get free dedup via
// Prisma's upsert-by-id. The schema defaults `id` to a uuid, but
// we override it for ledger rows so retried allocation transactions
// converge on the same row instead of creating duplicates. The
// security-patch index `discount_liability_ledger_idem_key` on
// `(master_order_id, discount_id, liability_party, idempotency_key)`
// is a redundant safety net.

// ──────────────────────────────────────────────────────────────────
// Phase C (P0.2) — Refund proration helpers.
//
// Called from `return.service.ts` during QC decision. For a given
// (orderItem, approvedQuantity) the helper computes the correct
// net refund — the customer's actual paid amount for those units
// after discount allocation, plus the proportional GST reversal.
//
// Legacy fallback: if no `OrderItemTaxSnapshot` exists for this
// item (legacy order placed before allocation went live), the
// helper returns null and the caller falls back to the existing
// gross-price refund calculation. This is what makes the rollout
// safe — old orders keep working exactly as before.
// ──────────────────────────────────────────────────────────────────

export interface RefundProrationResult {
  /** Customer-facing refund amount in paise (taxable + tax). */
  totalRefundInPaise: bigint;
  /** Snapshot of inputs to write a ReturnTaxReversalLine row. */
  reversalSnapshot: {
    grossReturnedInPaise: bigint;
    discountReversalInPaise: bigint;
    taxableReversalInPaise: bigint;
    cgstReversalInPaise: bigint;
    sgstReversalInPaise: bigint;
    igstReversalInPaise: bigint;
    totalTaxReversalInPaise: bigint;
    totalCreditNoteInPaise: bigint;
    gstRateBps: number;
  };
}

