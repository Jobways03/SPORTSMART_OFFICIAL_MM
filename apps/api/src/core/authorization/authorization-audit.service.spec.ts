import 'reflect-metadata';
import { AuthorizationAuditService } from './authorization-audit.service';
import { MetricsRegistry } from '../metrics/metrics.registry';

/**
 * PR 4.6 — flush-failure observability.
 *
 * Asserts:
 *  - A flush DB error doesn't propagate to the caller (request must
 *    survive an audit-table outage).
 *  - The dropped-row counter advances by the size of the dropped batch.
 *  - The flush-failure counter advances by 1 per failure.
 */
describe('AuthorizationAuditService — flush failure observability', () => {
  function build(opts: { failFlush: boolean; auditEnabled: boolean }) {
    const prisma = {
      authorizationAudit: {
        createMany: jest.fn().mockImplementation(async () => {
          if (opts.failFlush) throw new Error('connection terminated');
          return { count: 1 };
        }),
      },
    } as any;
    const env = {
      getBoolean: (k: string, fb: boolean) =>
        k === 'AUTHZ_AUDIT_ENABLED' ? opts.auditEnabled : fb,
    } as any;
    const metrics = new MetricsRegistry();
    const authzMode = {
      isAuditEnabled: () => opts.auditEnabled,
      isStrict: () => false,
      isAbacEnabled: () => false,
    } as any;
    const service = new AuthorizationAuditService(prisma, env, metrics, authzMode);
    service.onModuleInit();
    return { service, prisma, metrics };
  }

  function pushEntry(service: AuthorizationAuditService, n = 1) {
    for (let i = 0; i < n; i++) {
      service.record({
        layer: 'PERMISSIONS' as any,
        decision: 'ALLOW' as any,
        wouldHaveBlocked: false,
        routeLabel: 'TestController.test',
      });
    }
  }

  it('survives a flush failure without throwing to the caller', async () => {
    const { service } = build({ failFlush: true, auditEnabled: true });
    pushEntry(service, 3);
    await expect(service.flush()).resolves.toBeUndefined();
  });

  it('increments dropped-row counter by batch size on flush failure', async () => {
    const { service } = build({ failFlush: true, auditEnabled: true });
    expect(service.getDroppedRowCount()).toBe(0);

    pushEntry(service, 4);
    await service.flush();
    expect(service.getDroppedRowCount()).toBe(4);

    pushEntry(service, 2);
    await service.flush();
    expect(service.getDroppedRowCount()).toBe(6);
  });

  it('does not increment dropped counter on success', async () => {
    const { service } = build({ failFlush: false, auditEnabled: true });
    pushEntry(service, 5);
    await service.flush();
    expect(service.getDroppedRowCount()).toBe(0);
  });

  it('skips persistence when AUTHZ_AUDIT_ENABLED=false', async () => {
    const { service, prisma } = build({ failFlush: false, auditEnabled: false });
    pushEntry(service, 3);
    await service.flush();
    expect(prisma.authorizationAudit.createMany).not.toHaveBeenCalled();
  });
});
