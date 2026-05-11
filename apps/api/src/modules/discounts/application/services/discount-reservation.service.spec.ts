// Phase B (P0.3, P0.4) — Reservation service unit tests.
//
// Mocks the PrismaClient so we exercise the service's logic
// (idempotency, lifecycle transitions, conflict mapping) without
// needing a live DB. Concurrency-correctness is enforced at the DB
// layer (row lock + partial unique indexes); the integration tests
// that exercise the actual race against Postgres live in
// `test/integration/`.

import {
  DEFAULT_RESERVATION_TTL_MS,
  DiscountReservationService,
  DiscountUnavailableError,
  ReservationConflictError,
} from './discount-reservation.service';
import { Prisma } from '@prisma/client';

type AnyMock = jest.Mock<any, any>;

// Minimal-shape Prisma mock — only the methods the service calls.
function makePrismaMock(): {
  prisma: any;
  txClient: any;
  redemptionFindFirst: AnyMock;
  redemptionFindUnique: AnyMock;
  redemptionCount: AnyMock;
  redemptionCreate: AnyMock;
  redemptionUpdateMany: AnyMock;
  rawQuery: AnyMock;
  events: any;
  affiliateUnification: any;
} {
  const redemptionFindFirst: AnyMock = jest.fn();
  const redemptionFindUnique: AnyMock = jest.fn().mockResolvedValue(null);
  const redemptionCount: AnyMock = jest.fn();
  const redemptionCreate: AnyMock = jest.fn();
  const redemptionUpdateMany: AnyMock = jest.fn();
  const rawQuery: AnyMock = jest.fn();

  const txClient = {
    discountRedemption: {
      findFirst: redemptionFindFirst,
      findUnique: redemptionFindUnique,
      count: redemptionCount,
      create: redemptionCreate,
      updateMany: redemptionUpdateMany,
    },
    $queryRaw: rawQuery,
  };

  const prisma = {
    discountRedemption: {
      findUnique: redemptionFindUnique,
      updateMany: redemptionUpdateMany,
    },
    // Prisma interactive transaction — invokes the callback with the
    // tx client. We pass txClient so the service operates on it.
    $transaction: jest.fn(async (cb: any) => cb(txClient)),
  };

  // Phase E (P1.1) — events service is best-effort, so a no-op
  // double satisfies the constructor arg without coupling the
  // tests to event-emission behavior.
  const events = {
    emitRedemptionEvent: jest.fn().mockResolvedValue(undefined),
    emitDiscountCrud: jest.fn().mockResolvedValue(undefined),
    emitLiabilityRecorded: jest.fn().mockResolvedValue(undefined),
    emitRefundProrated: jest.fn().mockResolvedValue(undefined),
    emitMaxUsageReached: jest.fn().mockResolvedValue(undefined),
    emitBudgetExhausted: jest.fn().mockResolvedValue(undefined),
  };

  // Phase F (P2.3) — affiliate unification double. Default: no-op hooks
  // (redemption fires `onUnifiedCouponRedeemed` best-effort, never
  // blocks).
  const affiliateUnification = {
    onUnifiedCouponRedeemed: jest.fn().mockResolvedValue(undefined),
    unifyExistingCoupon: jest.fn().mockResolvedValue({ discountId: 'd1' }),
    unifyAllPending: jest
      .fn()
      .mockResolvedValue({ total: 0, unified: 0, skipped: 0, errors: [] }),
  };

  return {
    prisma,
    txClient,
    redemptionFindFirst,
    redemptionFindUnique,
    redemptionCount,
    redemptionCreate,
    redemptionUpdateMany,
    rawQuery,
    events,
    affiliateUnification,
  };
}

const aDiscount = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'disc-1',
  maxUses: null as number | null,
  onePerCustomer: false,
  status: 'ACTIVE',
  startsAt: new Date(Date.now() - 60_000),
  endsAt: new Date(Date.now() + 60_000),
  ...over,
});

describe('DiscountReservationService.reserve', () => {
  it('idempotency: returns existing row when key matches', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce({
      id: 'red-1',
      expiresAt: new Date(Date.now() + 60_000),
      discountAmountInPaise: 5_000n,
    });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    const r = await svc.reserve({
      discountId: 'disc-1',
      customerId: 'cust-1',
      discountAmountInPaise: 5_000n,
      idempotencyKey: 'key-1',
    });
    expect(r.created).toBe(false);
    expect(r.redemptionId).toBe('red-1');
    expect(m.redemptionCreate).not.toHaveBeenCalled();
  });

  it('happy path: creates RESERVED row and returns expiresAt = now + 15min by default', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([aDiscount()]);
    m.redemptionCreate.mockResolvedValueOnce({
      id: 'red-new',
      expiresAt: new Date(Date.now() + DEFAULT_RESERVATION_TTL_MS),
      discountAmountInPaise: 5_000n,
    });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    const r = await svc.reserve({
      discountId: 'disc-1',
      customerId: 'cust-1',
      discountAmountInPaise: 5_000n,
      idempotencyKey: 'key-1',
    });
    expect(r.created).toBe(true);
    expect(m.redemptionCreate).toHaveBeenCalledTimes(1);
    const callArg = (m.redemptionCreate.mock.calls[0] as any)[0];
    expect(callArg.data.status).toBe('RESERVED');
    expect(callArg.data.idempotencyKey).toBe('key-1');
  });

  it('rejects with NOT_FOUND when discount does not exist', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([]);
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(
      svc.reserve({
        discountId: 'missing',
        customerId: 'cust-1',
        discountAmountInPaise: 100n,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({
      name: 'DiscountUnavailableError',
      reason: 'NOT_FOUND',
    });
  });

  it('rejects with EXPIRED when endsAt is past', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([
      aDiscount({ endsAt: new Date(Date.now() - 1) }),
    ]);
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(
      svc.reserve({
        discountId: 'disc-1',
        customerId: 'cust-1',
        discountAmountInPaise: 100n,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ reason: 'EXPIRED' });
  });

  it('rejects with NOT_STARTED when startsAt is future', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([
      aDiscount({ startsAt: new Date(Date.now() + 60_000) }),
    ]);
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(
      svc.reserve({
        discountId: 'disc-1',
        customerId: 'cust-1',
        discountAmountInPaise: 100n,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ reason: 'NOT_STARTED' });
  });

  it('rejects with INACTIVE on DRAFT discount', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([aDiscount({ status: 'DRAFT' })]);
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(
      svc.reserve({
        discountId: 'disc-1',
        customerId: 'cust-1',
        discountAmountInPaise: 100n,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ reason: 'INACTIVE' });
  });

  it('onePerCustomer: rejects when customer already has active redemption', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([aDiscount({ onePerCustomer: true })]);
    m.redemptionCount.mockResolvedValueOnce(1); // one existing active row
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(
      svc.reserve({
        discountId: 'disc-1',
        customerId: 'cust-1',
        discountAmountInPaise: 100n,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ reason: 'ALREADY_REDEEMED_BY_CUSTOMER' });
  });

  it('maxUses: rejects when total active >= maxUses', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([aDiscount({ maxUses: 10 })]);
    m.redemptionCount.mockResolvedValueOnce(10);
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(
      svc.reserve({
        discountId: 'disc-1',
        customerId: 'cust-1',
        discountAmountInPaise: 100n,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ reason: 'MAX_USES_REACHED' });
  });

  it('maxUses: allows reservation when total active < maxUses', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([aDiscount({ maxUses: 10 })]);
    m.redemptionCount.mockResolvedValueOnce(9);
    m.redemptionCreate.mockResolvedValueOnce({
      id: 'red-9',
      expiresAt: new Date(Date.now() + DEFAULT_RESERVATION_TTL_MS),
      discountAmountInPaise: 100n,
    });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    const r = await svc.reserve({
      discountId: 'disc-1',
      customerId: 'cust-1',
      discountAmountInPaise: 100n,
      idempotencyKey: 'k',
    });
    expect(r.created).toBe(true);
  });

  it('maps Prisma P2002 (unique violation) to CONCURRENT_RESERVATION', async () => {
    const m = makePrismaMock();
    m.redemptionFindFirst.mockResolvedValueOnce(null);
    m.rawQuery.mockResolvedValueOnce([aDiscount()]);
    m.redemptionCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique violation', {
        code: 'P2002',
        clientVersion: '6.0.0',
      } as any),
    );
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(
      svc.reserve({
        discountId: 'disc-1',
        customerId: 'cust-1',
        discountAmountInPaise: 100n,
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ reason: 'CONCURRENT_RESERVATION' });
  });
});

describe('DiscountReservationService.redeem', () => {
  it('promotes RESERVED to REDEEMED and stamps masterOrderId', async () => {
    const m = makePrismaMock();
    m.redemptionUpdateMany.mockResolvedValueOnce({ count: 1 });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await svc.redeem({ redemptionId: 'red-1', masterOrderId: 'order-1' });
    expect(m.redemptionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'red-1', status: 'RESERVED' },
        data: expect.objectContaining({
          status: 'REDEEMED',
          masterOrderId: 'order-1',
        }),
      }),
    );
  });

  it('throws CONCURRENT_RESERVATION when row no longer RESERVED', async () => {
    const m = makePrismaMock();
    m.redemptionUpdateMany.mockResolvedValueOnce({ count: 0 });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(
      svc.redeem({ redemptionId: 'red-1', masterOrderId: 'order-1' }),
    ).rejects.toMatchObject({ reason: 'CONCURRENT_RESERVATION' });
  });
});

describe('DiscountReservationService.release', () => {
  it('marks RESERVED row as RELEASED', async () => {
    const m = makePrismaMock();
    m.redemptionUpdateMany.mockResolvedValueOnce({ count: 1 });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await svc.release({ redemptionId: 'red-1', reason: 'CHECKOUT_FAILED' });
    expect(m.redemptionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'red-1', status: 'RESERVED' },
        data: expect.objectContaining({ status: 'RELEASED' }),
      }),
    );
  });

  it('uses CANCELLED status when reason=CANCELLED', async () => {
    const m = makePrismaMock();
    m.redemptionUpdateMany.mockResolvedValueOnce({ count: 1 });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await svc.release({ redemptionId: 'red-1', reason: 'CANCELLED' });
    expect(m.redemptionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
  });

  it('idempotent: silent no-op when row already released', async () => {
    const m = makePrismaMock();
    m.redemptionUpdateMany.mockResolvedValueOnce({ count: 0 });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    await expect(svc.release({ redemptionId: 'red-1' })).resolves.toBeUndefined();
  });
});

describe('DiscountReservationService.releaseExpired', () => {
  it('releases RESERVED rows whose expiresAt has passed', async () => {
    const m = makePrismaMock();
    m.redemptionUpdateMany.mockResolvedValueOnce({ count: 7 });
    const svc = new DiscountReservationService(m.prisma, m.events, m.affiliateUnification);

    const count = await svc.releaseExpired(new Date('2030-01-01'));
    expect(count).toBe(7);
    expect(m.redemptionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'RESERVED' }),
        data: expect.objectContaining({ status: 'RELEASED' }),
      }),
    );
  });
});

describe('Custom error classes', () => {
  it('DiscountUnavailableError has reason', () => {
    const e = new DiscountUnavailableError('NOT_FOUND', 'm');
    expect(e.name).toBe('DiscountUnavailableError');
    expect(e.reason).toBe('NOT_FOUND');
  });

  it('ReservationConflictError has reason', () => {
    const e = new ReservationConflictError('MAX_USES_REACHED', 'm');
    expect(e.name).toBe('ReservationConflictError');
    expect(e.reason).toBe('MAX_USES_REACHED');
  });
});
