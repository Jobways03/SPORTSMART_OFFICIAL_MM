import { UnauthorizedException } from '@nestjs/common';
import { LogoutController } from './logout.controller';

/**
 * Phase 201 (#2 / #17) — logout must write an access-log row.
 *
 * Before the fix the controller revoked the session but never called
 * AccessLogService.record, so the customer's access history showed
 * every sign-IN with no matching sign-OUT.
 */
describe('LogoutController — Phase 201', () => {
  function build(revokedAll = false) {
    const logoutUseCase = {
      execute: jest.fn().mockResolvedValue({ revokedAll }),
    };
    const env = {
      getString: jest.fn().mockReturnValue(''),
      isProduction: jest.fn().mockReturnValue(false),
    };
    const accessLog = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new LogoutController(
      logoutUseCase as any,
      env as any,
      accessLog as any,
    );
    const res: any = { clearCookie: jest.fn() };
    return { controller, logoutUseCase, accessLog, res };
  }

  const req: any = {
    userId: 'user-1',
    sessionId: 'sess-1',
    socket: { remoteAddress: '1.2.3.4' },
    headers: { 'user-agent': 'Jest UA' },
  };

  it('records a LOGOUT row for a single-session sign-out', async () => {
    const { controller, accessLog, res } = build(false);
    await controller.logout(req, res, '1.2.3.4', undefined);
    expect(accessLog.record).toHaveBeenCalledTimes(1);
    const arg = accessLog.record.mock.calls[0][0];
    expect(arg).toMatchObject({
      actorType: 'CUSTOMER',
      actorId: 'user-1',
      kind: 'LOGOUT',
      ipAddress: '1.2.3.4',
      userAgent: 'Jest UA',
    });
  });

  it('records LOGOUT_ALL_DEVICES for a sign-out-everywhere (#17)', async () => {
    const { controller, accessLog, res } = build(true);
    await controller.logout(req, res, '1.2.3.4', 'true');
    expect(accessLog.record.mock.calls[0][0].kind).toBe('LOGOUT_ALL_DEVICES');
  });

  it('still returns success and clears cookies even if the audit write rejects', async () => {
    const { controller, accessLog, res } = build(false);
    accessLog.record.mockRejectedValueOnce(new Error('db down'));
    const out = await controller.logout(req, res, '1.2.3.4', undefined);
    expect(out.success).toBe(true);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('throws 401 when no session is present and does not audit', async () => {
    const { controller, accessLog, res } = build(false);
    const bad: any = { socket: {}, headers: {} };
    await expect(controller.logout(bad, res, '', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(accessLog.record).not.toHaveBeenCalled();
  });
});
