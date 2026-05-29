import 'reflect-metadata';
import { LoginUserUseCase } from '../../src/modules/identity/application/use-cases/login-user.use-case';

/**
 * Phase 17 (2026-05-20) — LoginUserUseCase identity/state gate tests.
 *
 * Verifies:
 *   • PENDING_VERIFICATION → 403 with code EMAIL_NOT_VERIFIED.
 *   • ACTIVE + emailVerified=false → 403 with code EMAIL_NOT_VERIFIED.
 *   • SUSPENDED / BANNED / INACTIVE → uniform 401 "Invalid email or
 *     password" (no enumeration leak).
 *   • Unknown email → uniform 401 (timing-protected by dummy bcrypt).
 */

describe('LoginUserUseCase — identity gates', () => {
  const passwordHash =
    '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';

  const makeSvc = (user: any) => {
    const userRepo: any = {
      findByEmailWithRoles: jest.fn().mockResolvedValue(user),
      recordFailedLoginAtomic: jest.fn().mockResolvedValue({
        failedLoginAttempts: 1,
        lockUntil: null,
      }),
      recordFailedLogin: jest.fn().mockResolvedValue(undefined),
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
      getOptional: () => undefined,
      isProduction: () => false,
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const emailBruteForce: any = {
      assertNotLocked: jest.fn().mockResolvedValue(undefined),
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

  it('PENDING_VERIFICATION → 403 EMAIL_NOT_VERIFIED', async () => {
    const { svc } = makeSvc(
      buildUser({ status: 'PENDING_VERIFICATION', emailVerified: false }),
    );
    await expect(
      svc.execute({ email: 'test@example.com', password: 'whatever' }),
    ).rejects.toThrow(/not verified/i);
    try {
      await svc.execute({ email: 'test@example.com', password: 'whatever' });
    } catch (err: any) {
      expect(err.code).toBe('EMAIL_NOT_VERIFIED');
    }
  });

  it('ACTIVE + emailVerified=false → 403 EMAIL_NOT_VERIFIED', async () => {
    const { svc } = makeSvc(buildUser({ emailVerified: false }));
    try {
      await svc.execute({ email: 'test@example.com', password: 'whatever' });
      fail('Expected throw');
    } catch (err: any) {
      expect(err.code).toBe('EMAIL_NOT_VERIFIED');
    }
  });

  it('SUSPENDED → uniform 401 (no leak)', async () => {
    const { svc } = makeSvc(buildUser({ status: 'SUSPENDED' }));
    try {
      await svc.execute({ email: 'test@example.com', password: 'whatever' });
      fail('Expected throw');
    } catch (err: any) {
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.message).toMatch(/Invalid email or password/);
    }
  });

  it('BANNED → uniform 401 (no leak)', async () => {
    const { svc } = makeSvc(buildUser({ status: 'BANNED' }));
    try {
      await svc.execute({ email: 'test@example.com', password: 'whatever' });
      fail('Expected throw');
    } catch (err: any) {
      expect(err.code).toBe('UNAUTHORIZED');
    }
  });

  it('INACTIVE → uniform 401 (no leak)', async () => {
    const { svc } = makeSvc(buildUser({ status: 'INACTIVE' }));
    try {
      await svc.execute({ email: 'test@example.com', password: 'whatever' });
      fail('Expected throw');
    } catch (err: any) {
      expect(err.code).toBe('UNAUTHORIZED');
    }
  });

  it('unknown email → uniform 401 + per-email counter still bumped', async () => {
    const { svc, emailBruteForce } = makeSvc(null);
    await expect(
      svc.execute({ email: 'ghost@example.com', password: 'whatever' }),
    ).rejects.toThrow(/Invalid email or password/);
    expect(emailBruteForce.recordFailure).toHaveBeenCalledWith(
      'ghost@example.com',
    );
  });
});
