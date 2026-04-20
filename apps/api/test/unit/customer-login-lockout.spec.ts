import 'reflect-metadata';
import { LoginUserUseCase } from '../../src/modules/identity/application/use-cases/login-user.use-case';

/**
 * Regression test for customer login brute-force protection.
 *
 * Before: Seller / Franchise / Admin login all had `failedLoginAttempts`
 * + `lockUntil` lockout logic (see e.g. admin-login.use-case.ts:107-146).
 * Customer login skipped it — the User schema didn't even have those
 * columns. Per-IP throttling (5/min) helped but didn't stop distributed
 * credential-stuffing spraying one account across many IPs.
 *
 * After: User model has failedLoginAttempts + lockUntil (see
 * prisma/schema/identity.prisma), repo has recordFailedLogin +
 * clearLoginLockout, and this use-case enforces the same 5-attempts-then-
 * 15-min-lock policy as the other actors.
 */

describe('LoginUserUseCase — brute-force lockout', () => {
  const MAX_ATTEMPTS = 5;
  const passwordHash =
    '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi'; // dummy

  const makeSvc = (user: any) => {
    const userRepo: any = {
      findByEmailWithRoles: jest.fn().mockResolvedValue(user),
      recordFailedLogin: jest.fn().mockResolvedValue(undefined),
      clearLoginLockout: jest.fn().mockResolvedValue(undefined),
    };
    const sessionRepo: any = {
      createSession: jest.fn().mockResolvedValue({ id: 'sess-1' }),
    };
    const envService: any = {
      getString: (k: string, d: string) =>
        k === 'JWT_CUSTOMER_SECRET' ? 'x'.repeat(32) : d ?? '7d',
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };
    const svc = new LoginUserUseCase(
      userRepo,
      sessionRepo,
      envService,
      eventBus,
      logger,
    );
    return { svc, userRepo };
  };

  const buildUser = (overrides: Partial<any> = {}) => ({
    id: 'u-1',
    email: 'test@example.com',
    firstName: 'A',
    lastName: 'B',
    status: 'ACTIVE',
    passwordHash,
    failedLoginAttempts: 0,
    lockUntil: null,
    roleAssignments: [{ role: { name: 'CUSTOMER' } }],
    ...overrides,
  });

  it('rejects and increments counter on wrong password', async () => {
    const { svc, userRepo } = makeSvc(buildUser({ failedLoginAttempts: 2 }));

    await expect(
      svc.execute({ email: 'test@example.com', password: 'wrong' }),
    ).rejects.toThrow(/Invalid email or password/);

    expect(userRepo.recordFailedLogin).toHaveBeenCalledWith('u-1', 3, null);
  });

  it('locks the account on the MAX_ATTEMPTS-th consecutive failure', async () => {
    const { svc, userRepo } = makeSvc(
      buildUser({ failedLoginAttempts: MAX_ATTEMPTS - 1 }),
    );

    await expect(
      svc.execute({ email: 'test@example.com', password: 'wrong' }),
    ).rejects.toThrow(/Account locked/);

    const call = userRepo.recordFailedLogin.mock.calls[0];
    expect(call[0]).toBe('u-1');
    expect(call[1]).toBe(MAX_ATTEMPTS);
    expect(call[2]).toBeInstanceOf(Date); // lockUntil set
  });

  it('rejects immediately when lockUntil is in the future (no bcrypt work)', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000);
    const { svc, userRepo } = makeSvc(buildUser({ lockUntil: future }));

    await expect(
      svc.execute({ email: 'test@example.com', password: 'anything' }),
    ).rejects.toThrow(/Account locked/);

    expect(userRepo.recordFailedLogin).not.toHaveBeenCalled();
  });

  it('clears counters on successful login when attempts > 0', async () => {
    const { svc, userRepo } = makeSvc(
      buildUser({ failedLoginAttempts: 3 }),
    );

    // Stub bcrypt.compare to succeed.
    const bcrypt = require('bcrypt');
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    await svc.execute({ email: 'test@example.com', password: 'ok' });

    expect(userRepo.clearLoginLockout).toHaveBeenCalledWith('u-1');

    (bcrypt.compare as jest.Mock).mockRestore?.();
  });
});
