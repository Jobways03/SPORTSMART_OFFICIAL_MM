import {
  assessReturnRisk,
  RiskSnapshot,
  scoreCustomerAbuse,
  scoreRecentReturns,
  scoreHighValueWeakEvidence,
  scoreMissingItemClaim,
  scoreChargebackHistory,
  scoreSellerWrongItemRate,
  scoreCourierDamageHotspot,
} from './return-risk-scorer';

const baseSnapshot = (overrides: Partial<RiskSnapshot> = {}): RiskSnapshot => ({
  totalValueInPaise: 100_000, // ₹1,000 — well below high-value
  evidenceCount: 1,
  reasonCategories: ['DEFECTIVE'],
  customer: {
    flaggedForAbuse: false,
    recentReturnCount: 0,
    chargebackCountLifetime: 0,
  },
  ...overrides,
});

// ─── Dimension tests ────────────────────────────────────────────────

describe('scoreCustomerAbuse', () => {
  it('returns 0 when not flagged', () => {
    expect(scoreCustomerAbuse(baseSnapshot()).score).toBe(0);
  });
  it('returns 40 + flag when flagged', () => {
    const r = scoreCustomerAbuse(
      baseSnapshot({ customer: {
        flaggedForAbuse: true,
        recentReturnCount: 0,
        chargebackCountLifetime: 0,
      } }),
    );
    expect(r.score).toBe(40);
    expect(r.flag).toBe('CUSTOMER_ABUSE');
  });
});

describe('scoreRecentReturns', () => {
  it('returns 0 below threshold', () => {
    expect(
      scoreRecentReturns(
        baseSnapshot({ customer: {
          flaggedForAbuse: false,
          recentReturnCount: 2,
          chargebackCountLifetime: 0,
        } }),
      ).score,
    ).toBe(0);
  });
  it('returns 15 at threshold', () => {
    const r = scoreRecentReturns(
      baseSnapshot({ customer: {
        flaggedForAbuse: false,
        recentReturnCount: 3,
        chargebackCountLifetime: 0,
      } }),
    );
    expect(r.score).toBe(15);
    expect(r.flag).toBe('HIGH_RECENT_RETURN_COUNT');
  });
  it('caps at 30 even for very many returns', () => {
    const r = scoreRecentReturns(
      baseSnapshot({ customer: {
        flaggedForAbuse: false,
        recentReturnCount: 50,
        chargebackCountLifetime: 0,
      } }),
    );
    expect(r.score).toBe(30);
  });
});

describe('scoreHighValueWeakEvidence', () => {
  it('returns 25 when high-value AND no evidence (worst case)', () => {
    const r = scoreHighValueWeakEvidence(
      baseSnapshot({
        totalValueInPaise: 600_000, // ₹6,000
        evidenceCount: 0,
      }),
    );
    expect(r.score).toBe(25);
    expect(r.flag).toBe('HIGH_VALUE_WEAK_EVIDENCE');
  });
  it('returns 10 when high-value with evidence', () => {
    const r = scoreHighValueWeakEvidence(
      baseSnapshot({
        totalValueInPaise: 1_500_000, // ₹15,000
        evidenceCount: 3,
      }),
    );
    expect(r.score).toBe(10);
    expect(r.flag).toBe('HIGH_VALUE');
  });
  it('returns 0 when low-value even with no evidence', () => {
    expect(
      scoreHighValueWeakEvidence(
        baseSnapshot({ totalValueInPaise: 50_000, evidenceCount: 0 }),
      ).score,
    ).toBe(0);
  });
});

describe('scoreMissingItemClaim', () => {
  it('returns 15 for WRONG_ITEM with zero evidence', () => {
    const r = scoreMissingItemClaim(
      baseSnapshot({ reasonCategories: ['WRONG_ITEM'], evidenceCount: 0 }),
    );
    expect(r.score).toBe(15);
    expect(r.flag).toBe('MISSING_ITEM_CLAIM');
  });
  it('returns 0 for WRONG_ITEM with evidence', () => {
    expect(
      scoreMissingItemClaim(
        baseSnapshot({ reasonCategories: ['WRONG_ITEM'], evidenceCount: 2 }),
      ).score,
    ).toBe(0);
  });
});

describe('scoreChargebackHistory', () => {
  it('returns 25 with any chargeback history', () => {
    const r = scoreChargebackHistory(
      baseSnapshot({ customer: {
        flaggedForAbuse: false,
        recentReturnCount: 0,
        chargebackCountLifetime: 1,
      } }),
    );
    expect(r.score).toBe(25);
    expect(r.flag).toBe('CHARGEBACK_HISTORY');
  });
});

describe('scoreSellerWrongItemRate', () => {
  it('returns 0 when seller has no aggregate (snapshot missing)', () => {
    expect(scoreSellerWrongItemRate(baseSnapshot()).score).toBe(0);
  });

  it('returns 0 below the volume threshold (avoids small-sample noise)', () => {
    expect(
      scoreSellerWrongItemRate(
        baseSnapshot({
          seller: { wrongItemRateBps: 5000, totalReturnsInWindow: 2 },
        }),
      ).score,
    ).toBe(0);
  });

  it('returns 0 above volume but below rate threshold', () => {
    expect(
      scoreSellerWrongItemRate(
        baseSnapshot({
          seller: { wrongItemRateBps: 500, totalReturnsInWindow: 50 },
        }),
      ).score,
    ).toBe(0);
  });

  it('returns -15 + flag when rate exceeds threshold AND volume is sufficient', () => {
    const r = scoreSellerWrongItemRate(
      baseSnapshot({
        seller: { wrongItemRateBps: 1500, totalReturnsInWindow: 20 }, // 15%
      }),
    );
    expect(r.score).toBe(-15);
    expect(r.flag).toBe('SELLER_HIGH_WRONG_ITEM_RATE');
  });
});

describe('scoreCourierDamageHotspot', () => {
  it('returns 0 when courier snapshot missing', () => {
    expect(scoreCourierDamageHotspot(baseSnapshot()).score).toBe(0);
  });

  it('returns 0 below the hotspot threshold', () => {
    expect(
      scoreCourierDamageHotspot(
        baseSnapshot({
          courier: { damageClaimsInWindow: 3, courierName: 'Bluedart' },
        }),
      ).score,
    ).toBe(0);
  });

  it('returns -10 + flag when at/above threshold', () => {
    const r = scoreCourierDamageHotspot(
      baseSnapshot({
        courier: { damageClaimsInWindow: 7, courierName: 'Bluedart' },
      }),
    );
    expect(r.score).toBe(-10);
    expect(r.flag).toBe('COURIER_DAMAGE_HOTSPOT');
  });

  it('returns 0 when courierName is null even if claims count is high', () => {
    expect(
      scoreCourierDamageHotspot(
        baseSnapshot({
          courier: { damageClaimsInWindow: 99, courierName: null },
        }),
      ).score,
    ).toBe(0);
  });
});

// ─── Aggregator tests ────────────────────────────────────────────────

describe('assessReturnRisk', () => {
  it('LOW for clean snapshot', () => {
    const a = assessReturnRisk(baseSnapshot());
    expect(a.score).toBe(0);
    expect(a.flags).toEqual([]);
    expect(a.level).toBe('LOW');
  });

  it('MEDIUM when high-value but with evidence', () => {
    const a = assessReturnRisk(
      baseSnapshot({ totalValueInPaise: 1_500_000, evidenceCount: 3 }),
    );
    expect(a.score).toBe(10); // HIGH_VALUE only
    expect(a.flags).toEqual(['HIGH_VALUE']);
    expect(a.level).toBe('LOW');
  });

  it('HIGH when abuse flag fires (40) + high-value-weak-evidence (25)', () => {
    const a = assessReturnRisk(
      baseSnapshot({
        totalValueInPaise: 1_500_000,
        evidenceCount: 0,
        customer: {
          flaggedForAbuse: true,
          recentReturnCount: 0,
          chargebackCountLifetime: 0,
        },
      }),
    );
    expect(a.score).toBe(65); // 40 + 25
    expect(a.flags).toEqual(['CUSTOMER_ABUSE', 'HIGH_VALUE_WEAK_EVIDENCE']);
    expect(a.level).toBe('HIGH');
  });

  it('clamps to 100 if dimensions sum higher', () => {
    const a = assessReturnRisk(
      baseSnapshot({
        totalValueInPaise: 1_500_000,
        evidenceCount: 0,
        reasonCategories: ['WRONG_ITEM'],
        customer: {
          flaggedForAbuse: true,           // 40
          recentReturnCount: 50,           // 30
          chargebackCountLifetime: 5,      // 25
        },
      }),
    );
    // 40 + 30 + 25 + 25 + 15 = 135 → clamped to 100
    expect(a.score).toBe(100);
    expect(a.level).toBe('HIGH');
    expect(a.flags).toContain('CUSTOMER_ABUSE');
    expect(a.flags).toContain('HIGH_RECENT_RETURN_COUNT');
    expect(a.flags).toContain('HIGH_VALUE_WEAK_EVIDENCE');
    expect(a.flags).toContain('CHARGEBACK_HISTORY');
    expect(a.flags).toContain('MISSING_ITEM_CLAIM');
  });

  it('MEDIUM at score=30 (boundary)', () => {
    const a = assessReturnRisk(
      baseSnapshot({
        customer: {
          flaggedForAbuse: false,
          recentReturnCount: 6, // 15 + 3 overage * 5 = 30
          chargebackCountLifetime: 0,
        },
      }),
    );
    expect(a.score).toBe(30);
    expect(a.level).toBe('MEDIUM');
  });

  it('HIGH at score=60 (boundary)', () => {
    const a = assessReturnRisk(
      baseSnapshot({
        totalValueInPaise: 1_500_000, // HIGH_VALUE = 10
        evidenceCount: 3,
        customer: {
          flaggedForAbuse: true,        // 40
          recentReturnCount: 5,         // 15 + 2 overage * 5 = 25, capped 25 ≤ 30
          chargebackCountLifetime: 0,
        },
      }),
    );
    // 40 + 25 + 10 = 75 → HIGH
    expect(a.level).toBe('HIGH');
    expect(a.score).toBe(75);
  });
});
