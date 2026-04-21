/**
 * Tests for the server-side price validation rule used inside
 * `placeOrderTransaction`. The actual rule is inlined into the
 * repository but it's the same one-liner everywhere — pinning the
 * spec here documents the contract:
 *
 *   reject if abs(suppliedPrice - canonicalPrice) > PRICE_TOLERANCE
 *
 * The tolerance is ₹0.01, which is the smallest unit of Decimal(10,2).
 *
 * After the platformPrice removal, the canonical price chain is:
 *   variant: variant.price ?? 0
 *   product: product.basePrice ?? 0
 * (The old `variant.platformPrice ?? variant.price` fallback is gone;
 * customer sees the seller's price directly.)
 */

const PRICE_TOLERANCE = 0.01;

function shouldRejectPrice(
  suppliedPrice: number,
  canonicalPrice: number,
): boolean {
  return Math.abs(suppliedPrice - canonicalPrice) > PRICE_TOLERANCE;
}

function resolveCanonicalPrice(args: {
  product: { basePrice: number | null };
  variant?: { price: number | null } | null;
}): number {
  if (args.variant) {
    return Number(args.variant.price ?? 0);
  }
  return Number(args.product.basePrice ?? 0);
}

describe('Price validation rule', () => {
  describe('shouldRejectPrice', () => {
    it('accepts an exact match', () => {
      expect(shouldRejectPrice(100.0, 100.0)).toBe(false);
    });

    it('accepts a difference within ₹0.01 tolerance (rounding)', () => {
      expect(shouldRejectPrice(100.0, 100.005)).toBe(false);
      expect(shouldRejectPrice(99.995, 100.0)).toBe(false);
    });

    it('rejects a small price hike beyond tolerance', () => {
      expect(shouldRejectPrice(100.0, 100.02)).toBe(true);
    });

    it('rejects a price drop beyond tolerance (defends against admin lowering price mid-cart)', () => {
      expect(shouldRejectPrice(100.0, 99.98)).toBe(true);
    });

    it('rejects a zero supplied price when canonical is non-zero', () => {
      expect(shouldRejectPrice(0, 100)).toBe(true);
    });

    it('rejects a spoofed huge price', () => {
      expect(shouldRejectPrice(1000000, 100)).toBe(true);
    });

    it('handles two-decimal Decimal-shaped values cleanly', () => {
      expect(shouldRejectPrice(1499.99, 1499.99)).toBe(false);
      expect(shouldRejectPrice(1499.99, 1500.0)).toBe(false);
      expect(shouldRejectPrice(1499.99, 1501.0)).toBe(true);
    });
  });

  describe('resolveCanonicalPrice', () => {
    it('returns variant.price when a variant exists', () => {
      const result = resolveCanonicalPrice({
        product: { basePrice: 800 },
        variant: { price: 1050 },
      });
      expect(result).toBe(1050);
    });

    it('uses product.basePrice when no variant', () => {
      const result = resolveCanonicalPrice({
        product: { basePrice: 800 },
        variant: null,
      });
      expect(result).toBe(800);
    });

    it('returns 0 when nothing is set (edge case)', () => {
      const result = resolveCanonicalPrice({
        product: { basePrice: null },
        variant: null,
      });
      expect(result).toBe(0);
    });

    it('ignores product price when a variant is present (variant is authoritative)', () => {
      const result = resolveCanonicalPrice({
        product: { basePrice: 800 },
        variant: { price: 0 },
      });
      // When the variant exists, its price wins even if zero — bug or
      // feature? The current code does this; pinning here so changes
      // are intentional.
      expect(result).toBe(0);
    });
  });
});
