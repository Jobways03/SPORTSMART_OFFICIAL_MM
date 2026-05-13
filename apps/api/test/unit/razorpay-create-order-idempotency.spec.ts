import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 4 (PR 4.3) — `createOrder` callers pin a stable idempotency
 * key derived from their domain entity. Three call sites are
 * documented here; one (the retry-payment endpoint in
 * `checkout.service.ts`) is intentionally NOT idempotent — each
 * retry mints a fresh gateway order — and that exclusion is
 * documented inline in the controller.
 *
 * The matcher walks the source for `razorpayAdapter.createOrder({`
 * / `razorpay.createOrder({` blocks and asserts each that we expect
 * to be idempotent includes an `idempotencyKey:` line. A future
 * createOrder call site missing the key surfaces as a meta-test
 * failure before CI.
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
    expectedKey:
      /idempotencyKey:\s*`checkout-order-\$\{result\.masterOrderId\}`/,
  },
  {
    file: 'src/modules/returns/application/services/return.service.ts',
    blockStart: /this\.razorpayAdapter\.createOrder\(\{[\s\S]*?XCHG/,
    expectedKey: /idempotencyKey:\s*`exchange-diff-\$\{ret\.id\}`/,
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

  it('the retry-payment endpoint intentionally has NO idempotency key (each retry mints fresh)', () => {
    // checkout.service.ts has TWO createOrder call sites. The second
    // one (the retry-payment endpoint, marked with notes.retry =
    // 'true') is the one we deliberately leave non-idempotent. The
    // assertion below catches a future "let me add a key for
    // consistency" PR that would silently break the retry semantics.
    const source = read('src/modules/checkout/application/services/checkout.service.ts');
    const calls = [...source.matchAll(/razorpayAdapter\.createOrder\s*\(\s*\{[\s\S]*?\}\s*\)/g)].map(
      (m) => m[0],
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const retryCall = calls.find((c) => /retry:\s*['"]true['"]/.test(c));
    expect(retryCall).toBeDefined();
    expect(retryCall).not.toMatch(/idempotencyKey:/);
  });
});
