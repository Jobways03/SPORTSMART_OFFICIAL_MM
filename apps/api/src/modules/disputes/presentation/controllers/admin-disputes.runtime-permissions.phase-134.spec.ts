// Phase 134 — body-dependent RBAC on the admin disputes controller:
//   - posting an internal note needs disputes.internalNote
//   - a high-value decision (amount ≥ threshold) needs disputes.decide.high_value
// Both are runtime + soak-aware: strict mode 403s a missing permission; soak
// mode logs + allows. The route-level guards (disputes.reply / disputes.decide)
// are unaffected and not exercised here (no guard in a direct handler call).

import { AdminDisputesController } from './admin-disputes.controller';

const THRESHOLD = 5_000_000; // ₹50,000

function build(strict: boolean) {
  const service = {
    reply: jest.fn().mockResolvedValue({ id: 'm-1' }),
    decide: jest.fn().mockResolvedValue({ id: 'd-1' }),
  };
  const prisma = {
    admin: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Admin', email: 'a@x.com' }),
    },
  };
  const env = {
    getBoolean: jest.fn().mockReturnValue(strict), // PERMISSIONS_GUARD_STRICT
    getNumber: jest.fn().mockReturnValue(THRESHOLD),
  };
  const authzMode = { isStrict: () => strict };
  const ctrl = new AdminDisputesController(
    service as any,
    prisma as any,
    env as any,
    authzMode as any,
  );
  return { ctrl, service };
}

const req = (permissions: string[]) => ({ adminId: 'a-1', user: { permissions } });
const decideBody = (amountInPaise: number) => ({
  outcome: 'RESOLVED_BUYER',
  rationale: 'agreed',
  amountInPaise,
  liabilityParty: 'SELLER',
  customerRemedy: 'FULL_REFUND',
});

describe('AdminDisputesController — internal-note permission (Phase 134)', () => {
  it('strict: blocks an internal note without disputes.internalNote', async () => {
    const { ctrl, service } = build(true);
    await expect(
      ctrl.reply(req(['disputes.reply']) as any, 'd-1', {
        body: 'triage',
        isInternalNote: true,
      } as any),
    ).rejects.toThrow();
    expect(service.reply).not.toHaveBeenCalled();
  });

  it('soak: allows the same internal note through (logged, not blocked)', async () => {
    const { ctrl, service } = build(false);
    await ctrl.reply(req(['disputes.reply']) as any, 'd-1', {
      body: 'triage',
      isInternalNote: true,
    } as any);
    expect(service.reply).toHaveBeenCalled();
  });

  it('strict: allows an internal note when the actor holds disputes.internalNote', async () => {
    const { ctrl, service } = build(true);
    await ctrl.reply(req(['disputes.internalNote']) as any, 'd-1', {
      body: 'triage',
      isInternalNote: true,
    } as any);
    expect(service.reply).toHaveBeenCalled();
  });

  it('strict: a customer-visible reply is never gated by internalNote', async () => {
    const { ctrl, service } = build(true);
    await ctrl.reply(req([]) as any, 'd-1', {
      body: 'hello',
      isInternalNote: false,
    } as any);
    expect(service.reply).toHaveBeenCalled();
  });
});

describe('AdminDisputesController — high-value decision permission (Phase 134)', () => {
  it('strict: blocks a high-value decision without disputes.decide.high_value', async () => {
    const { ctrl, service } = build(true);
    await expect(
      ctrl.decide(req(['disputes.decide']) as any, 'd-1', decideBody(THRESHOLD) as any),
    ).rejects.toThrow();
    expect(service.decide).not.toHaveBeenCalled();
  });

  it('soak: allows the same high-value decision through', async () => {
    const { ctrl, service } = build(false);
    await ctrl.decide(req(['disputes.decide']) as any, 'd-1', decideBody(THRESHOLD) as any);
    expect(service.decide).toHaveBeenCalled();
  });

  it('strict: a below-threshold decision is never gated by high_value', async () => {
    const { ctrl, service } = build(true);
    await ctrl.decide(
      req(['disputes.decide']) as any,
      'd-1',
      decideBody(THRESHOLD - 1) as any,
    );
    expect(service.decide).toHaveBeenCalled();
  });

  it('strict: allows a high-value decision when the actor holds disputes.decide.high_value', async () => {
    const { ctrl, service } = build(true);
    await ctrl.decide(
      req(['disputes.decide', 'disputes.decide.high_value']) as any,
      'd-1',
      decideBody(THRESHOLD * 2) as any,
    );
    expect(service.decide).toHaveBeenCalled();
  });
});
