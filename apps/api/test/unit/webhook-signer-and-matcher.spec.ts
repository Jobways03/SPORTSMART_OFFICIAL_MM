import 'reflect-metadata';
import { signPayload, verifyPayload } from '../../src/core/webhooks/webhook-signer';
import { matchesSubscription } from '../../src/core/webhooks/webhook-delivery.service';

/**
 * Phase 10 (PR 10.2) — Webhook signer + subscription matcher.
 *
 * The signer must produce the exact `t=<n>,v1=<hex>` shape we
 * document for partners; the matcher must respect both exact and
 * `prefix.*` subscriptions plus the empty-list = all rule.
 */
describe('webhook-signer', () => {
  it('produces a t=<unix>,v1=<hex> header value', () => {
    const out = signPayload(
      '{"hello":"world"}',
      'shh-secret',
      new Date('2026-05-06T00:00:00Z'),
    );
    expect(out.timestamp).toBe(1778025600);
    expect(out.value).toMatch(/^t=1778025600,v1=[a-f0-9]{64}$/);
  });

  it('different bodies produce different signatures', () => {
    const a = signPayload('{"a":1}', 's', new Date(0));
    const b = signPayload('{"a":2}', 's', new Date(0));
    expect(a.signature).not.toBe(b.signature);
  });

  it('different secrets produce different signatures', () => {
    const a = signPayload('{"a":1}', 's1', new Date(0));
    const b = signPayload('{"a":1}', 's2', new Date(0));
    expect(a.signature).not.toBe(b.signature);
  });

  it('verifyPayload accepts a fresh signature', () => {
    const ts = Date.now();
    const signed = signPayload('{"x":1}', 'k', new Date(ts));
    expect(verifyPayload('{"x":1}', signed.value, 'k', 300, ts)).toBe(true);
  });

  it('verifyPayload rejects a tampered body', () => {
    const ts = Date.now();
    const signed = signPayload('{"x":1}', 'k', new Date(ts));
    expect(verifyPayload('{"x":2}', signed.value, 'k', 300, ts)).toBe(false);
  });

  it('verifyPayload rejects beyond tolerance window', () => {
    const ts = Date.now() - 10 * 60 * 1000; // 10 min ago
    const signed = signPayload('{"x":1}', 'k', new Date(ts));
    expect(
      verifyPayload('{"x":1}', signed.value, 'k', 300, Date.now()),
    ).toBe(false);
  });

  it('verifyPayload rejects a wrong secret', () => {
    const ts = Date.now();
    const signed = signPayload('{"x":1}', 'right', new Date(ts));
    expect(verifyPayload('{"x":1}', signed.value, 'wrong', 300, ts)).toBe(false);
  });
});

describe('matchesSubscription', () => {
  it('empty subscription list = subscribe to all', () => {
    expect(matchesSubscription([], 'returns.return.requested')).toBe(true);
  });

  it('exact match', () => {
    expect(
      matchesSubscription(
        ['returns.return.requested'],
        'returns.return.requested',
      ),
    ).toBe(true);
    expect(
      matchesSubscription(
        ['returns.return.requested'],
        'returns.return.approved',
      ),
    ).toBe(false);
  });

  it('wildcard prefix.*', () => {
    expect(matchesSubscription(['returns.*'], 'returns.return.approved')).toBe(true);
    expect(matchesSubscription(['returns.*'], 'disputes.opened')).toBe(false);
  });

  it('top-level wildcard *', () => {
    expect(matchesSubscription(['*'], 'anything.at.all')).toBe(true);
  });
});
