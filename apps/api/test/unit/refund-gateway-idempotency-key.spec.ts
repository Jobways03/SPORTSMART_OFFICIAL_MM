import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 4 (PR 4.2) — refund-gateway caller pins the idempotency key.
 *
 * The Razorpay adapter accepts `opts.idempotencyKey` (PR 4.2);
 * `RefundGatewayService` MUST pass a caller-stable value derived
 * from the return being refunded. A regression that removes the
 * key, or makes it non-stable (e.g. `Date.now()`), silently
 * resurrects the double-refund risk PR 4.2 closed.
 *
 * Source-scan rather than runtime-mock — the contract is single-line
 * and immediately visible in the file. A future refactor that
 * preserves the call but drops the key would fail this guard before
 * landing.
 */

const REFUND_GATEWAY_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'modules',
  'returns',
  'application',
  'services',
  'refund-gateway.service.ts',
);

describe('RefundGatewayService idempotency key (PR 4.2)', () => {
  it('initiateRefund call passes idempotencyKey: `refund-${input.returnId}`', () => {
    const source = readFileSync(REFUND_GATEWAY_PATH, 'utf8');
    // The exact template literal — caller-stable per return id.
    expect(source).toMatch(
      /idempotencyKey:\s*`refund-\$\{input\.returnId\}`/,
    );
  });

  it('there is exactly one initiateRefund call site in the service', () => {
    // If a future PR adds a second initiateRefund call (e.g. a retry
    // path), it must also pass an idempotency key — this assertion
    // forces an updated test rather than a silent omission.
    const source = readFileSync(REFUND_GATEWAY_PATH, 'utf8');
    const calls = [...source.matchAll(/razorpayAdapter\.initiateRefund\s*\(/g)];
    expect(calls.length).toBe(1);
  });

  it('the call is preceded by a comment block documenting the PR 4.2 rationale', () => {
    // Catches the "removed the comment, also removed the key" foot-gun
    // where someone tidies up "extra" comments and breaks the
    // documented contract at the same time.
    const source = readFileSync(REFUND_GATEWAY_PATH, 'utf8');
    expect(source).toMatch(/Phase 4 \(PR 4\.2\)[\s\S]*?idempotency key/);
  });
});
