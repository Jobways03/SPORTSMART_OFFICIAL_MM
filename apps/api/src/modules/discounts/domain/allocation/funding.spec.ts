// Phase B (P0.5) — Funding-split tests.

import {
  splitFundingShares,
  resolveItemFundingShares,
  validateFundingConfig,
  type FundingConfig,
} from './funding';

const config = (over: Partial<FundingConfig>): FundingConfig => ({
  fundingType: over.fundingType ?? 'PLATFORM',
  platformFundingPercent: over.platformFundingPercent,
  sellerFundingPercent: over.sellerFundingPercent,
  brandFundingPercent: over.brandFundingPercent,
  franchiseFundingPercent: over.franchiseFundingPercent,
});

describe('splitFundingShares', () => {
  it('PLATFORM: full amount to platform', () => {
    const shares = splitFundingShares(20_000n, config({ fundingType: 'PLATFORM' }));
    expect(shares).toEqual([
      { liabilityParty: 'PLATFORM', amountInPaise: 20_000n },
    ]);
  });

  it('SELLER: full amount to seller', () => {
    const shares = splitFundingShares(20_000n, config({ fundingType: 'SELLER' }));
    expect(shares).toEqual([
      { liabilityParty: 'SELLER', amountInPaise: 20_000n },
    ]);
  });

  it('BRAND: full amount to brand', () => {
    const shares = splitFundingShares(20_000n, config({ fundingType: 'BRAND' }));
    expect(shares).toEqual([
      { liabilityParty: 'BRAND', amountInPaise: 20_000n },
    ]);
  });

  it('SHARED 50/50 platform/seller: splits exactly', () => {
    const shares = splitFundingShares(
      20_000n,
      config({
        fundingType: 'SHARED',
        platformFundingPercent: 50,
        sellerFundingPercent: 50,
      }),
    );
    expect(shares).toContainEqual({
      liabilityParty: 'PLATFORM',
      amountInPaise: 10_000n,
    });
    expect(shares).toContainEqual({
      liabilityParty: 'SELLER',
      amountInPaise: 10_000n,
    });
  });

  it('SHARED 70/30 platform/seller', () => {
    const shares = splitFundingShares(
      10_000n,
      config({
        fundingType: 'SHARED',
        platformFundingPercent: 70,
        sellerFundingPercent: 30,
      }),
    );
    expect(shares).toContainEqual({
      liabilityParty: 'PLATFORM',
      amountInPaise: 7_000n,
    });
    expect(shares).toContainEqual({
      liabilityParty: 'SELLER',
      amountInPaise: 3_000n,
    });
  });

  it('SHARED with rounding remainder → goes to PLATFORM', () => {
    // 100 paise / 33% / 33% / 34% — let's pick numbers where floor
    // produces a remainder.
    const shares = splitFundingShares(
      100n,
      config({
        fundingType: 'SHARED',
        platformFundingPercent: 33,
        sellerFundingPercent: 33,
        brandFundingPercent: 34,
      }),
    );
    const total = shares.reduce((acc, s) => acc + s.amountInPaise, 0n);
    expect(total).toBe(100n); // conservation
    const platformShare = shares.find((s) => s.liabilityParty === 'PLATFORM');
    expect(platformShare).toBeDefined();
    // Platform gets 33 paise + remainder.
    expect(platformShare!.amountInPaise).toBeGreaterThanOrEqual(33n);
  });

  it('SHARED 100% platform/0% others: only platform row returned', () => {
    const shares = splitFundingShares(
      10_000n,
      config({
        fundingType: 'SHARED',
        platformFundingPercent: 100,
        sellerFundingPercent: 0,
        brandFundingPercent: 0,
      }),
    );
    expect(shares).toHaveLength(1);
    expect(shares[0]).toEqual({
      liabilityParty: 'PLATFORM',
      amountInPaise: 10_000n,
    });
  });

  it('NONE: returns empty (legacy/unattributed)', () => {
    const shares = splitFundingShares(10_000n, config({ fundingType: 'NONE' }));
    expect(shares).toEqual([]);
  });

  it('zero allocation returns empty regardless of fundingType', () => {
    expect(splitFundingShares(0n, config({ fundingType: 'PLATFORM' }))).toEqual(
      [],
    );
    expect(
      splitFundingShares(
        0n,
        config({
          fundingType: 'SHARED',
          platformFundingPercent: 50,
          sellerFundingPercent: 50,
        }),
      ),
    ).toEqual([]);
  });

  it('rejects negative allocation', () => {
    expect(() =>
      splitFundingShares(-1n, config({ fundingType: 'PLATFORM' })),
    ).toThrow(/negative/);
  });

  it('rejects SHARED config that does not sum to 100', () => {
    expect(() =>
      splitFundingShares(
        10_000n,
        config({
          fundingType: 'SHARED',
          platformFundingPercent: 50,
          sellerFundingPercent: 30,
        }),
      ),
    ).toThrow(/sum to 100/);
  });

  it('preserves conservation across all share types (property check)', () => {
    const cases: FundingConfig[] = [
      { fundingType: 'PLATFORM' },
      { fundingType: 'SELLER' },
      { fundingType: 'BRAND' },
      {
        fundingType: 'SHARED',
        platformFundingPercent: 33,
        sellerFundingPercent: 67,
      },
      {
        fundingType: 'SHARED',
        platformFundingPercent: 25,
        sellerFundingPercent: 25,
        brandFundingPercent: 50,
      },
    ];
    const amounts = [1n, 100n, 9_999n, 100_000n, 999_999_999n];
    for (const cfg of cases) {
      for (const amt of amounts) {
        const shares = splitFundingShares(amt, cfg);
        const sum = shares.reduce((a, s) => a + s.amountInPaise, 0n);
        expect(sum).toBe(amt);
      }
    }
  });
});

describe('validateFundingConfig', () => {
  it('PLATFORM with 100% platform passes', () => {
    expect(() =>
      validateFundingConfig({
        fundingType: 'PLATFORM',
        platformFundingPercent: 100,
      }),
    ).not.toThrow();
  });
  it('PLATFORM with non-100% platform throws', () => {
    expect(() =>
      validateFundingConfig({
        fundingType: 'PLATFORM',
        platformFundingPercent: 50,
      }),
    ).toThrow();
  });
  it('SELLER with 100% seller passes', () => {
    expect(() =>
      validateFundingConfig({
        fundingType: 'SELLER',
        sellerFundingPercent: 100,
      }),
    ).not.toThrow();
  });
  it('SHARED summing to 100 passes', () => {
    expect(() =>
      validateFundingConfig({
        fundingType: 'SHARED',
        platformFundingPercent: 60,
        sellerFundingPercent: 40,
      }),
    ).not.toThrow();
  });
  it('SHARED summing to !=100 throws', () => {
    expect(() =>
      validateFundingConfig({
        fundingType: 'SHARED',
        platformFundingPercent: 60,
        sellerFundingPercent: 30,
      }),
    ).toThrow(/sum to 100/);
  });

  // Phase 247-FB — FRANCHISE funding party.
  it('FRANCHISE with 100% franchise passes', () => {
    expect(() =>
      validateFundingConfig({
        fundingType: 'FRANCHISE',
        franchiseFundingPercent: 100,
      }),
    ).not.toThrow();
  });
  it('SHARED 4-way (incl. franchise) summing to 100 passes', () => {
    expect(() =>
      validateFundingConfig({
        fundingType: 'SHARED',
        platformFundingPercent: 25,
        sellerFundingPercent: 25,
        brandFundingPercent: 25,
        franchiseFundingPercent: 25,
      }),
    ).not.toThrow();
  });
  it('SHARED 4-way ignoring the franchise share throws (sum < 100)', () => {
    expect(() =>
      validateFundingConfig({
        fundingType: 'SHARED',
        platformFundingPercent: 25,
        sellerFundingPercent: 25,
        brandFundingPercent: 25,
        // franchise 25 omitted → sums to 75
      }),
    ).toThrow(/sum to 100/);
  });
});

describe('splitFundingShares — FRANCHISE (Phase 247-FB)', () => {
  it('pure FRANCHISE funding → one FRANCHISE row, full amount', () => {
    const shares = splitFundingShares(
      30_000n,
      config({ fundingType: 'FRANCHISE' }),
    );
    expect(shares).toEqual([
      { liabilityParty: 'FRANCHISE', amountInPaise: 30_000n },
    ]);
  });
  it('SHARED 4-way splits to one row per party, conserving the total', () => {
    const shares = splitFundingShares(
      40_000n,
      config({
        fundingType: 'SHARED',
        platformFundingPercent: 25,
        sellerFundingPercent: 25,
        brandFundingPercent: 25,
        franchiseFundingPercent: 25,
      }),
    );
    const total = shares.reduce((s, r) => s + r.amountInPaise, 0n);
    expect(total).toBe(40_000n);
    expect(shares).toContainEqual({
      liabilityParty: 'FRANCHISE',
      amountInPaise: 10_000n,
    });
  });
});

describe('resolveItemFundingShares (Phase 251 — per-line SELLER routing)', () => {
  const SELLER: FundingConfig = {
    fundingType: 'SELLER',
    sellerFundingPercent: 100,
  };

  it('SELLER-funded line fulfilled by a marketplace seller → SELLER liability + sellerId', () => {
    const shares = resolveItemFundingShares(10_000n, SELLER, {
      sellerId: 'seller-1',
      franchiseId: null,
    });
    expect(shares).toEqual([
      {
        liabilityParty: 'SELLER',
        amountInPaise: 10_000n,
        sellerId: 'seller-1',
        franchiseId: null,
        brandId: null,
      },
    ]);
  });

  it('SELLER-funded line fulfilled by a FRANCHISE → FRANCHISE liability + franchiseId (the bug this fixes)', () => {
    const shares = resolveItemFundingShares(10_000n, SELLER, {
      sellerId: null,
      franchiseId: 'fr-1',
    });
    expect(shares).toEqual([
      {
        liabilityParty: 'FRANCHISE',
        amountInPaise: 10_000n,
        sellerId: null,
        franchiseId: 'fr-1',
        brandId: null,
      },
    ]);
    // The pre-fix behavior wrote a SELLER row with a null sellerId — assert
    // that NEVER happens now.
    expect(shares.some((s) => s.liabilityParty === 'SELLER')).toBe(false);
  });

  it('franchise takes precedence when a line somehow carries both ids', () => {
    const shares = resolveItemFundingShares(10_000n, SELLER, {
      sellerId: 'seller-1',
      franchiseId: 'fr-1',
    });
    expect(shares[0]!.liabilityParty).toBe('FRANCHISE');
    expect(shares[0]!.franchiseId).toBe('fr-1');
  });

  it('SELLER-funded line with NO resolvable fulfiller → PLATFORM-absorbed (never stranded)', () => {
    const shares = resolveItemFundingShares(10_000n, SELLER, {
      sellerId: null,
      franchiseId: null,
    });
    expect(shares).toEqual([
      {
        liabilityParty: 'PLATFORM',
        amountInPaise: 10_000n,
        sellerId: null,
        franchiseId: null,
        brandId: null,
      },
    ]);
  });

  it('PLATFORM funding unchanged — full amount to PLATFORM, line sellerId carried', () => {
    const shares = resolveItemFundingShares(
      10_000n,
      { fundingType: 'PLATFORM', platformFundingPercent: 100 },
      { sellerId: 'seller-1', franchiseId: null },
    );
    expect(shares).toEqual([
      {
        liabilityParty: 'PLATFORM',
        amountInPaise: 10_000n,
        sellerId: 'seller-1',
        franchiseId: null,
        brandId: null,
      },
    ]);
  });

  it('FRANCHISE funding (pinned) uses the discount franchiseId, not the line', () => {
    const shares = resolveItemFundingShares(
      10_000n,
      { fundingType: 'FRANCHISE', franchiseFundingPercent: 100, franchiseId: 'pinned-fr' },
      { sellerId: null, franchiseId: 'line-fr' },
    );
    expect(shares).toEqual([
      {
        liabilityParty: 'FRANCHISE',
        amountInPaise: 10_000n,
        sellerId: null,
        franchiseId: 'pinned-fr',
        brandId: null,
      },
    ]);
  });

  it('conserves the full amount in every SELLER-routing branch', () => {
    const fulfillers = [
      { sellerId: 's', franchiseId: null },
      { sellerId: null, franchiseId: 'f' },
      { sellerId: null, franchiseId: null },
    ];
    for (const f of fulfillers) {
      const shares = resolveItemFundingShares(12_345n, SELLER, f);
      const sum = shares.reduce((acc, s) => acc + s.amountInPaise, 0n);
      expect(sum).toBe(12_345n);
    }
  });
});
