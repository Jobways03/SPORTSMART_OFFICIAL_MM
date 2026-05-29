import 'reflect-metadata';
import { LoginUserUseCase } from '../../src/modules/identity/application/use-cases/login-user.use-case';

/**
 * Customer login brute-force protection.
 *
 * Phase 17 (2026-05-20) — the use case now uses
 * `recordFailedLoginAtomic` (Prisma `{ increment: 1 }`) instead of
 * the racy read-then-set pattern, and consults the
 * EmailBruteForceService for distributed credential-stuffing
 * across rotating IPs.
 */

describe('LoginUserUseCase — brute-force lockout', () => {
  const MAX_ATTEMPTS = 5;
  const passwordHash =
    '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi'; // dummy

  const makeSvc = (
    user: any,
    overrides: {
      emailLocked?: boolean;
      atomicResult?: { failedLoginAttempts: number; lockUntil: Date | null };
    } = {},
  ) => {
    const userRepo: any = {
      findByEmailWithRoles: jest.fn().mockResolvedValue(user),
      recordFailedLogin: jest.fn().mockResolvedValue(undefined),
      recordFailedLoginAtomic: jest
        .fn()
        .mockResolvedValue(
          overrides.atomicResult ?? {
            failedLoginAttempts: (user?.failedLoginAttempts ?? 0) + 1,
            lockUntil: null,
          },
        ),
      clearLoginLockout: jest.fn().mockResolvedValue(undefined),
      touchLastLogin: jest.fn().mockResolvedValue(undefined),
      updatePassword: jest.fn().mockResolvedValue(undefined),
    };
    const sessionRepo: any = {
      createSession: jest.fn().mockResolvedValue({ id: 'sess-1' }),
    };
    const envService: any = {
      getString: (k: string, d: string) =>
        k === 'JWT_CUSTOMER_SECRET' ? 'x'.repeat(32) : d ?? '15m',
      getOptional: (_k: string) => undefined,
      isProduction: () => false,
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const emailBruteForce: any = {
      assertNotLocked: jest
        .fn()
        .mockImplementation(async () => {
          if (overrides.emailLocked) {
            const err: any = new Error('locked');
            err.code = 'TOO_MANY_REQUESTS';
            throw err;
          }
        }),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    const svc = new LoginUserUseCase(
      userRepo,
      sessionRepo,
      envService,
      eventBus,
      emailBruteForce,
      logger,
    );
    return { svc, userRepo, emailBruteForce };
  };

  const buildUser = (overrides: Partial<any> = {}) => ({
    id: 'u-1',
    email: 'test@example.com',
    firstName: 'A',
    lastName: 'B',
    status: 'ACTIVE',
    emailVerified: true,
    passwordHash,
    failedLoginAttempts: 0,
    lockUntil: null,
    roleAssignments: [{ role: { name: 'CUSTOMER' } }],
    ...overrides,
  });

  it('wrong password: atomic-increments counter and records per-email failure', async () => {
    const { svc, userRepo, emailBruteForce } = makeSvc(
      buildUser({ failedLoginAttempts: 2 }),
      { atomicResult: { failedLoginAttempts: 3, lockUntil: null } },
    );

    await expect(
      svc.execute({ email: 'test@example.com', password: 'wrong' }),
    ).rejects.toThrow(/Invalid email or password/);

    expect(userRepo.recordFailedLoginAtomic).toHaveBeenCalledWith(
      'u-1',
      MAX_ATTEMPTS,
      15 * 60 * 1000,
    );
    expect(emailBruteForce.recordFailure).toHaveBeenCalledWith(
      'test@example.com',
    );
  });

  it('locks the account when atomic increment returns lockUntil', async () => {
    const future = new Date(Date.now() + 15 * 60 * 1000);
    const { svc } = makeSvc(buildUser({ failedLoginAttempts: 4 }), {
      atomicResult: { failedLoginAttempts: 5, lockUntil: future },
    });

    await expect(
      svc.execute({ email: 'test@example.com', password: 'wrong' }),
    ).rejects.toThrow(/Account locked due to too many failed attempts/);
  });

  it('refuses immediately when lockUntil is in the future (no bcrypt work)', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000);
    const { svc, userRepo } = makeSvc(buildUser({ lockUntil: future }));

    await expect(
      svc.execute({ email: 'test@example.com', password: 'anything' }),
    ).rejects.toThrow(/Account locked/);

    expect(userRepo.recordFailedLoginAtomic).not.toHaveBeenCalled();
  });

  it('rejects per-email soft-lock before bcrypt', async () => {
    const { svc, userRepo } = makeSvc(buildUser(), { emailLocked: true });
    await expect(
      svc.execute({ email: 'test@example.com', password: 'anything' }),
    ).rejects.toThrow();
    expect(userRepo.findByEmailWithRoles).not.toHaveBeenCalled();
  });

  it('clears counters + per-email lock on successful login', async () => {
    const { svc, userRepo, emailBruteForce } = makeSvc(
      buildUser({ failedLoginAttempts: 3 }),
    );
    const bcrypt = require('bcrypt');
    const spy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    await svc.execute({ email: 'test@example.com', password: 'ok' });

    expect(userRepo.clearLoginLockout).toHaveBeenCalledWith('u-1');
    expect(userRepo.touchLastLogin).toHaveBeenCalledWith('u-1');
    expect(emailBruteForce.clear).toHaveBeenCalledWith('test@example.com');

    spy.mockRestore();
  });
});
