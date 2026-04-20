/**
 * Tests for the server-side price validation rule used inside
 * `placeOrderTransaction`. The actual rule is inlined into the repository
 * but it's the same one-liner everywhere — pinning the spec here documents
 * the contract:
 *
 *   reject if abs(suppliedPrice - canonicalPrice) > PRICE_TOLERANCE
 *
 * The tolerance is ₹0.01, which is the smallest unit of `Decimal(10,2)`.
 *
 * The fallback chain for canonical price is also documented here:
 *   variant: variant.platformPrice ?? variant.price ?? 0
 *   product: product.platformPrice ?? product.basePrice ?? 0
 */

const PRICE_TOLERANCE = 0.01;

function shouldRejectPrice(
  suppliedPrice: number,
  canonicalPrice: number,
): boolean {
  return Math.abs(suppliedPrice - canonicalPrice) > PRICE_TOLERANCE;
}

function resolveCanonicalPrice(args: {
  product: { platformPrice: number | null; basePrice: number | null };
  variant?: { platformPrice: number | null; price: number | null } | null;
}): number {
  if (args.variant) {
    return Number(
      args.variant.platformPrice ?? args.variant.price ?? 0,
    );
  }
  return Number(args.product.platformPrice ?? args.product.basePrice ?? 0);
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
      // Realistic scenario: cart shows ₹1499.99, server has ₹1499.99
      expect(shouldRejectPrice(1499.99, 1499.99)).toBe(false);
      // Cart shows ₹1499.99, server has ₹1500.00 (₹0.01 drift — accepted)
      expect(shouldRejectPrice(1499.99, 1500.0)).toBe(false);
      // Cart shows ₹1499.99, server has ₹1501.00 (₹1.01 drift — rejected)
      expect(shouldRejectPrice(1499.99, 1501.0)).toBe(true);
    });
  });

  describe('resolveCanonicalPrice', () => {
    it('returns variant.platformPrice when set', () => {
      const result = resolveCanonicalPrice({
        product: { platformPrice: 999, basePrice: 800 },
        variant: { platformPrice: 1099, price: 1000 },
      });
      expect(result).toBe(1099);
    });

    it('falls back to variant.price when variant.platformPrice is null', () => {
      const result = resolveCanonicalPrice({
        product: { platformPrice: 999, basePrice: 800 },
        variant: { platformPrice: null, price: 1050 },
      });
      expect(result).toBe(1050);
    });

    it('uses product.platformPrice when no variant', () => {
      const result = resolveCanonicalPrice({
        product: { platformPrice: 999, basePrice: 800 },
        variant: null,
      });
      expect(result).toBe(999);
    });

    it('falls back to product.basePrice when product.platformPrice is null', () => {
      const result = resolveCanonicalPrice({
        product: { platformPrice: null, basePrice: 800 },
        variant: null,
      });
      expect(result).toBe(800);
    });

    it('returns 0 when nothing is set (edge case)', () => {
      const result = resolveCanonicalPrice({
        product: { platformPrice: null, basePrice: null },
        variant: null,
      });
      expect(result).toBe(0);
    });

    it('ignores product price when a variant is present (variant is authoritative)', () => {
      const result = resolveCanonicalPrice({
        product: { platformPrice: 999, basePrice: 800 },
        variant: { platformPrice: null, price: 0 },
      });
      // When the variant exists, its price wins even if zero — bug or feature?
      // The current code does this; pinning it here so changes are intentional.
      expect(result).toBe(0);
    });
  });
});
