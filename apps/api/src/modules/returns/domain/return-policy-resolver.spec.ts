// Phase 92 (2026-05-23) — return-policy resolver coverage.

import { resolveReturnPolicy } from './return-policy-resolver';

const GLOBAL_WINDOW = 14;

describe('resolveReturnPolicy (Phase 92)', () => {
  it('Gap #11 — non-PHYSICAL item kind is never returnable', () => {
    const res = resolveReturnPolicy({
      itemKind: 'DIGITAL',
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.isReturnable).toBe(false);
    expect(res.source).toBe('ITEM_KIND');
  });

  it('Gap #1 — Product.isReturnable=false blocks', () => {
    const res = resolveReturnPolicy({
      productIsReturnable: false,
      productNonReturnableReason: 'Final sale',
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.isReturnable).toBe(false);
    expect(res.nonReturnableReason).toBe('Final sale');
    expect(res.source).toBe('PRODUCT');
  });

  it('Gap #2 — Category.isReturnable=false blocks when product is silent', () => {
    const res = resolveReturnPolicy({
      categoryIsReturnable: false,
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.isReturnable).toBe(false);
    expect(res.source).toBe('CATEGORY');
  });

  it('product override beats category default for window', () => {
    const res = resolveReturnPolicy({
      productReturnWindowDaysOverride: 7,
      categoryDefaultReturnWindowDays: 30,
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.windowDays).toBe(7);
  });

  it('category default applies when no product override', () => {
    const res = resolveReturnPolicy({
      categoryDefaultReturnWindowDays: 30,
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.windowDays).toBe(30);
  });

  it('global default applies when no overrides', () => {
    const res = resolveReturnPolicy({
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.windowDays).toBe(14);
  });

  it('Gap #20 — snapshot beats live product', () => {
    const res = resolveReturnPolicy({
      isReturnableSnapshot: false,
      nonReturnableReasonSnapshot: 'Snapshot says no',
      productIsReturnable: true, // live says yes — ignored
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.isReturnable).toBe(false);
    expect(res.nonReturnableReason).toBe('Snapshot says no');
  });

  it('Gap #3/#19 — allowed reasons fall back to ALL when nothing set', () => {
    const res = resolveReturnPolicy({ globalWindowDays: GLOBAL_WINDOW });
    expect(res.allowedReasons).toContain('DEFECTIVE');
    expect(res.allowedReasons).toContain('SIZE_FIT_ISSUE');
    expect(res.requiresEvidenceFor).toContain('DEFECTIVE');
    expect(res.requiresEvidenceFor).toContain('DAMAGED_IN_TRANSIT');
  });

  it('Gap #3 — product override limits allowed reasons', () => {
    const res = resolveReturnPolicy({
      productAllowedReturnReasonsJson: ['DEFECTIVE', 'DAMAGED_IN_TRANSIT'],
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.allowedReasons).toEqual(['DEFECTIVE', 'DAMAGED_IN_TRANSIT']);
    expect(res.allowedReasons).not.toContain('SIZE_FIT_ISSUE');
  });

  it('Gap #12 — allowPartialReturn defaults to true; product false propagates', () => {
    const res1 = resolveReturnPolicy({ globalWindowDays: GLOBAL_WINDOW });
    expect(res1.allowPartialReturn).toBe(true);
    const res2 = resolveReturnPolicy({
      productAllowPartialReturn: false,
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res2.allowPartialReturn).toBe(false);
  });

  it('garbage in allowedReturnReasonsJson is ignored (falls through)', () => {
    const res = resolveReturnPolicy({
      productAllowedReturnReasonsJson: ['NOT_A_REAL_REASON', 'DEFECTIVE'],
      globalWindowDays: GLOBAL_WINDOW,
    });
    expect(res.allowedReasons).toEqual(['DEFECTIVE']);
  });
});
