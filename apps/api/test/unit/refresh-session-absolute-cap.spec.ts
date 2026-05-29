import 'reflect-metadata';
import { RefreshSessionUseCase } from '../../src/modules/identity/application/use-cases/refresh-session.use-case';

/**
 * Phase 17 (2026-05-20) — RefreshSessionUseCase: absolute session
 * lifetime cap.
 *
 * Before this PR, refresh-rotation slid `expiresAt = now +
 * JWT_REFRESH_TTL` forward on every refresh, so a daily-active
 * session lived forever. This test pins the new behaviour: past
 * SESSION_ABSOLUTE_LIFETIME_DAYS from Session.createdAt, the use
 * case refuses to rotate and revokes the row.
 */

describe('RefreshSessionUseCase — absolute lifetime cap', () => {
  const makeSvc = (sessionOverrides: Partial<any> = {}) => {
    const session = {
      id: 'sess-1',
      userId: 'u-1',
      refreshToken: 'hash',
      previousRefreshTokenHash: null,
      userAgent: null,
      ipAddress: null,
      expiresAt: new Date(Date.now() + 60_000), // not refresh-expired
      revokedAt: null,
      createdAt: new Date(),
      ...sessionOverrides,
    };
    const sessionRepo: any = {
      findByRefreshToken: jest.fn().mockResolvedValue(session),
      findByPreviousRefreshToken: jest.fn().mockResolvedValue(null),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
      rotateRefreshToken: jest.fn().mockResolvedValue({
        ...session,
        refreshToken: 'new-hash',
      }),
    };
    const userRepo: any = {
      findById: jest.fn().mockResolvedValue({
        id: 'u-1',
        email: 'a@b.com',
        status: 'ACTIVE',
        roleAssignments: [{ role: { name: 'CUSTOMER' } }],
      }),
    };
    const envService: any = {
      getString: (k: string, d: string) =>
        k === 'JWT_CUSTOMER_SECRET' ? 'x'.repeat(32) : d ?? '15m',
      getNumber: (_k: string, d: number) => d,
      getOptional: () => undefined,
    };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    return {
      svc: new RefreshSessionUseCase(userRepo, sessionRepo, envService, logger),
      sessionRepo,
    };
  };

  it('rotates normally for a young session', async () => {
    const { svc, sessionRepo } = makeSvc({
      createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5d old
    });
    const out = await svc.execute({ refreshToken: 'raw' });
    expect(out.accessToken).toBeTruthy();
    expect(sessionRepo.rotateRefreshToken).toHaveBeenCalled();
    expect(sessionRepo.revoke).not.toHaveBeenCalled();
  });

  it('revokes + refuses for a session older than the absolute cap', async () => {
    const { svc, sessionRepo } = makeSvc({
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90d old, cap is 60d
    });
    await expect(svc.execute({ refreshToken: 'raw' })).rejects.toThrow(
      /maximum lifetime/i,
    );
    expect(sessionRepo.revoke).toHaveBeenCalledWith('sess-1');
    expect(sessionRepo.rotateRefreshToken).not.toHaveBeenCalled();
  });
});
