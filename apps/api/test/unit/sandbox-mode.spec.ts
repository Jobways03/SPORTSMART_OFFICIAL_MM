import 'reflect-metadata';
import { SandboxModeService } from '../../src/core/sandbox/sandbox-mode.service';

/**
 * Phase 10 (PR 10.3) — Sandbox helpers.
 *
 * Pin the boundary check (isTest) and the assertLiveOnly guardrail.
 * Bug here = either real money moves on a test request (very bad)
 * or test requests can't run their normal flow (annoying).
 */
describe('SandboxModeService', () => {
  const svc = new SandboxModeService();

  it('isTest returns true for TEST-environment keys', () => {
    expect(svc.isTest({ apiKey: { environment: 'TEST' } })).toBe(true);
  });

  it('isTest returns false for LIVE keys', () => {
    expect(svc.isTest({ apiKey: { environment: 'LIVE' } })).toBe(false);
  });

  it('isTest returns false when no key on request', () => {
    expect(svc.isTest({})).toBe(false);
  });

  it('assertLiveOnly throws on TEST', () => {
    expect(() =>
      svc.assertLiveOnly({ apiKey: { environment: 'TEST' } }, 'send-real-email'),
    ).toThrow(/LIVE-only/);
  });

  it('assertLiveOnly is a no-op on LIVE', () => {
    expect(() =>
      svc.assertLiveOnly({ apiKey: { environment: 'LIVE' } }, 'send-real-email'),
    ).not.toThrow();
  });

  it('fakeRefundId is deterministic for the same seed', () => {
    expect(svc.fakeRefundId('r1')).toBe(svc.fakeRefundId('r1'));
    expect(svc.fakeRefundId('r1')).not.toBe(svc.fakeRefundId('r2'));
  });

  it('fakeRefundId carries the rfd_test_ prefix', () => {
    expect(svc.fakeRefundId('seed')).toMatch(/^rfd_test_[a-f0-9]+$/);
  });

  it('fakeRefundResponse echoes refund id + amount and marks test=true', () => {
    const r = svc.fakeRefundResponse({
      refundId: 'r1',
      amountInPaise: 12345,
    });
    expect(r.test).toBe(true);
    expect(r.amountInPaise).toBe(12345);
    expect(r.status).toBe('SUCCEEDED');
    expect(r.gatewayRefundId).toMatch(/^gw_test_/);
  });
});
