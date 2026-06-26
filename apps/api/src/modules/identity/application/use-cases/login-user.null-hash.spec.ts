import * as bcrypt from 'bcrypt';
import { LoginUserUseCase } from './login-user.use-case';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import { UserWithRoles } from '../../domain/repositories/user.repository';

/**
 * Password-login guard for OAuth-only accounts.
 *
 * A "Sign in with Google" customer has passwordHash === null. The
 * historic risk: `bcrypt.compare(password, null)` throws "Illegal
 * arguments" → bubbles as a 500, which both breaks the UX and LEAKS
 * (via a distinct error) that the account is Google-only.
 *
 * Contract under test (login-user.use-case, the null-passwordHash branch):
 *   • returns the uniform 401 "Invalid email or password";
 *   • NEVER calls bcrypt.compare with a null hash;
 *   • runs a dummy compare for timing parity + records the per-email
 *     failure (so the branch is indistinguishable from a wrong password);
 *   • never mints a session.
 *
 * Everything external (repo, session repo, env, event bus, brute-force,
 * logger) is stubbed; bcrypt is auto-mocked so we can inspect compare's
 * args (spyOn fails to redefine the native module's property).
 */

// Auto-mock bcrypt: compare becomes a jest.fn() we can inspect + drive.
jest.mock('bcrypt');
const compareMock = bcrypt.compare as unknown as jest.Mock;

const noopLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

const envStub = {
  getString: (_k: string, fallback?: string) => fallback ?? '',
  getOptional: (_k: string) => undefined,
  getNumber: (_k: string, fallback?: number) => fallback ?? 60,
} as any;

const eventBusStub = {
  publish: jest.fn().mockResolvedValue(undefined),
} as any;

function buildSessionRepo() {
  return {
    createSession: jest.fn().mockResolvedValue({ id: 'sess-1' }),
  } as any;
}

function buildBruteForce() {
  return {
    assertNotLocked: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  } as any;
}

const oauthOnlyUser: UserWithRoles = {
  id: 'oauth-user-1',
  firstName: 'Google',
  lastName: 'Customer',
  email: 'google-only@example.com',
  passwordHash: null, // OAuth-only — the whole point
  status: 'ACTIVE',
  failedLoginAttempts: 0,
  lockUntil: null,
  roleAssignments: [{ role: { name: 'CUSTOMER' } }],
};

describe('LoginUserUseCase — null passwordHash guard (OAuth-only accounts)', () => {
  beforeEach(() => {
    compareMock.mockReset();
    // Resolve false so that IF the dummy compare runs, it behaves like a
    // wrong password rather than accidentally authenticating.
    compareMock.mockResolvedValue(false);
  });

  function buildUseCase(repoOverrides: Record<string, any> = {}) {
    const userRepo = {
      findByEmailWithRoles: jest.fn().mockResolvedValue(oauthOnlyUser),
      recordFailedLoginAtomic: jest.fn(),
      clearLoginLockout: jest.fn().mockResolvedValue(undefined),
      touchLastLogin: jest.fn().mockResolvedValue(undefined),
      updatePassword: jest.fn().mockResolvedValue(undefined),
      ...repoOverrides,
    } as any;
    const sessionRepo = buildSessionRepo();
    const bruteForce = buildBruteForce();
    const uc = new LoginUserUseCase(
      userRepo,
      sessionRepo,
      envStub,
      eventBusStub,
      bruteForce,
      noopLogger,
    );
    return { uc, userRepo, sessionRepo, bruteForce };
  }

  it('returns the uniform 401 and NEVER calls bcrypt.compare with a null hash', async () => {
    const { uc, sessionRepo, bruteForce } = buildUseCase();

    await expect(
      uc.execute({ email: oauthOnlyUser.email, password: 'whatever' }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid email or password',
    });
    await expect(
      uc.execute({ email: oauthOnlyUser.email, password: 'whatever' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);

    // The load-bearing assertion: bcrypt.compare must NEVER see null/undefined
    // as the hash argument (that is the "Illegal arguments" 500 vector).
    expect(compareMock).toHaveBeenCalled(); // dummy compare ran (timing parity)
    for (const call of compareMock.mock.calls) {
      expect(call[1]).not.toBeNull();
      expect(call[1]).not.toBeUndefined();
      expect(typeof call[1]).toBe('string');
    }
    expect(compareMock).not.toHaveBeenCalledWith(expect.anything(), null);

    // Timing-parity + brute-force side effects still happen, and no
    // session is minted.
    expect(bruteForce.recordFailure).toHaveBeenCalledWith(oauthOnlyUser.email);
    expect(sessionRepo.createSession).not.toHaveBeenCalled();
  });

  it('does not fall through to the atomic failed-login counter (that path is for wrong passwords on real hashes)', async () => {
    const recordFailedLoginAtomic = jest.fn();
    const { uc } = buildUseCase({ recordFailedLoginAtomic });

    await expect(
      uc.execute({ email: oauthOnlyUser.email, password: 'whatever' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);

    // The null-hash branch short-circuits before the wrong-password path,
    // so the per-account atomic counter is NOT touched.
    expect(recordFailedLoginAtomic).not.toHaveBeenCalled();
  });

  it('regression guard: the REAL bcrypt.compare(pw, null) rejects — proving why the guard is required', async () => {
    const realBcrypt = jest.requireActual('bcrypt');
    await expect(realBcrypt.compare('pw', null)).rejects.toThrow();
    // The null-hash guard above is what stops this from ever reaching
    // production code.
  });
});
