import { RefreshSessionUseCase } from './refresh-session.use-case';
import { SessionRepository } from '../../domain/repositories/session.repository';

/**
 * Phase 3 (PR 3.6) — refresh-token reuse detection.
 *
 * Pre-PR the refresh flow rotated the token (PR 3.2 hashed at rest)
 * but did not detect REUSE of a now-rotated-away token. Threat:
 *
 *   1. Attacker steals refresh-token R from the legitimate user.
 *   2. Attacker hits /auth/refresh first → server rotates to R'
 *      (DB row now stores hash(R'); R is gone).
 *   3. Legitimate user later hits /auth/refresh with R.
 *   4. Pre-PR: lookup misses, server returns "invalid refresh token".
 *      Attacker keeps using R'. The user is silently locked out of
 *      their own refresh path but the attacker's session lives on.
 *
 * PR 3.6 adds a "previous-hash" slot per session row. On rotate, the
 * current hash is moved to that slot before the new hash overwrites
 * the current. A lookup that hits the previous-hash slot (and ONLY
 * the previous-hash slot) means a now-burned refresh token is being
 * replayed — the legitimate user, the attacker, or both. The right
 * response is to assume compromise and revoke all sessions for that
 * user. The legitimate user re-logs in (small inconvenience); the
 * attacker is locked out (the actual goal).
 *
 * Tests below pin the contract by mocking the repo. The repo-level
 * tests for the new `findByPreviousRefreshToken` + `rotateRefreshToken`
 * stash-then-write are in
 * `prisma-session.refresh-token-reuse.spec.ts`.
 */

const noopLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const envServiceStub = {
  getString: (k: string) => {
    const map: Record<string, string> = {
      JWT_REFRESH_TTL: '30d',
      JWT_ACCESS_TTL: '1h',
      JWT_CUSTOMER_SECRET: 'c'.repeat(32),
    };
    return map[k] ?? '';
  },
} as any;

function buildRepo(overrides: Partial<SessionRepository> = {}): jest.Mocked<SessionRepository> {
  return {
    findById: jest.fn(),
    findByUserId: jest.fn().mockResolvedValue([]),
    findByRefreshToken: jest.fn().mockResolvedValue(null),
    findByPreviousRefreshToken: jest.fn().mockResolvedValue(null),
    save: jest.fn(),
    revoke: jest.fn().mockResolvedValue(undefined),
    createSession: jest.fn(),
    rotateRefreshToken: jest.fn(),
    revokeAllUserSessions: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as jest.Mocked<SessionRepository>;
}

function buildUserRepo(user: any = null) {
  return {
    findById: jest.fn().mockResolvedValue(user),
  } as any;
}

describe('RefreshSessionUseCase — token reuse detection (PR 3.6)', () => {
  const activeUser = {
    id: 'u-1',
    email: 'u@example.com',
    status: 'ACTIVE',
    roleAssignments: [{ role: { name: 'CUSTOMER' } }],
  };

  it('happy path — current refresh token matches: rotates normally, previous-slot lookup is NOT invoked', async () => {
    const sessionRepo = buildRepo({
      findByRefreshToken: jest.fn().mockResolvedValue({
        id: 's-1',
        userId: 'u-1',
        refreshToken: 'hashed',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400_000),
      } as any),
      rotateRefreshToken: jest.fn().mockResolvedValue({} as any),
    });
    const userRepo = buildUserRepo(activeUser);

    const uc = new RefreshSessionUseCase(userRepo, sessionRepo, envServiceStub, noopLogger);
    const result = await uc.execute({ refreshToken: 'raw-current' });

    expect(result.accessToken).toBeTruthy();
    expect(sessionRepo.findByRefreshToken).toHaveBeenCalledTimes(1);
    // No reuse detected → previous-slot lookup never fires.
    expect(sessionRepo.findByPreviousRefreshToken).not.toHaveBeenCalled();
    expect(sessionRepo.revokeAllUserSessions).not.toHaveBeenCalled();
    // Normal rotation still happened.
    expect(sessionRepo.rotateRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('reuse detected — token matches previous-slot only: revokes ALL sessions for that user and throws', async () => {
    const sessionRepo = buildRepo({
      findByRefreshToken: jest.fn().mockResolvedValue(null),
      findByPreviousRefreshToken: jest.fn().mockResolvedValue({
        id: 's-1',
        userId: 'u-1',
        refreshToken: 'hashed-new',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400_000),
      } as any),
    });
    const userRepo = buildUserRepo(activeUser);

    const uc = new RefreshSessionUseCase(userRepo, sessionRepo, envServiceStub, noopLogger);

    await expect(uc.execute({ refreshToken: 'raw-burned' })).rejects.toThrow(
      /reuse detected|invalidated for security/i,
    );

    expect(sessionRepo.revokeAllUserSessions).toHaveBeenCalledWith('u-1');
    // The new token must NOT be issued on the theft path.
    expect(sessionRepo.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('unknown token — matches neither current nor previous: rejects with generic invalid-token error (no extra DB writes)', async () => {
    const sessionRepo = buildRepo({
      findByRefreshToken: jest.fn().mockResolvedValue(null),
      findByPreviousRefreshToken: jest.fn().mockResolvedValue(null),
    });
    const userRepo = buildUserRepo(activeUser);

    const uc = new RefreshSessionUseCase(userRepo, sessionRepo, envServiceStub, noopLogger);

    await expect(uc.execute({ refreshToken: 'raw-bogus' })).rejects.toThrow(
      /invalid refresh token/i,
    );

    expect(sessionRepo.revokeAllUserSessions).not.toHaveBeenCalled();
    expect(sessionRepo.rotateRefreshToken).not.toHaveBeenCalled();
  });

  it('reuse detected — the legitimate user reusing their own (already-rotated-away) token also triggers the revoke', async () => {
    // The theft-detection cannot distinguish "legitimate user retried
    // a stale token" from "attacker replayed a stolen token". Both
    // get revoked. This is the documented and intended cost: a small
    // inconvenience (re-login) for the legit user, total lockout for
    // the attacker.
    const sessionRepo = buildRepo({
      findByRefreshToken: jest.fn().mockResolvedValue(null),
      findByPreviousRefreshToken: jest.fn().mockResolvedValue({
        id: 's-1',
        userId: 'u-1',
        refreshToken: 'hashed-new',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400_000),
      } as any),
    });
    const userRepo = buildUserRepo(activeUser);

    const uc = new RefreshSessionUseCase(userRepo, sessionRepo, envServiceStub, noopLogger);

    await expect(uc.execute({ refreshToken: 'raw-stale-but-mine' })).rejects.toThrow();
    expect(sessionRepo.revokeAllUserSessions).toHaveBeenCalledWith('u-1');
  });
});
