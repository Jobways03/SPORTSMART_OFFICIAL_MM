import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { LoginFranchiseUseCase } from '../../src/modules/franchise/application/use-cases/login-franchise.use-case';

/**
 * Phase 20 (2026-05-20) — LoginFranchiseUseCase email-verification gate.
 *
 *   • isEmailVerified === false → 403 with code EMAIL_NOT_VERIFIED.
 *   • SUSPENDED → 403 (different code — explicit support contact).
 *   • DEACTIVATED → 403 (same path).
 *   • Unknown identifier → 401 (no enumeration; dummy bcrypt absorbs timing).
 *   • Verified + correct password → returns isEmailVerified: true.
 */

describe('LoginFranchiseUseCase — gates', () => {
  const passwordHash =
    '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';

  const buildUseCase = (franchise: any) => {
    const franchiseRepo: any = {
      findByEmail: jest.fn().mockResolvedValue(franchise),
      findByPhone: jest.fn().mockResolvedValue(franchise),
      updateFranchise: jest.fn().mockResolvedValue(undefined),
      createSession: jest.fn().mockResolvedValue({ id: 'sess-1' }),
    };
    const envService: any = {
      getString: (k: string, d?: string) => {
        if (k === 'JWT_FRANCHISE_SECRET') return 'x'.repeat(32);
        if (k === 'JWT_ACCESS_TTL') return d ?? '7d';
        if (k === 'JWT_REFRESH_TTL') return d ?? '30d';
        return d ?? '';
      },
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    return new LoginFranchiseUseCase(franchiseRepo, envService, eventBus, logger);
  };

  const fr = (overrides: Partial<any> = {}) => ({
    id: 'f-1',
    franchiseCode: 'FRN-001',
    ownerName: 'Owner',
    businessName: 'Biz',
    email: 'a@b.com',
    phoneNumber: '9876543210',
    status: 'PENDING',
    isEmailVerified: true,
    passwordHash,
    failedLoginAttempts: 0,
    lockUntil: null,
    ...overrides,
  });

  it('isEmailVerified=false → 403 EMAIL_NOT_VERIFIED', async () => {
    const svc = buildUseCase(fr({ isEmailVerified: false }));
    try {
      await svc.execute({ identifier: 'a@b.com', password: 'whatever' });
      fail('Expected throw');
    } catch (err: any) {
      expect(err.code).toBe('EMAIL_NOT_VERIFIED');
    }
  });

  it('SUSPENDED → 403 with suspended-message (no EMAIL_NOT_VERIFIED leak)', async () => {
    const svc = buildUseCase(fr({ status: 'SUSPENDED' }));
    await expect(
      svc.execute({ identifier: 'a@b.com', password: 'whatever' }),
    ).rejects.toThrow(/suspended or deactivated/i);
  });

  it('DEACTIVATED → 403', async () => {
    const svc = buildUseCase(fr({ status: 'DEACTIVATED' }));
    await expect(
      svc.execute({ identifier: 'a@b.com', password: 'whatever' }),
    ).rejects.toThrow(/suspended or deactivated/i);
  });

  it('unknown email → 401 (no enumeration)', async () => {
    const svc = buildUseCase(null);
    await expect(
      svc.execute({ identifier: 'ghost@example.com', password: 'whatever' }),
    ).rejects.toThrow(/Invalid credentials/);
  });

  it('happy path: verified + correct password → returns isEmailVerified: true', async () => {
    const password = 'correct-password';
    const hash = await bcrypt.hash(password, 4);
    const svc = buildUseCase(fr({ passwordHash: hash, status: 'ACTIVE' }));
    const out = await svc.execute({ identifier: 'a@b.com', password });
    expect(out.franchise.isEmailVerified).toBe(true);
    expect(out.accessToken).toBeTruthy();
    expect(out.refreshToken).toBeTruthy();
  });
});
