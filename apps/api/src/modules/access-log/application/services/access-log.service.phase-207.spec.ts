import { AccessLogService } from './access-log.service';

/**
 * Phase 207 — Access-log brute-force hardening (AUDIT #207).
 *
 * Locks in the genuine fixes:
 *   #3  record() persists the new requestId correlation column.
 *   #6  failedLoginSpikeByIp groups failures by source IP and reports a
 *       distinct-account count (credential-stuffing / spray lens).
 *   #6  failedLoginSpikeByAccount groups failures by account across IPs and
 *       reports a distinct-IP count (distributed-botnet lens).
 *   #16 requestId threads through to the create() payload.
 */
describe('AccessLogService — Phase 207', () => {
  function build(prismaOverrides: Record<string, any> = {}) {
    const accessLog = {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    };
    const user = {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma: any = { accessLog, user, ...prismaOverrides };
    const notifications: any = {
      notifyFromTemplate: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AccessLogService(prisma, notifications);
    return { service, prisma, accessLog, user };
  }

  // ── #16 — requestId correlation passthrough ───────────────────────
  it('persists requestId on the created row (#16)', async () => {
    const { service, accessLog } = build();
    await service.record({
      actorType: 'ADMIN',
      actorId: 'admin-1',
      kind: 'LOGIN_SUCCESS',
      requestId: 'req-abc-123',
    });
    expect(accessLog.create).toHaveBeenCalledTimes(1);
    expect(accessLog.create.mock.calls[0][0].data.requestId).toBe('req-abc-123');
  });

  it('defaults requestId to null when not provided (#16)', async () => {
    const { service, accessLog } = build();
    await service.record({
      actorType: 'ADMIN',
      actorId: 'admin-1',
      kind: 'LOGIN_SUCCESS',
    });
    expect(accessLog.create.mock.calls[0][0].data.requestId).toBeNull();
  });

  // ── #3 — new event kinds reach create() untouched ─────────────────
  it('records MFA_VERIFY_FAILED with succeeded=false (#3)', async () => {
    const { service, accessLog } = build();
    await service.record({
      actorType: 'ADMIN',
      actorId: 'admin-1',
      kind: 'MFA_VERIFY_FAILED',
      succeeded: false,
      reason: 'invalid_totp',
    });
    const data = accessLog.create.mock.calls[0][0].data;
    expect(data.kind).toBe('MFA_VERIFY_FAILED');
    expect(data.succeeded).toBe(false);
  });

  // ── #6 — IP-level (distributed) spike ─────────────────────────────
  describe('failedLoginSpikeByIp (#6)', () => {
    it('groups by ipAddress with a high threshold and excludes null IPs', async () => {
      const { service, accessLog } = build();
      accessLog.groupBy
        // first call: the per-IP grouped scan
        .mockResolvedValueOnce([
          {
            ipAddress: '203.0.113.9',
            _count: { _all: 42 },
            _max: { createdAt: new Date('2026-06-01T00:00:00Z') },
          },
        ])
        // second call: distinct (ip, actor) pairs
        .mockResolvedValueOnce([
          { ipAddress: '203.0.113.9', actorId: 'a1' },
          { ipAddress: '203.0.113.9', actorId: 'a2' },
          { ipAddress: '203.0.113.9', actorId: 'a3' },
        ]);

      const res = await service.failedLoginSpikeByIp({ minFailures: 20 });

      // The grouped scan must exclude null IPs and filter LOGIN_FAILURE.
      const firstWhere = accessLog.groupBy.mock.calls[0][0].where;
      expect(firstWhere.kind).toBe('LOGIN_FAILURE');
      expect(firstWhere.ipAddress).toEqual({ not: null });

      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({
        ipAddress: '203.0.113.9',
        failureCount: 42,
        distinctAccounts: 3,
      });
    });

    it('clamps minFailures to a floor of 2', async () => {
      const { service, accessLog } = build();
      accessLog.groupBy.mockResolvedValue([]);
      const res = await service.failedLoginSpikeByIp({ minFailures: 0 });
      expect(res.minFailures).toBe(2);
    });
  });

  // ── #6 — account-level (cross-IP) spike ───────────────────────────
  describe('failedLoginSpikeByAccount (#6)', () => {
    it('reports a distinct-IP count per flagged account', async () => {
      const { service, accessLog } = build();
      accessLog.groupBy
        .mockResolvedValueOnce([
          {
            actorType: 'CUSTOMER',
            actorId: 'victim-1',
            _count: { _all: 30 },
            _max: { createdAt: new Date('2026-06-01T00:00:00Z') },
          },
        ])
        .mockResolvedValueOnce([
          { actorId: 'victim-1', ipAddress: '1.1.1.1' },
          { actorId: 'victim-1', ipAddress: '2.2.2.2' },
          { actorId: 'victim-1', ipAddress: null }, // null IP must not count
        ]);

      const res = await service.failedLoginSpikeByAccount({ minFailures: 10 });
      expect(res.items[0]).toMatchObject({
        actorType: 'CUSTOMER',
        actorId: 'victim-1',
        failureCount: 30,
        distinctIps: 2,
      });
    });
  });
});
