import 'reflect-metadata';
import { RefreshFranchiseSessionUseCase } from '../../src/modules/franchise/application/use-cases/refresh-franchise-session.use-case';

/**
 * Phase 20 (2026-05-20) — RefreshFranchiseSessionUseCase gate tests.
 *
 * Pins the parity with login: refresh must enforce the same
 * isEmailVerified gate that login does. Without this test, an admin
 * could flip a franchise back to unverified and they'd keep refreshing
 * indefinitely on the existing session.
 *
 * Also covers the existing gates so future edits cannot weaken them:
 *   • Missing token → 401.
 *   • Token-reuse detection (burned slot) → revoke + 401.
 *   • Revoked / expired session → 401.
 *   • Franchise not found → 401 + revoke.
 *   • SUSPENDED / DEACTIVATED → 403 + revoke.
 *   • isEmailVerified=false → 403 EMAIL_NOT_VERIFIED + revoke (NEW Phase 20).
 *   • Happy path → rotates token, returns new access JWT.
 */

describe('RefreshFranchiseSessionUseCase', () => {
  const buildUseCase = (overrides: Partial<any> = {}) => {
    const franchiseRepo = {
      findSessionByRefreshToken: jest.fn(),
      findSessionByPreviousRefreshToken: jest.fn().mockResolvedValue(null),
      revokeAllSessions: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      rotateSession: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as any;
    const envService = {
      getString: (k: string, d?: string) => {
        if (k === 'JWT_FRANCHISE_SECRET') return 'x'.repeat(32);
        if (k === 'JWT_ACCESS_TTL') return d ?? '7d';
        if (k === 'JWT_REFRESH_TTL') return d ?? '30d';
        return d ?? '';
      },
    } as any;
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as any;
    return {
      useCase: new RefreshFranchiseSessionUseCase(
        franchiseRepo,
        envService,
        logger,
      ),
      franchiseRepo,
    };
  };

  const session = (overrides: Partial<any> = {}) => ({
    id: 'sess-1',
    franchisePartnerId: 'f-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  });

  const fr = (overrides: Partial<any> = {}) => ({
    id: 'f-1',
    email: 'a@b.com',
    status: 'ACTIVE',
    isEmailVerified: true,
    ...overrides,
  });

  it('missing refresh token → 401', async () => {
    const { useCase } = buildUseCase();
    await expect(useCase.execute({ refreshToken: '' })).rejects.toThrow(
      /required/i,
    );
  });

  it('unknown token + no burned hit → 401 invalid', async () => {
    const { useCase } = buildUseCase({
      findSessionByRefreshToken: jest.fn().mockResolvedValue(null),
      findSessionByPreviousRefreshToken: jest.fn().mockResolvedValue(null),
    });
    await expect(useCase.execute({ refreshToken: 'x' })).rejects.toThrow(
      /Invalid refresh token/,
    );
  });

  it('burned-slot hit (token reuse) → revoke + 401', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      findSessionByRefreshToken: jest.fn().mockResolvedValue(null),
      findSessionByPreviousRefreshToken: jest
        .fn()
        .mockResolvedValue({ franchisePartnerId: 'f-1' }),
    });
    await expect(useCase.execute({ refreshToken: 'x' })).rejects.toThrow(
      /Session security check failed/,
    );
    expect(franchiseRepo.revokeAllSessions).toHaveBeenCalledWith('f-1');
  });

  it('revoked session → 401', async () => {
    const { useCase } = buildUseCase({
      findSessionByRefreshToken: jest
        .fn()
        .mockResolvedValue(session({ revokedAt: new Date() })),
    });
    await expect(useCase.execute({ refreshToken: 'x' })).rejects.toThrow(
      /Session has been revoked/,
    );
  });

  it('expired session → 401', async () => {
    const { useCase } = buildUseCase({
      findSessionByRefreshToken: jest.fn().mockResolvedValue(
        session({
          expiresAt: new Date(Date.now() - 5 * 60_000),
        }),
      ),
    });
    await expect(useCase.execute({ refreshToken: 'x' })).rejects.toThrow(
      /Refresh token expired/,
    );
  });

  it('franchise not found → revoke + 401', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      findSessionByRefreshToken: jest.fn().mockResolvedValue(session()),
      findById: jest.fn().mockResolvedValue(null),
    });
    await expect(useCase.execute({ refreshToken: 'x' })).rejects.toThrow(
      /not found/i,
    );
    expect(franchiseRepo.revokeAllSessions).toHaveBeenCalledWith('f-1');
  });

  it('SUSPENDED → revoke + 403', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      findSessionByRefreshToken: jest.fn().mockResolvedValue(session()),
      findById: jest.fn().mockResolvedValue(fr({ status: 'SUSPENDED' })),
    });
    await expect(useCase.execute({ refreshToken: 'x' })).rejects.toThrow(
      /suspended or deactivated/i,
    );
    expect(franchiseRepo.revokeAllSessions).toHaveBeenCalledWith('f-1');
  });

  it('DEACTIVATED → revoke + 403', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      findSessionByRefreshToken: jest.fn().mockResolvedValue(session()),
      findById: jest.fn().mockResolvedValue(fr({ status: 'DEACTIVATED' })),
    });
    await expect(useCase.execute({ refreshToken: 'x' })).rejects.toThrow(
      /suspended or deactivated/i,
    );
    expect(franchiseRepo.revokeAllSessions).toHaveBeenCalledWith('f-1');
  });

  // The critical Phase 20 addition.
  it('isEmailVerified=false → 403 EMAIL_NOT_VERIFIED + revoke all sessions', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      findSessionByRefreshToken: jest.fn().mockResolvedValue(session()),
      findById: jest.fn().mockResolvedValue(fr({ isEmailVerified: false })),
    });
    try {
      await useCase.execute({ refreshToken: 'x' });
      fail('Expected throw');
    } catch (err: any) {
      expect(err.code).toBe('EMAIL_NOT_VERIFIED');
    }
    expect(franchiseRepo.revokeAllSessions).toHaveBeenCalledWith('f-1');
  });

  it('happy path: rotates session + returns new access JWT', async () => {
    const { useCase, franchiseRepo } = buildUseCase({
      findSessionByRefreshToken: jest.fn().mockResolvedValue(session()),
      findById: jest.fn().mockResolvedValue(fr()),
    });
    const out = await useCase.execute({ refreshToken: 'old' });
    expect(out.accessToken).toBeTruthy();
    expect(out.refreshToken).toBeTruthy();
    expect(out.refreshToken).not.toBe('old');
    expect(out.franchisePartnerId).toBe('f-1');
    expect(franchiseRepo.rotateSession).toHaveBeenCalled();
    expect(franchiseRepo.revokeAllSessions).not.toHaveBeenCalled();
  });
});
