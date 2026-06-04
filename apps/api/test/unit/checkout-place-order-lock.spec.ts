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
    // CheckoutService now takes 26 ctor deps. Order mirrors
    // src/.../checkout.service.ts constructor exactly:
    //   1 repo, 2 sessionService, 3 catalogFacade, 4 franchiseFacade,
    //   5 commissionFacade, 6 discountFacade, 7 shippingOptionsFacade,
    //   8 discountReservation, 9 discountAllocation, 10 taxSnapshot,
    //   11 taxPreview, 12 taxFacade, 13 affiliateFacade, 14 walletFacade,
    //   15 paymentOpsFacade, 16 razorpayAdapter, 17 razorpayClient,
    //   18 codRuleEngine, 19 prisma, 20 eventBus, 21 redis, 22 env,
    //   23 moneyDualWrite, 24 stockRestore, 25 auditFacade,
    //   26 paymentLifecycle.
    // Lock-test only exercises redis + sessionService + repo, so
    // everything else is a no-op stub.
    const env: any = { getBoolean: () => false, getNumber: () => 0 };
    const noop: any = {};
    const svc = new CheckoutService(
      repo,             // 1 repo
      sessionService,   // 2 sessionService
      noop,             // 3 catalogFacade
      noop,             // 4 franchiseFacade
      noop,             // 5 commissionFacade
      noop,             // 6 discountFacade
      noop,             // 7 shippingOptionsFacade
      noop,             // 8 discountReservation
      noop,             // 9 discountAllocation
      noop,             // 10 taxSnapshot
      noop,             // 11 taxPreview
      noop,             // 12 taxFacade
      noop,             // 13 affiliateFacade
      noop,             // 14 walletFacade
      noop,             // 15 paymentOpsFacade
      noop,             // 16 razorpayAdapter
      noop,             // 17 razorpayClient
      noop,             // 18 codRuleEngine
      noop,             // 19 prisma
      noop,             // 20 eventBus
      redis,            // 21 redis
      env,              // 22 env
      noop,             // 23 moneyDualWrite
      noop,             // 24 stockRestore
      noop,             // 25 auditFacade
      noop,             // 26 paymentLifecycle
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
