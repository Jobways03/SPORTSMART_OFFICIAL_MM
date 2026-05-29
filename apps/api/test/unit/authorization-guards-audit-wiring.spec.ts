import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../src/core/guards/permissions.guard';
import { PolicyGuard } from '../../src/core/guards/policy.guard';
import { PolicyEvaluatorService } from '../../src/core/authorization/policy-evaluator.service';
import { POLICY_METADATA } from '../../src/core/decorators/policy.decorator';
import { PERMISSIONS_KEY } from '../../src/core/decorators/permissions.decorator';

/**
 * Phase 4 (PR 4.4) — Verify PermissionsGuard + PolicyGuard write to
 * the audit service for both ALLOW and DENY paths.
 */
describe('Authorization guards → AuthorizationAuditService wiring', () => {
  function fakeCtx(opts: {
    permissionsMeta?: string[];
    policyMeta?: { resourceType: string; action: string; context?: any };
    user?: any;
    body?: any;
    params?: any;
    method?: string;
    url?: string;
    handler?: any;
    klass?: any;
  }): ExecutionContext {
    const req = {
      user: opts.user,
      body: opts.body ?? {},
      params: opts.params ?? {},
      query: {},
      headers: { 'user-agent': 'jest' },
      method: opts.method ?? 'POST',
      url: opts.url ?? '/admin/test',
      adminId: opts.user?.id ?? null,
      // Phase 24 (2026-05-20) — sessionId needed for the
      // PermissionsGuard auto-step-up branch when a CRITICAL
      // permission is required. Stub session id matches the prisma
      // mock that returns a fresh stepUpVerifiedAt.
      sessionId: 'sess-1',
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => opts.handler ?? function handlerFn() {},
      getClass: () => opts.klass ?? class FakeCtrl {},
    } as any;
  }

  function makePermsGuard() {
    const reflector = new Reflector();
    // We mock Reflector.getAllAndOverride per-test by overriding the
    // method on a jest spy.
    const env = { getBoolean: () => false } as any; // soak mode
    const audit = { record: jest.fn() } as any;
    // PR 12.1 — Phase 13 added AuditPublicFacade as the 4th
    // constructor arg so DENY events mirror to the unified AuditLog.
    // Test cares about the dedicated authorization_audits buffer
    // (assertions on `audit.record`); a no-op facade stub is enough.
    // writeAuditLog must return a thenable — the guard chains .catch
    // on the call to swallow audit failures without breaking the
    // request path.
    const unifiedAudit = {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    } as any;
    // Phase 24 (2026-05-20) — PermissionsGuard gained PrismaService
    // as 5th constructor arg. The CRITICAL auto-step-up branch fires
    // for permissions like `wallets.adjust` (which IS CRITICAL). To
    // exercise the audit-wiring matrix without the step-up branch
    // throwing, return a fresh stepUpVerifiedAt from the session
    // stub — represents "admin recently stepped up."
    const prisma = {
      adminSession: {
        findUnique: jest.fn().mockResolvedValue({
          stepUpVerifiedAt: new Date(),
          revokedAt: null,
        }),
      },
    } as any;
    const guard = new PermissionsGuard(reflector, env, audit, unifiedAudit, prisma);
    return { guard, reflector, audit };
  }

  function makePolicyGuard(policies: any[] = [], abacEnabled = false) {
    const reflector = new Reflector();
    const evaluator = new PolicyEvaluatorService(
      {
        resourcePolicy: {
          findMany: async ({ where }: any) =>
            policies.filter(
              (p) =>
                p.resourceType === where.resourceType &&
                p.action === where.action,
            ),
        },
      } as any,
      { getBoolean: () => abacEnabled } as any,
    );
    const audit = { record: jest.fn() } as any;
    const guard = new PolicyGuard(reflector, evaluator, audit);
    return { guard, reflector, audit };
  }

  // ── PermissionsGuard ─────────────────────────────────────────────

  // Phase 24 (2026-05-20) — canActivate is async; matrix updated to
  // await + use resolves.toBe(true) so the auto-step-up branch can
  // run without throwing on the synchronous path.
  it('PermissionsGuard records ALLOW when actor has the perm', async () => {
    const { guard, reflector, audit } = makePermsGuard();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === PERMISSIONS_KEY ? ['wallets.adjust'] : undefined,
      );

    const ok = await guard.canActivate(
      fakeCtx({
        user: { id: 'a1', roles: ['SELLER_OPERATIONS'], permissions: ['wallets.adjust'] },
      }),
    );
    expect(ok).toBe(true);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: 'PERMISSIONS',
        decision: 'ALLOW',
        wouldHaveBlocked: false,
        requiredPermissions: ['wallets.adjust'],
      }),
    );
  });

  it('PermissionsGuard records would-have-blocked ALLOW in soak mode on miss', async () => {
    const { guard, reflector, audit } = makePermsGuard();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === PERMISSIONS_KEY ? ['wallets.adjust'] : undefined,
      );

    const ok = await guard.canActivate(
      fakeCtx({
        user: { id: 'a1', roles: ['CUSTOMER'], permissions: [] },
      }),
    );
    expect(ok).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: 'PERMISSIONS',
        decision: 'ALLOW',
        wouldHaveBlocked: true,
      }),
    );
  });

  // ── PolicyGuard ──────────────────────────────────────────────────

  it('PolicyGuard records ALLOW when policy matches', async () => {
    const { guard, reflector, audit } = makePolicyGuard(
      [
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
      true,
    );
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === POLICY_METADATA
          ? {
              resourceType: 'wallet',
              action: 'credit',
              context: { amountInPaise: 'body.amountInPaise' },
            }
          : undefined,
      );

    await guard.canActivate(
      fakeCtx({
        user: { id: 'a1', role: 'SELLER_OPERATIONS', permissions: [] },
        body: { amountInPaise: 500_000 },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: 'POLICY',
        decision: 'ALLOW',
        wouldHaveBlocked: false,
        matchedPolicyName: 'tier-1-cap-10k',
        resourceType: 'wallet',
        action: 'credit',
      }),
    );
  });

  it('PolicyGuard records DENY and throws when amount exceeds cap (strict)', async () => {
    const { guard, reflector, audit } = makePolicyGuard(
      [
        {
          id: 'p2',
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
      true, // strict
    );
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === POLICY_METADATA
          ? {
              resourceType: 'wallet',
              action: 'credit',
              context: { amountInPaise: 'body.amountInPaise' },
            }
          : undefined,
      );

    await expect(
      guard.canActivate(
        fakeCtx({
          user: { id: 'a1', role: 'SELLER_OPERATIONS', permissions: [] },
          body: { amountInPaise: 5_000_000 },
        }),
      ),
    ).rejects.toThrow();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: 'POLICY',
        decision: 'DENY',
        resourceType: 'wallet',
        action: 'credit',
      }),
    );
  });

  it('PolicyGuard records would-have-blocked ALLOW in soak when no policy matches', async () => {
    const { guard, reflector, audit } = makePolicyGuard([], false);
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: unknown) =>
        key === POLICY_METADATA
          ? {
              resourceType: 'wallet',
              action: 'credit',
              context: { amountInPaise: 'body.amountInPaise' },
            }
          : undefined,
      );

    const ok = await guard.canActivate(
      fakeCtx({
        user: { id: 'a1', role: 'SELLER_OPERATIONS', permissions: [] },
        body: { amountInPaise: 500 },
      }),
    );
    expect(ok).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        layer: 'POLICY',
        decision: 'ALLOW',
        wouldHaveBlocked: true,
      }),
    );
  });

  it('PolicyGuard skips work when route has no @Policy', async () => {
    const { guard, reflector, audit } = makePolicyGuard([], true);
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation(() => undefined);

    const ok = await guard.canActivate(
      fakeCtx({
        user: { id: 'a1', role: 'SELLER_OPERATIONS' },
      }),
    );
    expect(ok).toBe(true);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
