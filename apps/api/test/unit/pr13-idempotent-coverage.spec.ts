import 'reflect-metadata';
import { IDEMPOTENT_KEY } from '../../src/core/decorators/idempotent.decorator';
import { CheckoutController } from '../../src/modules/checkout/controllers/checkout.controller';
import { WalletController } from '../../src/modules/wallet/presentation/controllers/wallet.controller';
import { AdminPaymentsController } from '../../src/modules/payments/presentation/controllers/admin-payments.controller';
import { AdminPayoutController } from '../../src/modules/payouts/admin-payout.controller';
import { AdminWalletController } from '../../src/modules/wallet/presentation/controllers/admin-wallet.controller';

/**
 * Phase 1 (PR 1.3) — every money-moving endpoint must carry
 * `@Idempotent()`. The interceptor reads `IDEMPOTENT_KEY` metadata
 * via Reflector; if the decorator is missing, the route silently
 * skips dedup. This spec pins the metadata so a future refactor
 * can't accidentally drop the decorator off a money endpoint.
 *
 * AdminRefundApprovalsController is intentionally excluded from the
 * imports here because its `approve` handler transitively pulls in
 * the refund saga which pre-existing Prisma drift complicates
 * (tracked in Phase 2). The decorator is still applied on the
 * controller — verified by a separate metadata check below that
 * doesn't require instantiating the class.
 */

function hasIdempotent(target: unknown, methodName: string): boolean {
  return (
    Reflect.getMetadata(IDEMPOTENT_KEY, (target as any).prototype[methodName]) === true
  );
}

describe('PR 1.3 — @Idempotent coverage on money-moving endpoints', () => {
  // ── checkout ───────────────────────────────────────────────────────

  it('CheckoutController.placeOrder is decorated', () => {
    expect(hasIdempotent(CheckoutController, 'placeOrder')).toBe(true);
  });

  it('CheckoutController.verifyPayment is decorated', () => {
    expect(hasIdempotent(CheckoutController, 'verifyPayment')).toBe(true);
  });

  it('CheckoutController.retryPayment is NOT decorated (creates fresh Razorpay order each call — by design)', () => {
    // retryPayment is intentionally non-idempotent: each call creates
    // a new Razorpay order. This guard catches an accidental
    // decoration that would prevent the customer from resubmitting
    // after their previous Razorpay order expired.
    expect(hasIdempotent(CheckoutController, 'retryPayment')).toBe(false);
  });

  // ── wallet (customer) ──────────────────────────────────────────────

  it('WalletController.initiateTopup is decorated', () => {
    expect(hasIdempotent(WalletController, 'initiateTopup')).toBe(true);
  });

  it('WalletController.verifyTopup is decorated', () => {
    expect(hasIdempotent(WalletController, 'verifyTopup')).toBe(true);
  });

  // ── admin: payments markPaid ───────────────────────────────────────

  it('AdminPaymentsController.markPaid is decorated', () => {
    expect(hasIdempotent(AdminPaymentsController, 'markPaid')).toBe(true);
  });

  // ── admin: payouts ─────────────────────────────────────────────────

  it('AdminPayoutController.create is decorated', () => {
    expect(hasIdempotent(AdminPayoutController, 'create')).toBe(true);
  });

  it('AdminPayoutController.ingest is decorated', () => {
    expect(hasIdempotent(AdminPayoutController, 'ingest')).toBe(true);
  });

  // ── admin: wallet adjustments ──────────────────────────────────────

  it('AdminWalletController.creditWallet is decorated', () => {
    expect(hasIdempotent(AdminWalletController, 'creditWallet')).toBe(true);
  });

  it('AdminWalletController.debitWallet is decorated', () => {
    expect(hasIdempotent(AdminWalletController, 'debitWallet')).toBe(true);
  });

  // ── admin: refund approvals (metadata-only check, no instantiation) ──

  it('AdminRefundApprovalsController.approve carries @Idempotent metadata', () => {
    // Lazy require so we don't pull the full module's Prisma chain
    // into the rest of the spec. The metadata-only check works
    // because reflect-metadata records decorators at class-evaluation
    // time, not at instantiation.
    const mod = require('../../src/modules/refund-instructions/presentation/controllers/admin-refund-approvals.controller');
    const ctor = mod.AdminRefundApprovalsController;
    expect(
      Reflect.getMetadata(IDEMPOTENT_KEY, ctor.prototype.approve),
    ).toBe(true);
  });

  it('AdminRefundApprovalsController.reject carries @Idempotent metadata', () => {
    const mod = require('../../src/modules/refund-instructions/presentation/controllers/admin-refund-approvals.controller');
    const ctor = mod.AdminRefundApprovalsController;
    expect(
      Reflect.getMetadata(IDEMPOTENT_KEY, ctor.prototype.reject),
    ).toBe(true);
  });
});
