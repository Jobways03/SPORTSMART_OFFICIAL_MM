import { AccessLogService } from './access-log.service';

/**
 * Phase 201 — Customer Access History remediation (AUDIT #201).
 *
 * Locks in the genuine fixes:
 *   #1  listForCustomer hard-whitelists customer-safe columns and never
 *       emits deviceHash / reason / actorRole / metadata.
 *   #5  deviceHash / networkPrefix is IP-family aware (IPv6 → /64).
 *   #9  a LOGIN_FAILURE whose email matches a user is stored under that
 *       user's id (with the email tucked into metadata.attemptedEmail).
 *   #10 a new-device LOGIN_SUCCESS sets metadata.newDevice=true on the
 *       success row and writes NO second NEW_DEVICE_DETECTED row.
 *   #14 a LOGIN_SUCCESS resets failedLoginAttempts / lockUntil.
 *   #7  the lock-only backstop never increments failedLoginAttempts.
 */
describe('AccessLogService — Phase 201', () => {
  function build(prismaOverrides: Record<string, any> = {}) {
    const accessLog = {
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const user = {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma: any = { accessLog, user, ...prismaOverrides };
    const notifications: any = {
      notifyFromTemplate: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AccessLogService(prisma, notifications);
    return { service, prisma, accessLog, user, notifications };
  }

  // ── #5 — IPv6-aware device hashing ────────────────────────────────
  describe('networkPrefix (#5)', () => {
    it('keeps the first 3 octets of an IPv4 address (/24)', () => {
      expect(AccessLogService.networkPrefix('203.0.113.45')).toBe('203.0.113');
    });

    it('truncates an IPv6 address to the first 4 hextets (/64)', () => {
      expect(
        AccessLogService.networkPrefix('2001:0db8:85a3:0000:1111:2222:3333:4444'),
      ).toBe('2001:0db8:85a3:0000');
    });

    it('strips an IPv6 zone id before truncating', () => {
      expect(AccessLogService.networkPrefix('fe80::1%eth0')).toBe('fe80::');
    });

    it('two IPv6 addresses in the same /64 hash to the SAME device', () => {
      // Regression for the NEW_DEVICE spam: rotating IPv6 host suffix
      // must NOT look like a new device.
      const a = AccessLogService.deviceHash('UA', '2001:db8:abcd:1::a1b2');
      const b = AccessLogService.deviceHash('UA', '2001:db8:abcd:1::ffff');
      expect(a).toBe(b);
    });

    it('different /64 networks DO hash to different devices', () => {
      const a = AccessLogService.deviceHash('UA', '2001:db8:abcd:1::1');
      const b = AccessLogService.deviceHash('UA', '2001:db8:abcd:2::1');
      expect(a).not.toBe(b);
    });
  });

  // ── #1 — customer-safe projection ─────────────────────────────────
  describe('listForCustomer (#1)', () => {
    it('selects ONLY the customer-safe columns (no deviceHash/reason/metadata in select)', async () => {
      const { service, accessLog } = build();
      await service.listForCustomer({ actorId: 'user-1', limit: 10 });
      const arg = accessLog.findMany.mock.calls[0][0];
      expect(arg.select).toEqual({
        id: true,
        kind: true,
        ipAddress: true,
        userAgent: true,
        succeeded: true,
        createdAt: true,
        metadata: true,
      });
      // The unsafe columns must never be requested.
      expect(arg.select.deviceHash).toBeUndefined();
      expect(arg.select.reason).toBeUndefined();
      expect(arg.select.actorRole).toBeUndefined();
      expect(arg.where).toEqual({ actorType: 'CUSTOMER', actorId: 'user-1' });
    });

    it('derives newDevice boolean and drops the raw metadata blob', async () => {
      const { service, accessLog } = build();
      accessLog.findMany.mockResolvedValueOnce([
        {
          id: 'r1',
          kind: 'LOGIN_SUCCESS',
          ipAddress: '1.2.3.4',
          userAgent: 'UA',
          succeeded: true,
          createdAt: new Date('2026-06-01T00:00:00Z'),
          metadata: { newDevice: true, attemptedEmail: 'leak@x.com' },
        },
      ]);
      const out = await service.listForCustomer({ actorId: 'user-1' });
      const first = out[0]!;
      expect(first.newDevice).toBe(true);
      // attemptedEmail / metadata must NOT survive to the wire shape.
      expect(first as any).not.toHaveProperty('metadata');
      expect(first as any).not.toHaveProperty('attemptedEmail');
      expect(Object.keys(first).sort()).toEqual(
        ['createdAt', 'id', 'ipAddress', 'kind', 'newDevice', 'succeeded', 'userAgent'].sort(),
      );
    });

    it('clamps limit into [1, 500]', async () => {
      const { service, accessLog } = build();
      await service.listForCustomer({ actorId: 'u', limit: 99999 });
      expect(accessLog.findMany.mock.calls[0][0].take).toBe(500);
      await service.listForCustomer({ actorId: 'u', limit: 0 });
      expect(accessLog.findMany.mock.calls[1][0].take).toBe(1);
    });
  });

  // ── #9 — failed-login attributed to the matched user ──────────────
  describe('record() LOGIN_FAILURE email attribution (#9)', () => {
    it('stores actorId=user.id and stashes attemptedEmail when the email matches a user', async () => {
      const { service, accessLog, user } = build();
      user.findUnique.mockResolvedValueOnce({ id: 'user-42' });
      await service.record({
        actorType: 'CUSTOMER',
        actorId: 'victim@example.com',
        kind: 'LOGIN_FAILURE',
        ipAddress: '9.9.9.9',
        succeeded: false,
        reason: 'Invalid email or password',
      });
      const created = accessLog.create.mock.calls[0][0].data;
      expect(created.actorId).toBe('user-42');
      expect(created.metadata).toMatchObject({ attemptedEmail: 'victim@example.com' });
    });

    it('falls back to the email as actorId when no user matches', async () => {
      const { service, accessLog, user } = build();
      user.findUnique.mockResolvedValueOnce(null);
      await service.record({
        actorType: 'CUSTOMER',
        actorId: 'ghost@example.com',
        kind: 'LOGIN_FAILURE',
        ipAddress: '9.9.9.9',
        succeeded: false,
      });
      expect(accessLog.create.mock.calls[0][0].data.actorId).toBe('ghost@example.com');
    });
  });

  // ── #7 — lock-only backstop never increments the counter ──────────
  describe('record() lock-only backstop (#7)', () => {
    it('stamps lockUntil WITHOUT touching failedLoginAttempts past the threshold', async () => {
      const { service, accessLog, user } = build();
      user.findUnique.mockResolvedValueOnce({ id: 'user-7' });
      // 5 prior failures in the window from this IP → lock.
      accessLog.count.mockResolvedValueOnce(5);
      await service.record({
        actorType: 'CUSTOMER',
        actorId: 'user@example.com',
        kind: 'LOGIN_FAILURE',
        ipAddress: '5.5.5.5',
        succeeded: false,
      });
      expect(user.updateMany).toHaveBeenCalledTimes(1);
      const data = user.updateMany.mock.calls[0][0].data;
      expect(data.lockUntil).toBeInstanceOf(Date);
      // The canonical counter is owned by the login use-case — never
      // incremented here.
      expect(data).not.toHaveProperty('failedLoginAttempts');
    });

    it('does not lock below the threshold', async () => {
      const { service, accessLog, user } = build();
      user.findUnique.mockResolvedValueOnce({ id: 'user-7' });
      accessLog.count.mockResolvedValueOnce(2);
      await service.record({
        actorType: 'CUSTOMER',
        actorId: 'user@example.com',
        kind: 'LOGIN_FAILURE',
        ipAddress: '5.5.5.5',
        succeeded: false,
      });
      expect(user.updateMany).not.toHaveBeenCalled();
    });
  });

  // ── #10 + #14 — success row carries newDevice, no dup row, resets counter
  describe('record() LOGIN_SUCCESS (#10/#14)', () => {
    it('flags newDevice on the success row and writes NO NEW_DEVICE_DETECTED row', async () => {
      const { service, accessLog, notifications } = build();
      accessLog.count.mockResolvedValueOnce(0); // never seen this device
      await service.record({
        actorType: 'CUSTOMER',
        actorId: 'user-1',
        kind: 'LOGIN_SUCCESS',
        ipAddress: '1.2.3.4',
      });
      // Exactly ONE accessLog.create — the success row. No second insert.
      expect(accessLog.create).toHaveBeenCalledTimes(1);
      const created = accessLog.create.mock.calls[0][0].data;
      expect(created.kind).toBe('LOGIN_SUCCESS');
      expect(created.metadata).toMatchObject({ newDevice: true });
      // The security email still fires.
      expect(notifications.notifyFromTemplate).toHaveBeenCalledTimes(1);
    });

    it('does not flag newDevice for a known device', async () => {
      const { service, accessLog, notifications } = build();
      accessLog.count.mockResolvedValueOnce(3); // seen before
      await service.record({
        actorType: 'CUSTOMER',
        actorId: 'user-1',
        kind: 'LOGIN_SUCCESS',
        ipAddress: '1.2.3.4',
      });
      const created = accessLog.create.mock.calls[0][0].data;
      expect(created.metadata?.newDevice).toBeUndefined();
      expect(notifications.notifyFromTemplate).not.toHaveBeenCalled();
    });

    it('resets failedLoginAttempts + lockUntil on success (#14)', async () => {
      const { service, user } = build();
      await service.record({
        actorType: 'CUSTOMER',
        actorId: 'user-1',
        kind: 'LOGIN_SUCCESS',
        ipAddress: '1.2.3.4',
      });
      const call = user.updateMany.mock.calls.find(
        (c: any[]) => c[0]?.data?.failedLoginAttempts === 0,
      );
      expect(call).toBeTruthy();
      expect(call[0].data).toEqual({ failedLoginAttempts: 0, lockUntil: null });
    });
  });
});
