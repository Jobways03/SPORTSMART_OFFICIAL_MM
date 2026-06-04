// Phase B (P0.1) — Pure allocation functions.
//
// Splits an order-level discount across line items so that:
//   1. Sum of allocations equals the input total (conservation).
//   2. No item is allocated more discount than its gross (cap rule).
//   3. Allocation is proportional to gross value of eligible items.
//   4. Paise rounding remainder is assigned deterministically — to
//      the item with the highest gross, with `orderItemId` lex-sort
//      as the tie-breaker. Same input always produces same output.
//
// Why pure functions: the math has to be auditable and testable
// without spinning up Prisma. The checkout transaction calls these,
// uses the result to write `order_item_discounts` rows, and then
// passes the same allocation to the GST snapshot calculator.

import type {
  AllocatableItem,
  AllocationResult,
  BxgyDiscountInput,
  ItemAllocation,
  OrderLevelDiscountInput,
} from './types';

/**
 * Order-level proportional allocation. Used for both PERCENTAGE and
 * FIXED order-level discounts — the caller has already converted the
 * percentage into a paise total before calling.
 *
 * Algorithm:
 *   1. Filter to eligible items (or use all items).
 *   2. Compute each item's raw share = floor(gross × total / totalGross).
 *   3. The floors leave a remainder = total - sum(raw shares).
 *   4. Distribute the remainder, 1 paise per item, in priority order
 *      (highest gross first; ties broken by orderItemId asc).
 */
export function allocateOrderLevel(
  input: OrderLevelDiscountInput,
): AllocationResult {
  const total = input.totalDiscountInPaise;
  if (total < 0n) {
    throw new Error('totalDiscountInPaise cannot be negative');
  }
  if (total === 0n) {
    return { allocations: [], totalAllocatedInPaise: 0n };
  }

  const eligible = input.eligibleProductIds
    ? input.items.filter((it) => input.eligibleProductIds!.has(it.productId))
    : [...input.items];

  if (eligible.length === 0) {
    throw new Error(
      'No eligible items for order-level discount allocation; ' +
        'caller must validate before calling',
    );
  }

  const totalGross = eligible.reduce(
    (acc, it) => acc + it.grossInPaise,
    0n,
  );
  if (totalGross <= 0n) {
    throw new Error('Eligible items have zero gross — cannot allocate');
  }

  // Cap rule: total discount cannot exceed total gross. Caller is
  // responsible for the cap upstream (e.g. checkout caps cart total
  // at zero), but we double-check here so a buggy upstream can never
  // produce a negative net line.
  const cappedTotal = total > totalGross ? totalGross : total;

  // Phase 1 — proportional floors.
  const allocations: ItemAllocation[] = eligible.map((it) => ({
    orderItemId: it.orderItemId,
    productId: it.productId,
    variantId: it.variantId ?? null,
    subOrderId: it.subOrderId,
    sellerId: it.sellerId ?? null,
    franchiseId: it.franchiseId ?? null,
    discountInPaise: (it.grossInPaise * cappedTotal) / totalGross,
  }));

  // Phase 2 — distribute the rounding remainder.
  let assigned = allocations.reduce((acc, a) => acc + a.discountInPaise, 0n);
  let remainder = cappedTotal - assigned;

  if (remainder > 0n) {
    // Sort eligible items by gross desc, ties by orderItemId asc.
    // This ordering is independent of input order, so the algorithm
    // is deterministic regardless of how the caller orders items.
    const ranked = eligible
      .map((it, idx) => ({ idx, gross: it.grossInPaise, id: it.orderItemId }))
      .sort((a, b) => {
        if (a.gross > b.gross) return -1;
        if (a.gross < b.gross) return 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

    let cursor = 0;
    while (remainder > 0n) {
      const target = ranked[cursor % ranked.length]!;

      // Cap rule: an allocation cannot exceed item gross.
      const item = eligible[target.idx]!;

      const current = allocations[target.idx]!.discountInPaise;
      if (current < item.grossInPaise) {
        allocations[target.idx] = {
          ...allocations[target.idx]!,
          discountInPaise: current + 1n,
        };
        remainder -= 1n;
      }
      cursor += 1;
      // Safety: if every item is capped at its gross we'd loop forever.
      // This can only happen if cappedTotal > totalGross, which we
      // prevented above. Break defensively.
      if (cursor > ranked.length * 2 && remainder > 0n) {
        throw new Error(
          'Cannot distribute rounding remainder — all items at cap',
        );
      }
    }
  }

  assigned = allocations.reduce((acc, a) => acc + a.discountInPaise, 0n);
  // Conservation invariant — must hold by construction. Throw if not
  // (defensive — would only fire on a math bug above).
  if (assigned !== cappedTotal) {
    throw new Error(
      `Allocation conservation violated: sum=${assigned} expected=${cappedTotal}`,
    );
  }

  return {
    allocations,
    totalAllocatedInPaise: assigned,
  };
}

/**
 * BXGY allocation. The discount attaches only to GET items, never
 * randomly across the cart — this is what lets the customer's "free"
 * item refund correctly when returned (refund = ₹0).
 *
 * Algorithm:
 *   1. From `getEligibleProductIds`, expand items to per-unit slots
 *      (an item with quantity 3 contributes 3 slots).
 *   2. Sort slots cheapest first (existing fairness behavior).
 *   3. Take the first `getQuantity` slots — these are the GET units.
 *   4. Compute the per-unit discount based on getDiscountType.
 *   5. Roll up to per-item allocations.
 */
export function allocateBxgy(input: BxgyDiscountInput): AllocationResult {
  if (input.getQuantity < 0 || !Number.isInteger(input.getQuantity)) {
    throw new Error('getQuantity must be a non-negative integer');
  }
  if (input.getQuantity === 0) {
    return { allocations: [], totalAllocatedInPaise: 0n };
  }

  // Per-unit slots: one entry per individual item unit (quantity 3 →
  // 3 entries). This is what lets us select fewer units than the
  // line carries.
  type Slot = {
    item: AllocatableItem;
    unitPriceInPaise: bigint;
  };

  const slots: Slot[] = [];
  for (const item of input.items) {
    if (!input.getEligibleProductIds.has(item.productId)) continue;
    for (let q = 0; q < item.quantity; q += 1) {
      slots.push({ item, unitPriceInPaise: item.unitPriceInPaise });
    }
  }

  if (slots.length === 0) {
    throw new Error(
      'No eligible GET items in cart for BXGY discount; ' +
        'caller must validate the buy/get conditions before allocating',
    );
  }

  // Cheapest-first fairness — preserves existing behavior. Tie-break
  // on item id so allocation is deterministic for a fixed cart.
  slots.sort((a, b) => {
    if (a.unitPriceInPaise < b.unitPriceInPaise) return -1;
    if (a.unitPriceInPaise > b.unitPriceInPaise) return 1;
    if (a.item.orderItemId < b.item.orderItemId) return -1;
    if (a.item.orderItemId > b.item.orderItemId) return 1;
    return 0;
  });

  const taken = slots.slice(0, Math.min(input.getQuantity, slots.length));

  // Roll up per-item — multiple slots can come from the same item.
  const perItem = new Map<string, { item: AllocatableItem; discount: bigint }>();

  for (const slot of taken) {
    const unitDiscount = computeBxgyUnitDiscount(slot.unitPriceInPaise, input);
    const existing = perItem.get(slot.item.orderItemId);
    if (existing) {
      existing.discount += unitDiscount;
    } else {
      perItem.set(slot.item.orderItemId, {
        item: slot.item,
        discount: unitDiscount,
      });
    }
  }

  const allocations: ItemAllocation[] = [];
  let total = 0n;
  for (const { item, discount } of perItem.values()) {
    // Cap defensively at line gross (could happen if someone sets a
    // bogus AMOUNT_OFF > unit price * quantity).
    const lineGross = item.grossInPaise;
    const capped = discount > lineGross ? lineGross : discount;
    allocations.push({
      orderItemId: item.orderItemId,
      productId: item.productId,
      variantId: item.variantId ?? null,
      subOrderId: item.subOrderId,
      sellerId: item.sellerId ?? null,
      franchiseId: item.franchiseId ?? null,
      discountInPaise: capped,
    });
    total += capped;
  }

  return { allocations, totalAllocatedInPaise: total };
}

function computeBxgyUnitDiscount(
  unitPriceInPaise: bigint,
  input: BxgyDiscountInput,
): bigint {
  switch (input.getDiscountType) {
    case 'FREE':
      return unitPriceInPaise;
    case 'PERCENTAGE': {
      const pct = input.getDiscountPercentage ?? 0;
      if (pct < 0 || pct > 100) {
        throw new Error('getDiscountPercentage must be between 0 and 100');
      }
      // BigInt math: floor(unit × pct × 100 / 10_000) keeps paise
      // precision for non-round percentages (e.g. 33%).
      const bps = BigInt(Math.round(pct * 100));
      const raw = (unitPriceInPaise * bps) / 10_000n;
      return raw > unitPriceInPaise ? unitPriceInPaise : raw;
    }
    case 'AMOUNT_OFF': {
      const amt = input.getDiscountValueInPaise ?? 0n;
      if (amt < 0n) {
        throw new Error('getDiscountValueInPaise cannot be negative');
      }
      return amt > unitPriceInPaise ? unitPriceInPaise : amt;
    }
    default:
      throw new Error(`Unknown getDiscountType: ${input.getDiscountType}`);
  }
}

/**
 * Convenience: turn a percentage + total order subtotal into a paise
 * total ready to feed into `allocateOrderLevel`. Caller is expected
 * to use server-canonical totals — never the client-submitted
 * subtotal — for the input.
 */
export function percentageToPaiseTotal(
  totalGrossInPaise: bigint,
  percent: number,
): bigint {
  if (percent < 0 || percent > 100) {
    throw new Error('percent must be between 0 and 100');
  }
  if (totalGrossInPaise < 0n) {
    throw new Error('totalGrossInPaise cannot be negative');
  }
  const bps = BigInt(Math.round(percent * 100));
  return (totalGrossInPaise * bps) / 10_000n;
}
