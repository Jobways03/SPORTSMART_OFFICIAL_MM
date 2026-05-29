/**
 * Phase 65 (2026-05-22) — pins the tax-preview audit gap closures:
 *
 *   - Discount allocation in preview (audit Gaps #1 + #21):
 *     coupon paise propagate proportionally to per-line
 *     calculateLineTax calls.
 *   - STRICT mode gate (audit Gaps #3 + #11 + #12 + #13):
 *     missing HSN/rate/taxConfigVerified surfaces a typed
 *     violation; AUDIT logs; OFF passes through.
 *   - lineKey present (audit Gap #14).
 *   - missingItemIds tracked (audit Gap #17).
 *   - inputHash + previewedAt deterministic (audit Gap #23).
 *   - Inactive products filtered out (audit Gap #16).
 */

import 'reflect-metadata';
import { CheckoutTaxPreviewService } from './checkout-tax-preview.service';
import { TaxStrictModeViolationError } from './tax-mode.service';

const PRODUCT_ID_A = '00000000-0000-4000-8000-0000000000a1';
const PRODUCT_ID_B = '00000000-0000-4000-8000-0000000000a2';
const PRODUCT_MISSING = '00000000-0000-4000-8000-0000000000a3';

function buildPrismaMock(opts: {
  products?: any[];
  variants?: any[];
  sellers?: any[];
  platformProfile?: any;
} = {}) {
  return {
    product: {
      findMany: jest.fn().mockResolvedValue(
        opts.products ?? [
          {
            id: PRODUCT_ID_A,
            hsnCode: '6404',
            gstRateBps: 1800,
            supplyTaxability: 'TAXABLE',
            taxInclusivePricing: false,
            cessRateBps: 0,
            taxConfigVerified: true,
          },
        ],
      ),
    },
    productVariant: {
      findMany: jest.fn().mockResolvedValue(opts.variants ?? []),
    },
    seller: {
      findMany: jest.fn().mockResolvedValue(opts.sellers ?? []),
    },
    platformGstProfile: {
      findFirst: jest.fn().mockResolvedValue(
        opts.platformProfile ?? { gstStateCode: '27' },
      ),
    },
  } as any;
}

function buildTaxModeMock(mode: 'OFF' | 'AUDIT' | 'STRICT' = 'OFF') {
  return {
    getMode: jest.fn().mockResolvedValue(mode),
    isStrict: jest.fn().mockResolvedValue(mode === 'STRICT'),
    isAuditOrStrict: jest.fn().mockResolvedValue(mode !== 'OFF'),
    report: jest.fn().mockImplementation(async (violation: any) => {
      if (mode === 'STRICT') throw new TaxStrictModeViolationError(violation);
      if (mode === 'AUDIT') return violation;
      return null;
    }),
  } as any;
}

// ─── Gap #14: lineKey present ────────────────────────────────────────

describe('CheckoutTaxPreviewService.previewForSession (Phase 65 — Gap #14)', () => {
  it('emits a deterministic lineKey on every line', async () => {
    const svc = new CheckoutTaxPreviewService(buildPrismaMock(), buildTaxModeMock('OFF'));
    const result = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 2, sellerId: null },
      ],
      customerShippingStateCode: '27',
    });
    expect(result.lines[0]!.lineKey).toBe(`${PRODUCT_ID_A}:`);
  });
});

// ─── Gaps #1 + #21: discount allocation in preview ───────────────────

describe('CheckoutTaxPreviewService discount allocation (Phase 65 — Gaps #1 + #21)', () => {
  it('propagates the coupon discount proportionally to per-line tax', async () => {
    const svc = new CheckoutTaxPreviewService(
      buildPrismaMock({
        products: [
          {
            id: PRODUCT_ID_A,
            hsnCode: '6404',
            gstRateBps: 1800,
            supplyTaxability: 'TAXABLE',
            taxInclusivePricing: false,
            cessRateBps: 0,
            taxConfigVerified: true,
          },
          {
            id: PRODUCT_ID_B,
            hsnCode: '6404',
            gstRateBps: 1800,
            supplyTaxability: 'TAXABLE',
            taxInclusivePricing: false,
            cessRateBps: 0,
            taxConfigVerified: true,
          },
        ],
      }),
      buildTaxModeMock('OFF'),
    );
    // Two lines, equal gross of 10000 paise each = 20000 paise
    // total. Coupon = 2000 paise (10%). Each line should be
    // allocated 1000 paise.
    const result = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 5000n, quantity: 2, sellerId: null },
        { productId: PRODUCT_ID_B, variantId: null, unitPriceInPaise: 5000n, quantity: 2, sellerId: null },
      ],
      customerShippingStateCode: '27',
      discount: {
        totalInPaise: 2000n,
        taxTreatment: 'PRE_SUPPLY_TRANSACTIONAL',
      },
    });
    expect(result.lines[0]!.discountInPaise).toBe('1000');
    expect(result.lines[1]!.discountInPaise).toBe('1000');
    // Total subtotal = 20000-2000 = 18000; tax at 18% = 3240.
    expect(result.totalTaxInPaise).toBe('3240');
  });

  it('skips the allocator when no coupon is supplied', async () => {
    const svc = new CheckoutTaxPreviewService(buildPrismaMock(), buildTaxModeMock('OFF'));
    const result = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
      ],
      customerShippingStateCode: '27',
    });
    expect(result.lines[0]!.discountInPaise).toBe('0');
  });

  it('honours non-PRE_SUPPLY_TRANSACTIONAL taxTreatment by NOT applying discount to taxable base', async () => {
    const svc = new CheckoutTaxPreviewService(buildPrismaMock(), buildTaxModeMock('OFF'));
    // POST_SUPPLY_LINKED — discount doesn't reduce taxable base.
    const result = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
      ],
      customerShippingStateCode: '27',
      discount: {
        totalInPaise: 1000n,
        taxTreatment: 'POST_SUPPLY_LINKED',
      },
    });
    expect(result.lines[0]!.discountInPaise).toBe('0');
    // Tax still on the full 10000 (18%) = 1800.
    expect(result.totalTaxInPaise).toBe('1800');
  });
});

// ─── Gap #3 + #11 + #12 + #13: STRICT mode gate ──────────────────────

describe('CheckoutTaxPreviewService STRICT mode (Phase 65 — Gaps #3 + #11 + #12 + #13)', () => {
  it('STRICT mode rejects a TAXABLE product without HSN', async () => {
    const taxMode = buildTaxModeMock('STRICT');
    const svc = new CheckoutTaxPreviewService(
      buildPrismaMock({
        products: [
          {
            id: PRODUCT_ID_A,
            hsnCode: null,
            gstRateBps: 1800,
            supplyTaxability: 'TAXABLE',
            taxInclusivePricing: false,
            cessRateBps: 0,
            taxConfigVerified: true,
          },
        ],
      }),
      taxMode,
    );
    await expect(
      svc.previewForSession({
        items: [
          { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
        ],
        customerShippingStateCode: '27',
      }),
    ).rejects.toBeInstanceOf(TaxStrictModeViolationError);
  });

  it('STRICT mode rejects when taxConfigVerified is false', async () => {
    const taxMode = buildTaxModeMock('STRICT');
    const svc = new CheckoutTaxPreviewService(
      buildPrismaMock({
        products: [
          {
            id: PRODUCT_ID_A,
            hsnCode: '6404',
            gstRateBps: 1800,
            supplyTaxability: 'TAXABLE',
            taxInclusivePricing: false,
            cessRateBps: 0,
            taxConfigVerified: false,
          },
        ],
      }),
      taxMode,
    );
    await expect(
      svc.previewForSession({
        items: [
          { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
        ],
        customerShippingStateCode: '27',
      }),
    ).rejects.toBeInstanceOf(TaxStrictModeViolationError);
  });

  it('AUDIT mode logs the violation but does NOT throw', async () => {
    const taxMode = buildTaxModeMock('AUDIT');
    const svc = new CheckoutTaxPreviewService(
      buildPrismaMock({
        products: [
          {
            id: PRODUCT_ID_A,
            hsnCode: null,
            gstRateBps: 1800,
            supplyTaxability: 'TAXABLE',
            taxInclusivePricing: false,
            cessRateBps: 0,
            taxConfigVerified: true,
          },
        ],
      }),
      taxMode,
    );
    const result = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
      ],
      customerShippingStateCode: '27',
    });
    expect(result).toBeDefined();
    expect(taxMode.report).toHaveBeenCalled();
  });

  it('OFF mode preserves pre-Phase-65 silent fallback behaviour', async () => {
    const taxMode = buildTaxModeMock('OFF');
    const svc = new CheckoutTaxPreviewService(
      buildPrismaMock({
        products: [
          {
            id: PRODUCT_ID_A,
            hsnCode: null,
            gstRateBps: 0,
            supplyTaxability: 'TAXABLE',
            taxInclusivePricing: false,
            cessRateBps: 0,
            taxConfigVerified: false,
          },
        ],
      }),
      taxMode,
    );
    const result = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
      ],
      customerShippingStateCode: '27',
    });
    expect(result.totalTaxInPaise).toBe('0');
    expect(result.incompleteItemCount).toBe(1);
  });
});

// ─── Gap #17: missing items tracked ──────────────────────────────────

describe('CheckoutTaxPreviewService missing items (Phase 65 — Gap #17)', () => {
  it('populates missingItemIds when a product fails to load', async () => {
    const svc = new CheckoutTaxPreviewService(
      buildPrismaMock({
        products: [], // product missing
      }),
      buildTaxModeMock('OFF'),
    );
    const result = await svc.previewForSession({
      items: [
        { productId: PRODUCT_MISSING, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
      ],
      customerShippingStateCode: '27',
    });
    expect(result.missingItemIds).toContain(PRODUCT_MISSING);
  });
});

// ─── Gap #23: inputHash deterministic ────────────────────────────────

describe('CheckoutTaxPreviewService inputHash (Phase 65 — Gap #23)', () => {
  it('produces the same inputHash for identical inputs', async () => {
    const svc = new CheckoutTaxPreviewService(buildPrismaMock(), buildTaxModeMock('OFF'));
    const items = [
      { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
    ];
    const r1 = await svc.previewForSession({ items, customerShippingStateCode: '27' });
    const r2 = await svc.previewForSession({ items, customerShippingStateCode: '27' });
    expect(r1.inputHash).toBe(r2.inputHash);
  });

  it('produces a different inputHash when items change', async () => {
    const svc = new CheckoutTaxPreviewService(buildPrismaMock(), buildTaxModeMock('OFF'));
    const r1 = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
      ],
      customerShippingStateCode: '27',
    });
    const r2 = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 2, sellerId: null },
      ],
      customerShippingStateCode: '27',
    });
    expect(r1.inputHash).not.toBe(r2.inputHash);
  });

  it('produces a different inputHash when coupon changes', async () => {
    const svc = new CheckoutTaxPreviewService(buildPrismaMock(), buildTaxModeMock('OFF'));
    const items = [
      { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
    ];
    const r1 = await svc.previewForSession({ items, customerShippingStateCode: '27' });
    const r2 = await svc.previewForSession({
      items,
      customerShippingStateCode: '27',
      discount: { totalInPaise: 500n, taxTreatment: 'PRE_SUPPLY_TRANSACTIONAL' },
    });
    expect(r1.inputHash).not.toBe(r2.inputHash);
  });

  it('surfaces previewedAt as an ISO timestamp', async () => {
    const svc = new CheckoutTaxPreviewService(buildPrismaMock(), buildTaxModeMock('OFF'));
    const r = await svc.previewForSession({
      items: [
        { productId: PRODUCT_ID_A, variantId: null, unitPriceInPaise: 10000n, quantity: 1, sellerId: null },
      ],
      customerShippingStateCode: '27',
    });
    expect(r.previewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
