import 'reflect-metadata';
import {
  PolicyEvaluatorService,
  type PolicyActor,
} from '../../src/core/authorization/policy-evaluator.service';

/**
 * Phase 4 (PR 4.3) — PolicyEvaluatorService.
 *
 * Builds a fake PrismaService + EnvService so we can exercise the
 * priority-ordering, principal-matching, and strict-vs-soak modes
 * without spinning up the real DB. Each test seeds `policies` directly
 * on the fake — no schema reach-throughs.
 */

type FakePolicy = {
  id: string;
  name: string;
  effect: 'ALLOW' | 'DENY';
  principalType: 'ROLE' | 'PERMISSION' | 'CUSTOM_ROLE' | 'ANY';
  principalKey: string;
  resourceType: string;
  action: string;
  conditions: Record<string, unknown> | null;
  priority: number;
};

function makeEvaluator(opts: {
  policies: FakePolicy[];
  abacEnabled?: boolean;
}): PolicyEvaluatorService {
  const fakePrisma = {
    resourcePolicy: {
      findMany: async ({ where }: any) =>
        opts.policies.filter(
          (p) =>
            p.resourceType === where.resourceType &&
            p.action === where.action &&
            (where.enabled === undefined || true),
        ),
    },
  } as any;

  const fakeEnv = {
    getBoolean: (_key: string, _fallback?: boolean) => !!opts.abacEnabled,
  } as any;

  return new PolicyEvaluatorService(fakePrisma, fakeEnv);
}

const baseActor: PolicyActor = {
  adminId: 'admin-1',
  role: 'SELLER_OPERATIONS',
  customRoles: [],
  permissions: ['wallets.adjust'],
};

describe('PolicyEvaluatorService', () => {
  it('returns ALLOW (no-match, soak) when no policies are seeded', async () => {
    const ev = makeEvaluator({ policies: [], abacEnabled: false });
    const d = await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: { amountInPaise: 100 },
    });
    expect(d.decision).toBe('ALLOW');
    expect(d.matched).toBe(false);
  });

  it('returns DENY when ABAC strict and no policy matches', async () => {
    const ev = makeEvaluator({ policies: [], abacEnabled: true });
    const d = await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: { amountInPaise: 100 },
    });
    expect(d.decision).toBe('DENY');
    expect(d.matched).toBe(false);
  });

  it('Tier-1 cap: ₹10k allows ₹500, denies ₹50,000 via missing match', async () => {
    const ev = makeEvaluator({
      abacEnabled: true,
      policies: [
        {
          id: 'p1',
          name: 'tier-1-cap-10k',
          effect: 'ALLOW',
          principalType: 'ROLE',
          principalKey: 'SELLER_OPERATIONS',
          resourceType: 'wallet',
          action: 'credit',
          conditions: { amountInPaise: { $lte: 1_000_000 } },
          priority: 100,
        },
      ],
    });

    const allowed = await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: { amountInPaise: 500_00 },
    });
    expect(allowed.decision).toBe('ALLOW');
    expect(allowed.matched).toBe(true);
    expect(allowed.matchedPolicyName).toBe('tier-1-cap-10k');

    const denied = await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: { amountInPaise: 5_000_000 },
    });
    expect(denied.decision).toBe('DENY');
    expect(denied.matched).toBe(false);
  });

  it('higher-priority DENY beats lower-priority ALLOW', async () => {
    const ev = makeEvaluator({
      abacEnabled: true,
      policies: [
        {
          id: 'allow',
          name: 'allow-tier1',
          effect: 'ALLOW',
          principalType: 'ROLE',
          principalKey: 'SELLER_OPERATIONS',
          resourceType: 'wallet',
          action: 'credit',
          conditions: null,
          priority: 100,
        },
        {
          id: 'deny',
          name: 'deny-after-hours',
          effect: 'DENY',
          principalType: 'ROLE',
          principalKey: 'SELLER_OPERATIONS',
          resourceType: 'wallet',
          action: 'credit',
          conditions: { afterHours: true },
          priority: 200,
        },
      ],
    });

    const d = await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: { afterHours: true },
    });
    expect(d.decision).toBe('DENY');
    expect(d.matchedPolicyName).toBe('deny-after-hours');
  });

  it('PERMISSION principal matches by membership in actor.permissions', async () => {
    const ev = makeEvaluator({
      abacEnabled: true,
      policies: [
        {
          id: 'p',
          name: 'perm-grant',
          effect: 'ALLOW',
          principalType: 'PERMISSION',
          principalKey: 'wallets.adjust',
          resourceType: 'wallet',
          action: 'credit',
          conditions: null,
          priority: 100,
        },
      ],
    });
    const d = await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: {},
    });
    expect(d.decision).toBe('ALLOW');
    expect(d.matched).toBe(true);
  });

  it('CUSTOM_ROLE principal matches against actor.customRoles', async () => {
    const ev = makeEvaluator({
      abacEnabled: true,
      policies: [
        {
          id: 'p',
          name: 'finops-special',
          effect: 'ALLOW',
          principalType: 'CUSTOM_ROLE',
          principalKey: 'FINOPS',
          resourceType: 'wallet',
          action: 'credit',
          conditions: null,
          priority: 100,
        },
      ],
    });
    const finopsActor: PolicyActor = {
      ...baseActor,
      customRoles: ['FINOPS'],
    };
    const d = await ev.evaluate({
      actor: finopsActor,
      resourceType: 'wallet',
      action: 'credit',
      context: {},
    });
    expect(d.decision).toBe('ALLOW');
  });

  it('ANY principal matches every actor', async () => {
    const ev = makeEvaluator({
      abacEnabled: true,
      policies: [
        {
          id: 'p',
          name: 'platform-cap',
          effect: 'DENY',
          principalType: 'ANY',
          principalKey: '*',
          resourceType: 'wallet',
          action: 'credit',
          conditions: { amountInPaise: { $gt: 10_000_000 } }, // ₹100k hard cap
          priority: 999,
        },
      ],
    });
    const d = await ev.evaluate({
      actor: { ...baseActor, role: 'SUPER_ADMIN' },
      resourceType: 'wallet',
      action: 'credit',
      context: { amountInPaise: 20_000_000 },
    });
    expect(d.decision).toBe('DENY');
  });

  it('caches policy lookups across calls in the 60s window', async () => {
    let calls = 0;
    const fakePrisma = {
      resourcePolicy: {
        findMany: async () => {
          calls += 1;
          return [];
        },
      },
    } as any;
    const fakeEnv = { getBoolean: () => false } as any;
    const ev = new PolicyEvaluatorService(fakePrisma, fakeEnv);

    await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: {},
    });
    await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: {},
    });
    expect(calls).toBe(1);

    ev.invalidate();
    await ev.evaluate({
      actor: baseActor,
      resourceType: 'wallet',
      action: 'credit',
      context: {},
    });
    expect(calls).toBe(2);
  });
});
