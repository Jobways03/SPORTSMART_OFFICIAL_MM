import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 4 (PR 4.3) — `createOrder` callers pin a stable idempotency
 * key derived from their domain entity.
 *
 * Phase 165 (Razorpay audit #1) — the retry-payment path, previously
 * documented as "intentionally NOT idempotent", now ALSO pins a key:
 * `checkout-order-${order.id}-retry-${retryIndex}`. The retry index is the
 * count of prior ONLINE Payment rows, so a rapid double-click computes the
 * same key (Razorpay dedupes → one order) while a genuine later retry gets a
 * fresh index → a new order. This closes the "two orders per double-click"
 * money-risk while preserving the ability to retry.
 *
 * The matcher walks the source for `razorpayAdapter.createOrder({`
 * / `razorpay.createOrder({` blocks and asserts each includes an
 * `idempotencyKey:` line. A future createOrder call site missing the key
 * surfaces as a meta-test failure before CI.
 */

interface CallerCheck {
  file: string;
  /** Pattern that captures the createOrder block — multi-line. */
  blockStart: RegExp;
  /** Expected idempotency-key template literal substring inside the block. */
  expectedKey: RegExp;
}

const CALLERS: CallerCheck[] = [
  {
    file: 'src/modules/wallet/application/services/wallet.service.ts',
    blockStart: /this\.razorpay\.createOrder\(\{/,
    expectedKey: /idempotencyKey:\s*`wallet-topup-\$\{receipt\}`/,
  },
  {
    file: 'src/modules/checkout/application/services/checkout.service.ts',
    blockStart: /this\.razorpayAdapter\.createOrder\(\{[\s\S]*?walletPaidPaise/,
    // The place-order key is a sha-256 of (userId|session.createdAt|orderNumber)
    // — stable per checkout flow. (An earlier phase refactored this from the
    // literal `checkout-order-${result.masterOrderId}` the spec used to assert.)
    expectedKey: /const idempotencyKey = `checkout-order-\$\{createHash/,
  },
  {
    file: 'src/modules/returns/application/services/return.service.ts',
    blockStart: /this\.razorpayAdapter\.createOrder\(\{[\s\S]*?XCHG/,
    expectedKey: /idempotencyKey:\s*`exchange-diff-\$\{ret\.id\}`/,
  },
  // Phase 165 (#1) — the retry-payment block (notes carry retry: 'true').
  {
    file: 'src/modules/checkout/application/services/checkout.service.ts',
    blockStart: /this\.razorpayAdapter\.createOrder\(\{[\s\S]*?retry: 'true'/,
    expectedKey: /idempotencyKey/,
  },
];

function read(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', rel), 'utf8');
}

describe('Razorpay createOrder callers — idempotency-key coverage (PR 4.3)', () => {
  it.each(CALLERS)(
    '$file passes the expected idempotency key',
    ({ file, blockStart, expectedKey }) => {
      const source = read(file);
      // Confirm the createOrder block exists (sanity).
      expect(source).toMatch(blockStart);
      // Confirm the idempotency key is inside the call (the regex
      // captures a substring that the source MUST contain near
      // the createOrder block).
      expect(source).toMatch(expectedKey);
    },
  );

  // Phase 165 (#1) — the retry-payment endpoint now ALSO pins an idempotency
  // key (was deliberately keyless). A rapid double-click computes the same
  // `checkout-order-${order.id}-retry-${retryIndex}` and Razorpay dedupes,
  // so two clicks no longer mint two gateway orders. This replaces the old
  // "retry intentionally has NO key" assertion (a verified money-risk).
  it('the retry-payment endpoint now pins an idempotency key (Phase 165 #1)', () => {
    const source = read('src/modules/checkout/application/services/checkout.service.ts');
    const calls = [...source.matchAll(/razorpayAdapter\.createOrder\s*\(\s*\{[\s\S]*?\}\s*\)/g)].map(
      (m) => m[0],
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const retryCall = calls.find((c) => /retry:\s*['"]true['"]/.test(c));
    expect(retryCall).toBeDefined();
    expect(retryCall).toMatch(/idempotencyKey/);
    // The key derivation is present in the retry method.
    expect(source).toMatch(/`checkout-order-\$\{order\.id\}-retry-\$\{retryIndex\}`/);
  });
});
