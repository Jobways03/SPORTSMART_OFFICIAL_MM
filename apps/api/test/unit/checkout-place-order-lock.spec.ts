import 'reflect-metadata';
import { CheckoutService } from '../../src/modules/checkout/application/services/checkout.service';

/**
 * Regression test for the double-submit order duplication window.
 *
 * Before: placeOrder() read the checkout session, ran placeOrderTransaction,
 * then deleted the session. Two concurrent calls (double-click UI / client
 * retry) both read the session, both ran placeOrderTransaction, and both
 * committed separate MasterOrders. The second-arriving call's
 * confirmReservation() later threw — but by then the orphan order row
 * already existed.
 *
 * After: placeOrder() acquires a per-user Redis lock (SET NX with TTL) for
 * the full duration. A concurrent second call fails fast with a specific
 * BadRequest and never touches the repo.
 */

describe('CheckoutService.placeOrder — per-user concurrency lock', () => {
  const buildDeps = (lockAcquired: boolean) => {
    const redis: any = {
      acquireLock: jest.fn().mockResolvedValue(lockAcquired),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    const sessionService: any = {
      get: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    };
    const repo: any = {
      placeOrderTransaction: jest.fn(),
    };
    // PR 12.1 — CheckoutService grew from 8 to 17 deps. Order
    // mirrors src/.../checkout.service.ts:
    //   1 repo, 2 sessionService, 3 catalogFacade, 4 franchiseFacade,
    //   5 discountFacade, 6 shippingOptionsFacade,
    //   7 discountReservation, 8 discountAllocation,
    //   9 affiliateFacade, 10 walletFacade, 11 paymentOpsFacade,
    //   12 razorpayAdapter, 13 prisma, 14 eventBus, 15 redis,
    //   16 env, 17 moneyDualWrite.
    // Lock-test only exercises redis + sessionService + repo, so
    // everything else is a no-op stub.
    const env: any = { getBoolean: () => false, getNumber: () => 0 };
    const noop: any = {};
    const svc = new CheckoutService(
      repo,             // 1
      sessionService,   // 2
      noop,             // 3 catalogFacade
      noop,             // 4 franchiseFacade
      noop,             // 5 discountFacade
      noop,             // 6 shippingOptionsFacade
      noop,             // 7 discountReservation
      noop,             // 8 discountAllocation
      noop,             // 9 affiliateFacade
      noop,             // 10 walletFacade
      noop,             // 11 paymentOpsFacade
      noop,             // 12 razorpayAdapter
      noop,             // 13 prisma
      noop,             // 14 eventBus
      redis,            // 15 redis
      env,              // 16 env
      noop,             // 17 moneyDualWrite
    );
    return { svc, redis, sessionService, repo };
  };

  it('acquires a per-user lock before touching the session', async () => {
    const { svc, redis, sessionService } = buildDeps(true);

    await expect(svc.placeOrder('user-1', 'COD')).rejects.toThrow();

    // Lock should have been taken with the user-scoped key.
    expect(redis.acquireLock).toHaveBeenCalledWith(
      'lock:checkout:place-order:user-1',
      expect.any(Number),
    );
    // Only reads the session AFTER acquiring the lock (acquireLock < sessionService.get).
    const acquireCallOrder = redis.acquireLock.mock.invocationCallOrder[0];
    const getCallOrder = sessionService.get.mock.invocationCallOrder[0];
    expect(acquireCallOrder).toBeLessThan(getCallOrder);
  });

  it('fails fast when another placement is already in progress', async () => {
    const { svc, sessionService, repo } = buildDeps(false);

    await expect(svc.placeOrder('user-1', 'COD')).rejects.toThrow(
      /Another order placement is in progress/,
    );

    // Critical: must NOT reach session read or order transaction.
    expect(sessionService.get).not.toHaveBeenCalled();
    expect(repo.placeOrderTransaction).not.toHaveBeenCalled();
  });

  it('always releases the lock on failure', async () => {
    const { svc, redis } = buildDeps(true);

    await expect(svc.placeOrder('user-1', 'COD')).rejects.toThrow(); // session returns null → error thrown

    expect(redis.releaseLock).toHaveBeenCalledWith(
      'lock:checkout:place-order:user-1',
    );
  });
});
