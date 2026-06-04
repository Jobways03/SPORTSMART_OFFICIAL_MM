import { CodPublicFacade } from './cod-public.facade';

/**
 * Story 1.4 cleanup — verifies the facade respects env-driven
 * guardrails (`COD_FALLBACK_{MAX,MIN}_ORDER_VALUE_INR` +
 * `COD_ABUSE_{RECENT_CANCEL_LIMIT,LOOKBACK_DAYS}`) instead of the
 * previously hardcoded thresholds. These guardrails sit on top of
 * the admin-editable CodRuleEngine and must reject extreme order
 * values + repeat-cancellers even if the rule engine has nothing
 * configured.
 *
 * No real Prisma; we mock the count + findFirst calls to focus the
 * test on the threshold + abuse-counter logic. The rule engine is
 * stubbed to always pass so its reason doesn't leak into the assertions.
 */
describe('CodPublicFacade env-driven guardrails', () => {
  function buildFacade(env: Record<string, number>) {
    const prisma: any = {
      seller: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      sellerServiceArea: {
        findFirst: jest.fn().mockResolvedValue({ id: 'sa-1' }),
      },
      // Phase 3.4 — the abuse check moved from a flat `count` of cancelled
      // COD orders to a weighted `findMany` over the recent cancellation
      // rows (refused-delivery weights 3, customer-cancel 1, seller/system 0).
      // Default to no recent cancellations.
      masterOrder: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const ruleEngine: any = {
      evaluate: jest.fn().mockResolvedValue({ eligible: true }),
    };
    const envService: any = {
      getNumber: jest.fn().mockImplementation((key: string, fallback: number) =>
        env[key] ?? fallback,
      ),
    };
    const facade = new CodPublicFacade(prisma, ruleEngine, envService);
    return { facade, prisma, envService };
  }

  const baseParams = {
    customerId: 'c-1',
    sellerId: 's-1',
    orderValue: 5000,
    pincode: '110001',
  };

  it('reads env at construction; subsequent env changes do not affect already-built facade', async () => {
    const { facade, envService } = buildFacade({
      COD_FALLBACK_MAX_ORDER_VALUE_INR: 10000,
      COD_FALLBACK_MIN_ORDER_VALUE_INR: 100,
      COD_ABUSE_RECENT_CANCEL_LIMIT: 3,
      COD_ABUSE_LOOKBACK_DAYS: 30,
    });
    // 4 reads on construction; nothing read at evaluate time.
    expect(envService.getNumber).toHaveBeenCalledTimes(4);

    await facade.evaluateCodEligibility(baseParams);
    // Still 4 — evaluate must not re-read env on the hot path.
    expect(envService.getNumber).toHaveBeenCalledTimes(4);
  });

  it('blocks orders above the env-tuned max', async () => {
    const { facade } = buildFacade({
      COD_FALLBACK_MAX_ORDER_VALUE_INR: 2000,
    });
    const res = await facade.evaluateCodEligibility({
      ...baseParams,
      orderValue: 5000,
    });
    expect(res.allowed).toBe(false);
    expect(res.reasons.some((r) => r.includes('₹2000'))).toBe(true);
  });

  it('blocks orders below the env-tuned min', async () => {
    const { facade } = buildFacade({
      COD_FALLBACK_MIN_ORDER_VALUE_INR: 500,
    });
    const res = await facade.evaluateCodEligibility({
      ...baseParams,
      orderValue: 100,
    });
    expect(res.allowed).toBe(false);
    expect(res.reasons.some((r) => r.includes('₹500'))).toBe(true);
  });

  it('allows orders within the tuned envelope', async () => {
    const { facade } = buildFacade({
      COD_FALLBACK_MAX_ORDER_VALUE_INR: 10000,
      COD_FALLBACK_MIN_ORDER_VALUE_INR: 100,
    });
    const res = await facade.evaluateCodEligibility({
      ...baseParams,
      orderValue: 5000,
    });
    expect(res.allowed).toBe(true);
    expect(res.reasons).toEqual([]);
  });

  it('blocks customer who hit the env-tuned cancellation limit', async () => {
    // Two plain customer cancellations → weighted score 2 (weight 1 each),
    // which meets the env-tuned limit of 2.
    const prismaFindMany = jest.fn().mockResolvedValue([
      { id: 'o1', orderStatus: 'CANCELLED', verificationRemarks: null },
      { id: 'o2', orderStatus: 'CANCELLED', verificationRemarks: null },
    ]);
    const { facade } = buildFacade({
      COD_ABUSE_RECENT_CANCEL_LIMIT: 2,
      COD_ABUSE_LOOKBACK_DAYS: 30,
    });
    // Patch prisma.masterOrder.findMany via the constructor's prisma ref —
    // grab the facade's reference and override.
    (facade as any).prisma.masterOrder.findMany = prismaFindMany;
    const res = await facade.evaluateCodEligibility(baseParams);
    expect(res.allowed).toBe(false);
    expect(res.reasons.some((r) => r.includes('30 days'))).toBe(true);
  });

  it('lookback window message reflects env-tuned days', async () => {
    const { facade } = buildFacade({
      COD_ABUSE_RECENT_CANCEL_LIMIT: 1,
      COD_ABUSE_LOOKBACK_DAYS: 7,
    });
    (facade as any).prisma.masterOrder.findMany = jest.fn().mockResolvedValue([
      { id: 'o1', orderStatus: 'CANCELLED', verificationRemarks: null },
      { id: 'o2', orderStatus: 'CANCELLED', verificationRemarks: null },
      { id: 'o3', orderStatus: 'CANCELLED', verificationRemarks: null },
      { id: 'o4', orderStatus: 'CANCELLED', verificationRemarks: null },
      { id: 'o5', orderStatus: 'CANCELLED', verificationRemarks: null },
    ]);
    const res = await facade.evaluateCodEligibility(baseParams);
    expect(res.allowed).toBe(false);
    expect(res.reasons.some((r) => r.includes('7 days'))).toBe(true);
  });

  it('reason-code list reflects live env tunings', async () => {
    const { facade } = buildFacade({
      COD_FALLBACK_MAX_ORDER_VALUE_INR: 25000,
      COD_FALLBACK_MIN_ORDER_VALUE_INR: 250,
    });
    const codes = await facade.getReasonCodes();
    const high = codes.find((c) => c.code === 'ORDER_VALUE_TOO_HIGH');
    const low = codes.find((c) => c.code === 'ORDER_VALUE_TOO_LOW');
    expect(high?.description).toContain('₹25000');
    expect(low?.description).toContain('₹250');
  });
});
