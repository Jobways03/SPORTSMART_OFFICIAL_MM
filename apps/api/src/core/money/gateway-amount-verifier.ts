import { BadRequestAppException } from '../exceptions';

/**
 * Phase 0 (PR 0.1) — silent-money-loss guard.
 *
 * Razorpay's HMAC signature proves a (razorpay_order_id, payment_id) pair
 * was emitted by Razorpay. It does NOT prove the captured AMOUNT matches
 * the order total. A hostile client (or replayed webhook) can submit a
 * tiny payment id against a large order with a valid signature and the
 * platform would still flip the order to PAID.
 *
 * This helper centralises the post-signature amount/state checks so both
 * the verify-payment endpoint and the webhook handler enforce the same
 * contract. It is pure (no I/O, no side effects beyond throwing) so it
 * is trivial to unit-test and to call from inside a Prisma `$transaction`.
 *
 * The four assertions are intentionally separate `throw` sites so the
 * thrown error's `code` and message identify exactly which invariant
 * failed. Callers should additionally record a `PaymentMismatchAlert` for
 * AMOUNT_MISMATCH so finance ops can investigate; the alerting itself
 * does not belong here because it requires DB access.
 */
export interface GatewayPaymentSnapshot {
  /** Razorpay-side amount in paise (Razorpay's API speaks paise natively). */
  amount: number | bigint;
  /** Razorpay-side payment lifecycle status; capture-complete is `'captured'`. */
  status: string;
  /** Razorpay-side capture boolean. */
  captured: boolean;
  /** Razorpay order id the payment is attached to. */
  order_id: string;
}

export interface ExpectedOrder {
  /** Platform-side expected total, in paise. */
  totalAmountInPaise: bigint;
  /** Platform-side razorpay_order_id created at checkout. */
  razorpayOrderId: string;
}

/**
 * Compares a Razorpay payment snapshot (from `razorpayClient.fetchPayment`
 * or from a verified webhook payload) against the platform's expected
 * order state. Throws `BadRequestAppException` with a stable error code
 * on any mismatch.
 *
 * The caller is responsible for any side effects (logging, audit row,
 * `PaymentMismatchAlert`). This function intentionally has none — it is
 * pure so unit tests don't need any mocks.
 */
export function assertGatewayPaymentMatchesOrder(
  payment: GatewayPaymentSnapshot,
  expected: ExpectedOrder,
): void {
  // 1. The payment must actually be captured at the gateway side. A
  // signature on an `authorized` (held) payment is valid but money has
  // NOT moved yet — flipping the order to PAID would be premature.
  if (!payment.captured || payment.status !== 'captured') {
    throw new BadRequestAppException(
      `Payment is not yet captured at gateway (status=${payment.status}, captured=${payment.captured})`,
      'GATEWAY_PAYMENT_NOT_CAPTURED',
    );
  }

  // 2. The payment must reference the same razorpay_order_id we minted.
  // Razorpay allows a single payment_id to be re-used across orders
  // in pathological flows; this prevents a payment for a different
  // (perhaps smaller) order being submitted against this one.
  if (payment.order_id !== expected.razorpayOrderId) {
    throw new BadRequestAppException(
      `Payment order_id mismatch: gateway=${payment.order_id}, expected=${expected.razorpayOrderId}`,
      'GATEWAY_ORDER_ID_MISMATCH',
    );
  }

  // 3. The amount must match exactly — both sides speak paise; there is
  // no rounding step that should produce drift. Coerce to BigInt so we
  // safely handle Razorpay's `number` field for very large totals (a JS
  // number loses precision above 2^53 paise ≈ ₹90,072 cr).
  const gatewayPaise = BigInt(payment.amount);
  if (gatewayPaise !== expected.totalAmountInPaise) {
    throw new BadRequestAppException(
      `Payment amount mismatch: gateway=${gatewayPaise} paise, expected=${expected.totalAmountInPaise} paise`,
      'GATEWAY_AMOUNT_MISMATCH',
    );
  }
}
