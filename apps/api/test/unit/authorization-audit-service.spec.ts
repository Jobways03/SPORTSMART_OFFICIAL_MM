import 'reflect-metadata';
import { AuthorizationAuditService } from '../../src/core/authorization/authorization-audit.service';

/**
 * Phase 4 (PR 4.4) — AuthorizationAuditService.
 *
 * Verifies:
 *   - When AUTHZ_AUDIT_ENABLED=false, no rows are buffered or written.
 *   - Buffered rows flush on the timer (we drain microtasks instead of
 *     waiting wall-clock).
 *   - Buffer flushes immediately when it crosses HARD_BUFFER_LIMIT.
 *   - A failing DB write is logged and dropped (does not throw).
 *   - onModuleDestroy drains the buffer.
 */
describe('AuthorizationAuditService', () => {
  function setup(opts: {
    enabled?: boolean;
    failWrite?: boolean;
  } = {}) {
    const writes: any[] = [];
    const fakePrisma: any = {
      authorizationAudit: {
        createMany: jest.fn(async ({ data }: any) => {
          if (opts.failWrite) throw new Error('boom');
          writes.push(...data);
          return { count: data.length };
        }),
      },
    };
    const fakeEnv: any = {
      getBoolean: () => opts.enabled !== false,
    };
    // PR 12.1 — AuthorizationAuditService gained a MetricsRegistry
    // dependency (flush counter + flush-failure counter, lazy-init in
    // onModuleInit). Pass-through stub that returns minimal handles so
    // both counters can register and inc without throwing.
    const counterHandle = { inc: jest.fn(), value: () => 0 } as any;
    const fakeMetrics: any = {
      counter: jest.fn(() => counterHandle),
    };
    // PR 12.x — record() now gates on AuthzModeService.isAuditEnabled()
    // (the effective env-OR-runtime-override flag), not env directly.
    // Drive it from the same `enabled` option so the AUTHZ_AUDIT_ENABLED
    // =false case still records nothing.
    const fakeAuthzMode: any = {
      isAuditEnabled: () => opts.enabled !== false,
    };
    const svc = new AuthorizationAuditService(
      fakePrisma,
      fakeEnv,
      fakeMetrics,
      fakeAuthzMode,
    );
    return { svc, writes, fakePrisma };
  }

  const sampleEntry = {
    layer: 'PERMISSIONS' as const,
    decision: 'ALLOW' as const,
    wouldHaveBlocked: false,
    routeLabel: 'AdminWalletController.creditWallet',
    adminId: 'a1',
    actorRole: 'SELLER_OPERATIONS',
    requiredPermissions: ['wallets.adjust'],
  };

  it('does nothing when AUTHZ_AUDIT_ENABLED=false', async () => {
    const { svc, writes } = setup({ enabled: false });
    svc.record(sampleEntry);
    await svc.flush();
    expect(writes).toHaveLength(0);
  });

  it('flush writes the buffered rows', async () => {
    const { svc, writes } = setup();
    svc.record(sampleEntry);
    svc.record({ ...sampleEntry, decision: 'DENY', wouldHaveBlocked: false });
    await svc.flush();
    expect(writes).toHaveLength(2);
    expect(writes[0].decision).toBe('ALLOW');
    expect(writes[1].decision).toBe('DENY');
  });

  it('writes context as JsonNull when entry.context is null', async () => {
    const { svc, writes } = setup();
    svc.record({ ...sampleEntry, context: null });
    await svc.flush();
    // We can't introspect Prisma.JsonNull directly here — just
    // verify the write happened and the field is present.
    expect(writes).toHaveLength(1);
    expect('context' in writes[0]).toBe(true);
  });

  it('flushes immediately when buffer crosses the hard limit', async () => {
    const { svc, fakePrisma } = setup();
    for (let i = 0; i < 600; i++) svc.record(sampleEntry);
    // Allow microtask to settle (HARD_BUFFER_LIMIT triggers void this.flush())
    await new Promise((r) => setImmediate(r));
    expect((fakePrisma.authorizationAudit.createMany as any).mock.calls.length)
      .toBeGreaterThanOrEqual(1);
  });

  it('logs and drops on failed DB write — does not throw', async () => {
    const { svc } = setup({ failWrite: true });
    svc.record(sampleEntry);
    await expect(svc.flush()).resolves.toBeUndefined();
  });

  it('onModuleDestroy drains the buffer', async () => {
    const { svc, writes } = setup();
    svc.record(sampleEntry);
    await svc.onModuleDestroy();
    expect(writes).toHaveLength(1);
  });

  it('flush is a no-op when buffer is empty', async () => {
    const { svc, fakePrisma } = setup();
    await svc.flush();
    expect((fakePrisma.authorizationAudit.createMany as any).mock.calls.length)
      .toBe(0);
  });
});
