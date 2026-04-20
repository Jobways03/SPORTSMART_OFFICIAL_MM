import { RefreshSessionUseCase } from '../../src/modules/identity/application/use-cases/refresh-session.use-case';
import {
  UnauthorizedAppException,
  ForbiddenAppException,
} from '../../src/core/exceptions';

/**
 * Unit tests for the customer refresh-session flow.
 *
 * Verifies the auth state machine:
 * - Empty / unknown / revoked / expired tokens are rejected
 * - Inactive accounts have their session auto-revoked
 * - Successful refresh rotates the refresh token and returns a new
 *   access token
 *
 * Mocks the user / session repositories so the test stays in pure-logic
 * territory and doesn't need a database.
 */

const makeFakeRepos = () => {
  const sessionRepo = {
    findByRefreshToken: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revoke: jest.fn(),
  } as any;
  const userRepo = {
    findById: jest.fn(),
  } as any;
  return { sessionRepo, userRepo };
};

const fakeEnv = {
  getString: (key: string, fallback?: string) => {
    switch (key) {
      case 'JWT_REFRESH_TTL':
        return '30d';
      case 'JWT_ACCESS_TTL':
        return '7d';
      case 'JWT_CUSTOMER_SECRET':
        return 'unit-test-customer-secret-min16-chars';
      default:
        return fallback ?? '';
    }
  },
} as any;

const fakeLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
} as any;

const buildUseCase = () => {
  const { sessionRepo, userRepo } = makeFakeRepos();
  const useCase = new RefreshSessionUseCase(
    userRepo,
    sessionRepo,
    fakeEnv,
    fakeLogger,
  );
  return { useCase, sessionRepo, userRepo };
};

describe('RefreshSessionUseCase', () => {
  it('rejects an empty refresh token', async () => {
    const { useCase } = buildUseCase();
    await expect(useCase.execute({ refreshToken: '' })).rejects.toThrow(
      UnauthorizedAppException,
    );
  });

  it('rejects an unknown refresh token', async () => {
    const { useCase, sessionRepo } = buildUseCase();
    sessionRepo.findByRefreshToken.mockResolvedValue(null);

    await expect(
      useCase.execute({ refreshToken: 'never-issued' }),
    ).rejects.toThrow('Invalid refresh token');
  });

  it('rejects a revoked session', async () => {
    const { useCase, sessionRepo } = buildUseCase();
    sessionRepo.findByRefreshToken.mockResolvedValue({
      id: 'sess1',
      userId: 'user1',
      refreshToken: 'rt1',
      revokedAt: new Date('2020-01-01'),
      expiresAt: new Date('2099-01-01'),
    });

    await expect(useCase.execute({ refreshToken: 'rt1' })).rejects.toThrow(
      'Session has been revoked',
    );
  });

  it('rejects an expired session', async () => {
    const { useCase, sessionRepo } = buildUseCase();
    sessionRepo.findByRefreshToken.mockResolvedValue({
      id: 'sess1',
      userId: 'user1',
      refreshToken: 'rt1',
      revokedAt: null,
      expiresAt: new Date('2020-01-01'),
    });

    await expect(useCase.execute({ refreshToken: 'rt1' })).rejects.toThrow(
      'Refresh token expired',
    );
  });

  it('auto-revokes session and rejects when user no longer exists', async () => {
    const { useCase, sessionRepo, userRepo } = buildUseCase();
    sessionRepo.findByRefreshToken.mockResolvedValue({
      id: 'sess1',
      userId: 'ghost',
      refreshToken: 'rt1',
      revokedAt: null,
      expiresAt: new Date('2099-01-01'),
    });
    userRepo.findById.mockResolvedValue(null);

    await expect(useCase.execute({ refreshToken: 'rt1' })).rejects.toThrow(
      'User not found',
    );
    expect(sessionRepo.revoke).toHaveBeenCalledWith('sess1');
  });

  it('auto-revokes session and rejects when user is INACTIVE', async () => {
    const { useCase, sessionRepo, userRepo } = buildUseCase();
    sessionRepo.findByRefreshToken.mockResolvedValue({
      id: 'sess1',
      userId: 'user1',
      refreshToken: 'rt1',
      revokedAt: null,
      expiresAt: new Date('2099-01-01'),
    });
    userRepo.findById.mockResolvedValue({
      id: 'user1',
      email: 'a@b.c',
      status: 'SUSPENDED',
      roleAssignments: [],
    });

    await expect(useCase.execute({ refreshToken: 'rt1' })).rejects.toThrow(
      ForbiddenAppException,
    );
    expect(sessionRepo.revoke).toHaveBeenCalledWith('sess1');
  });

  it('rotates the refresh token and returns a new access token on success', async () => {
    const { useCase, sessionRepo, userRepo } = buildUseCase();
    sessionRepo.findByRefreshToken.mockResolvedValue({
      id: 'sess1',
      userId: 'user1',
      refreshToken: 'rt1',
      revokedAt: null,
      expiresAt: new Date('2099-01-01'),
    });
    userRepo.findById.mockResolvedValue({
      id: 'user1',
      email: 'a@b.c',
      status: 'ACTIVE',
      roleAssignments: [{ role: { name: 'CUSTOMER' } }],
    });
    sessionRepo.rotateRefreshToken.mockResolvedValue({});

    const result = await useCase.execute({ refreshToken: 'rt1' });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.refreshToken).not.toBe('rt1'); // rotation happened
    expect(result.expiresIn).toBeGreaterThan(0);
    expect(sessionRepo.rotateRefreshToken).toHaveBeenCalledTimes(1);
    const [sessionId, newToken] = sessionRepo.rotateRefreshToken.mock.calls[0];
    expect(sessionId).toBe('sess1');
    expect(newToken).toBe(result.refreshToken);
  });
});
