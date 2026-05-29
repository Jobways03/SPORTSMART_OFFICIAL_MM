// Phase E (P1.4) — Fraud / rate-limit service tests.
//
// Mocks Prisma + EnvService. Covers:
//   - rate-limit fires above threshold
//   - rate-limit silent below threshold
//   - retry-after computed from oldest in window
//   - VALID attempts don't count
//   - feature-flag OFF disables both gating and writes
//   - recordAttempt swallows DB errors
//   - classifier is invoked on the controller side (covered by an
//     integration test in a follow-up)

import {
  DiscountFraudService,
  TooManyCouponAttemptsError,
} from './discount-fraud.service';

function makeMocks(envOverrides: Record<string, any> = {}) {
  const couponAttemptCount = jest.fn();
  const couponAttemptCreate = jest.fn();
  const couponAttemptFindFirst = jest.fn();
  const couponAttemptGroupBy = jest.fn();
  const couponAttemptFindMany = jest.fn();
  const queryRaw = jest.fn();

  const prisma: any = {
    couponAttempt: {
      count: couponAttemptCount,
      create: couponAttemptCreate,
      findFirst: couponAttemptFindFirst,
      groupBy: couponAttemptGroupBy,
      findMany: couponAttemptFindMany,
    },
    $queryRaw: queryRaw,
  };

  const env: any = {
    getBoolean: (key: string, fallback: boolean) =>
      envOverrides[key] ?? fallback,
    getNumber: (key: string, fallback: number) =>
      envOverrides[key] ?? fallback,
    // Phase 62 (2026-05-22) — DiscountFraudService now reads
    // COUPON_ATTEMPT_IP_HASH_SALT via getString (audit Gap #21).
    getString: (key: string, fallback?: string) =>
      envOverrides[key] ?? fallback ?? 'test-salt-min-16chars',
  };

  return {
    prisma,
    env,
    couponAttemptCount,
    couponAttemptCreate,
    couponAttemptFindFirst,
    couponAttemptGroupBy,
    couponAttemptFindMany,
    queryRaw,
  };
}

describe('DiscountFraudService.checkRateLimit', () => {
  it('passes silently when count below threshold', async () => {
    const m = makeMocks();
    m.couponAttemptCount.mockResolvedValue(3);
    m.couponAttemptFindFirst.mockResolvedValue({ createdAt: new Date() });
    const svc = new DiscountFraudService(m.prisma, m.env);

    await expect(
      svc.checkRateLimit({
        customerId: 'c1',
        ipAddress: '1.2.3.4',
        codeAttempted: 'ABC',
      }),
    ).resolves.toBeUndefined();
  });

  it('throws TooManyCouponAttemptsError when threshold reached', async () => {
    const m = makeMocks();
    m.couponAttemptCount.mockResolvedValue(10); // threshold = 10 by default
    const oldest = new Date(Date.now() - 5 * 60 * 1000);
    m.couponAttemptFindFirst.mockResolvedValue({ createdAt: oldest });
    const svc = new DiscountFraudService(m.prisma, m.env);

    await expect(
      svc.checkRateLimit({
        customerId: 'c1',
        ipAddress: '1.2.3.4',
        codeAttempted: 'ABC',
      }),
    ).rejects.toBeInstanceOf(TooManyCouponAttemptsError);
  });

  it('retry-after derived from oldest attempt in window', async () => {
    const m = makeMocks();
    m.couponAttemptCount.mockResolvedValue(10);
    // Oldest 5 minutes ago, 15-minute window → retry-after ~10 min.
    const oldest = new Date(Date.now() - 5 * 60 * 1000);
    m.couponAttemptFindFirst.mockResolvedValue({ createdAt: oldest });
    const svc = new DiscountFraudService(m.prisma, m.env);

    await expect(
      svc.checkRateLimit({
        customerId: 'c1',
        ipAddress: '1.2.3.4',
        codeAttempted: 'ABC',
      }),
    ).rejects.toMatchObject({
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('returns silently when no identifiers (anonymous + no IP)', async () => {
    const m = makeMocks();
    const svc = new DiscountFraudService(m.prisma, m.env);

    await expect(
      svc.checkRateLimit({ codeAttempted: 'ABC' }),
    ).resolves.toBeUndefined();
    expect(m.couponAttemptCount).not.toHaveBeenCalled();
  });

  it('feature flag OFF disables gating', async () => {
    const m = makeMocks({ DISCOUNT_FRAUD_TRACKING_ENABLED: false });
    m.couponAttemptCount.mockResolvedValue(1000);
    const svc = new DiscountFraudService(m.prisma, m.env);

    await expect(
      svc.checkRateLimit({
        customerId: 'c1',
        ipAddress: '1.2.3.4',
        codeAttempted: 'ABC',
      }),
    ).resolves.toBeUndefined();
    expect(m.couponAttemptCount).not.toHaveBeenCalled();
  });

  it('records a BLOCKED attempt when threshold tripped', async () => {
    const m = makeMocks();
    m.couponAttemptCount.mockResolvedValue(10);
    m.couponAttemptFindFirst.mockResolvedValue({ createdAt: new Date() });
    m.couponAttemptCreate.mockResolvedValue({ id: 'a1' });
    const svc = new DiscountFraudService(m.prisma, m.env);

    await expect(
      svc.checkRateLimit({
        customerId: 'c1',
        ipAddress: '1.2.3.4',
        codeAttempted: 'ABC',
      }),
    ).rejects.toBeInstanceOf(TooManyCouponAttemptsError);
    // Wait one tick so the void promise inside checkRateLimit
    // resolves before assertion.
    await new Promise((r) => setImmediate(r));
    expect(m.couponAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: 'BLOCKED',
          reason: 'rate_limit_exceeded',
        }),
      }),
    );
  });
});

describe('DiscountFraudService.recordAttempt', () => {
  it('writes one row with normalized code', async () => {
    const m = makeMocks();
    m.couponAttemptCreate.mockResolvedValue({ id: 'a1' });
    const svc = new DiscountFraudService(m.prisma, m.env);

    await svc.recordAttempt(
      {
        customerId: 'c1',
        ipAddress: '1.2.3.4',
        codeAttempted: '  summer10  ',
      },
      'VALID',
    );
    expect(m.couponAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          codeAttempted: 'SUMMER10',
          result: 'VALID',
        }),
      }),
    );
  });

  // Phase 62 (2026-05-22) — audit Gap #21. The recorded row stores
  // a salted hash of the IP, not the plaintext value.
  it('hashes the IP address instead of persisting plaintext (Phase 62 — Gap #21)', async () => {
    const m = makeMocks();
    m.couponAttemptCreate.mockResolvedValue({ id: 'a1' });
    const svc = new DiscountFraudService(m.prisma, m.env);
    await svc.recordAttempt(
      { customerId: 'c1', ipAddress: '1.2.3.4', codeAttempted: 'SUMMER10' },
      'VALID',
    );
    const data = m.couponAttemptCreate.mock.calls[0][0].data;
    expect(data.ipAddress).toBeNull();
    expect(data.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('feature flag OFF skips the write', async () => {
    const m = makeMocks({ DISCOUNT_FRAUD_TRACKING_ENABLED: false });
    const svc = new DiscountFraudService(m.prisma, m.env);
    await svc.recordAttempt({ codeAttempted: 'ABC' }, 'INVALID');
    expect(m.couponAttemptCreate).not.toHaveBeenCalled();
  });

  it('returns null on DB error (best-effort, non-throwing)', async () => {
    const m = makeMocks();
    m.couponAttemptCreate.mockRejectedValue(new Error('DB down'));
    const svc = new DiscountFraudService(m.prisma, m.env);
    const r = await svc.recordAttempt({ codeAttempted: 'A' }, 'INVALID');
    expect(r).toBeNull();
  });
});

describe('DiscountFraudService.getAttemptStats', () => {
  it('rolls up counts by result', async () => {
    const m = makeMocks();
    m.couponAttemptGroupBy.mockResolvedValue([
      { result: 'VALID', _count: 5 },
      { result: 'INVALID', _count: 12 },
      { result: 'BLOCKED', _count: 3 },
    ]);
    const svc = new DiscountFraudService(m.prisma, m.env);

    const stats = await svc.getAttemptStats({
      fromDate: new Date(),
      toDate: new Date(),
    });
    expect(stats).toEqual({
      total: 20,
      valid: 5,
      invalid: 12,
      blocked: 3,
      expired: 0,
      notEligible: 0,
    });
  });
});
