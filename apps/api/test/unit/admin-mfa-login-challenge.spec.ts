import 'reflect-metadata';
import * as jwt from 'jsonwebtoken';
import { AdminLoginUseCase, ADMIN_MFA_CHALLENGE_AUD } from '../../src/modules/admin/application/use-cases/admin-login.use-case';
import { AdminMfaVerifyChallengeUseCase } from '../../src/modules/admin-mfa/application/use-cases/admin-mfa-verify-challenge.use-case';
import { MfaSecretCipher } from '../../src/modules/admin-mfa/application/services/mfa-secret-cipher.service';
import { generateTotpSecret } from '../../src/modules/admin-mfa/domain/totp-secret';
import { base32ToBuffer } from '../../src/modules/admin-mfa/domain/totp-verify';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../src/core/exceptions';
import * as bcrypt from 'bcrypt';

// Phase 10 (PR 10.6) — End-to-end login → MFA challenge → session.
//
// Covers the two-step flow:
//   1. AdminLoginUseCase password-verifies and branches on
//      mfaEnabledAt: returns challenge token if enrolled, session
//      if not.
//   2. AdminMfaVerifyChallengeUseCase verifies the JWT + TOTP code
//      and mints the session.
//
// Negative tests: invalid / expired / wrong-aud challenge tokens,
// inactive admin, un-enrolled mid-challenge, wrong TOTP code.

const JWT_ADMIN_SECRET = 'test-secret-min-32-chars-long-padding-x';
const ENCRYPTION_KEY = 'a'.repeat(64);
const PASSWORD = 'CorrectHorseBatteryStaple';

function makeEnv(): any {
  return {
    getString: (k: string, fallback?: string) => {
      const map: Record<string, string> = {
        JWT_ADMIN_SECRET,
        JWT_ACCESS_TTL: '1h',
        JWT_REFRESH_TTL: '30d',
      };
      return map[k] ?? fallback ?? '';
    },
    get: (k: string) =>
      k === 'ADMIN_MFA_ENCRYPTION_KEY' ? ENCRYPTION_KEY : undefined,
  };
}

function makeCipher(): MfaSecretCipher {
  return new MfaSecretCipher(makeEnv());
}

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  passwordHash: string;
  failedLoginAttempts: number;
  lockUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  mfaEnabledAt?: Date | null;
  mfaSecretCiphertext?: string | null;
  mfaLastUsedStep?: number | null;
}

class FakeAdminRepo {
  public rows = new Map<string, AdminRow>();
  public byEmail = new Map<string, string>();
  public sessions: any[] = [];

  async findAdminByEmail(email: string) {
    const id = this.byEmail.get(email);
    return id ? this.rows.get(id) ?? null : null;
  }

  async findAdminById(adminId: string, _select?: Record<string, boolean>) {
    return this.rows.get(adminId) ?? null;
  }

  async updateAdmin(adminId: string, data: Record<string, unknown>) {
    const row = this.rows.get(adminId);
    if (row) Object.assign(row, data);
  }

  // Phase 1 / H3 — atomic CAS advance for the TOTP anti-replay step
  // counter. The verify-challenge use-case calls this on every
  // successful TOTP verify; without the fake, the path crashes.
  async advanceMfaLastUsedStepCas(
    adminId: string,
    step: number,
  ): Promise<boolean> {
    const row = this.rows.get(adminId);
    if (!row) return false;
    if (row.mfaLastUsedStep != null && row.mfaLastUsedStep >= step) {
      return false;
    }
    row.mfaLastUsedStep = step;
    return true;
  }

  async createAdminSession(data: any) {
    const session = { id: `sess-${this.sessions.length + 1}`, ...data };
    this.sessions.push(session);
    return session;
  }

  async revokeAdminSessions() {}
}

function makeLoginUseCase(repo: FakeAdminRepo): AdminLoginUseCase {
  const logger = {
    setContext: () => undefined,
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  const audit = { writeAuditLog: () => Promise.resolve() } as any;
  return new AdminLoginUseCase(
    repo as any,
    makeEnv(),
    logger as any,
    audit,
  );
}

function makeVerifyUseCase(repo: FakeAdminRepo): AdminMfaVerifyChallengeUseCase {
  // PR 10.9 — pass-through backup-codes stub. The login-challenge
  // tests exercise the TOTP path; backup-code consume is covered
  // by the admin-mfa-replay-defence and admin-mfa-backup-codes
  // specs.
  const backupCodes = {
    generateAndHashForAdmin: async () => [],
    consume: async () => false,
    remainingCount: async () => 0,
  } as any;
  // Phase 23 (2026-05-20) — AdminMfaVerifyChallengeUseCase gained
  // AuditPublicFacade + EventBusService deps for verify-outcome
  // audit + admin.mfa.backup_code_used emission. These tests don't
  // assert on either path; stub them.
  // Phase 26 (2026-05-20) — additionally gained AccessLogService
  // (LOGIN_SUCCESS row on MFA-pass) + RedisService (challenge JTI
  // one-time-use). Stub both as no-ops; redis.acquireLock returns
  // true so the JTI consume always succeeds (single-attempt tests).
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const accessLog = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const redis = { acquireLock: jest.fn().mockResolvedValue(true) } as any;
  return new AdminMfaVerifyChallengeUseCase(
    repo as any,
    makeEnv(),
    makeCipher(),
    backupCodes,
    audit,
    eventBus,
    accessLog,
    redis,
  );
}

function seedAdmin(
  repo: FakeAdminRepo,
  overrides: Partial<AdminRow> = {},
): AdminRow {
  const row: AdminRow = {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin One',
    role: 'SELLER_ADMIN',
    status: 'ACTIVE',
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    failedLoginAttempts: 0,
    lockUntil: null,
    lastLoginAt: null,
    createdAt: new Date(),
    mfaEnabledAt: null,
    mfaSecretCiphertext: null,
    ...overrides,
  };
  repo.rows.set(row.id, row);
  repo.byEmail.set(row.email, row.id);
  return row;
}

function computeCurrentCode(secret: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHmac } = require('crypto');
  const buf = base32ToBuffer(secret);
  const step = Math.floor(Date.now() / 1000 / 30);
  const stepBuf = Buffer.alloc(8);
  stepBuf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  stepBuf.writeUInt32BE(step & 0xffffffff, 4);
  const hmac = createHmac('sha1', buf).update(stepBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const truncated =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(truncated % 1_000_000).padStart(6, '0');
}

describe('AdminLoginUseCase — MFA branch (PR 10.6)', () => {
  it('returns the session shape when admin has NOT enrolled MFA', async () => {
    const repo = new FakeAdminRepo();
    seedAdmin(repo, { mfaEnabledAt: null });
    const result = await makeLoginUseCase(repo).execute({
      email: 'admin@example.com',
      password: PASSWORD,
    });
    expect((result as any).mfaRequired).toBeFalsy();
    expect((result as any).accessToken).toBeTruthy();
    expect((result as any).refreshToken).toBeTruthy();
  });

  it('returns the challenge shape when admin HAS enrolled MFA', async () => {
    const repo = new FakeAdminRepo();
    seedAdmin(repo, {
      mfaEnabledAt: new Date('2025-01-01'),
      mfaSecretCiphertext: makeCipher().encrypt('JBSWY3DPEHPK3PXP'),
    });
    const result = await makeLoginUseCase(repo).execute({
      email: 'admin@example.com',
      password: PASSWORD,
    });
    expect((result as any).mfaRequired).toBe(true);
    expect((result as any).challengeToken).toBeTruthy();
    expect((result as any).admin.adminId).toBe('admin-1');
    // No session token yet — that's gated behind the challenge step.
    expect((result as any).accessToken).toBeUndefined();
  });

  it('challenge token carries aud=admin-mfa-challenge', async () => {
    const repo = new FakeAdminRepo();
    seedAdmin(repo, {
      mfaEnabledAt: new Date(),
      mfaSecretCiphertext: makeCipher().encrypt('JBSWY3DPEHPK3PXP'),
    });
    const result = (await makeLoginUseCase(repo).execute({
      email: 'admin@example.com',
      password: PASSWORD,
    })) as any;
    const decoded = jwt.decode(result.challengeToken) as any;
    expect(decoded.aud).toBe(ADMIN_MFA_CHALLENGE_AUD);
    expect(decoded.sub).toBe('admin-1');
  });

  it('failed-login counter resets on password success regardless of MFA branch', async () => {
    const repo = new FakeAdminRepo();
    seedAdmin(repo, {
      failedLoginAttempts: 3,
      mfaEnabledAt: new Date(),
      mfaSecretCiphertext: makeCipher().encrypt('JBSWY3DPEHPK3PXP'),
    });
    await makeLoginUseCase(repo).execute({
      email: 'admin@example.com',
      password: PASSWORD,
    });
    expect(repo.rows.get('admin-1')!.failedLoginAttempts).toBe(0);
  });

  it('lastLoginAt stays NULL on the challenge branch (login not yet complete)', async () => {
    const repo = new FakeAdminRepo();
    seedAdmin(repo, {
      lastLoginAt: null,
      mfaEnabledAt: new Date(),
      mfaSecretCiphertext: makeCipher().encrypt('JBSWY3DPEHPK3PXP'),
    });
    await makeLoginUseCase(repo).execute({
      email: 'admin@example.com',
      password: PASSWORD,
    });
    // Challenge issued but no session yet — login isn't complete.
    expect(repo.rows.get('admin-1')!.lastLoginAt).toBeNull();
  });
});

describe('AdminMfaVerifyChallengeUseCase (PR 10.6)', () => {
  function setupMfaAdmin() {
    const repo = new FakeAdminRepo();
    const secret = generateTotpSecret();
    seedAdmin(repo, {
      mfaEnabledAt: new Date('2025-01-01'),
      mfaSecretCiphertext: makeCipher().encrypt(secret),
    });
    return { repo, secret };
  }

  function issueChallenge(adminId: string, email: string): string {
    return jwt.sign(
      { sub: adminId, email, aud: ADMIN_MFA_CHALLENGE_AUD },
      JWT_ADMIN_SECRET,
      { algorithm: 'HS256', expiresIn: '5m' },
    );
  }

  it('mints a session on valid challenge + correct code', async () => {
    const { repo, secret } = setupMfaAdmin();
    const challengeToken = issueChallenge('admin-1', 'admin@example.com');
    const code = computeCurrentCode(secret);
    const result = await makeVerifyUseCase(repo).execute({
      challengeToken,
      code,
    });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.admin.adminId).toBe('admin-1');
    // Session row was created.
    expect(repo.sessions).toHaveLength(1);
    // lastLoginAt updated to recent timestamp.
    expect(repo.rows.get('admin-1')!.lastLoginAt).toBeInstanceOf(Date);
  });

  it('rejects an unsigned / malformed challenge token', async () => {
    const { repo } = setupMfaAdmin();
    await expect(
      makeVerifyUseCase(repo).execute({
        challengeToken: 'not-a-jwt',
        code: '123456',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects an expired challenge token', async () => {
    const { repo } = setupMfaAdmin();
    const expired = jwt.sign(
      { sub: 'admin-1', email: 'admin@example.com', aud: ADMIN_MFA_CHALLENGE_AUD },
      JWT_ADMIN_SECRET,
      { algorithm: 'HS256', expiresIn: '-1s' },
    );
    await expect(
      makeVerifyUseCase(repo).execute({ challengeToken: expired, code: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects a token with the wrong audience claim (e.g. a session token mis-used)', async () => {
    const { repo } = setupMfaAdmin();
    const wrongAud = jwt.sign(
      { sub: 'admin-1', email: 'admin@example.com', aud: 'something-else' },
      JWT_ADMIN_SECRET,
      { algorithm: 'HS256', expiresIn: '5m' },
    );
    await expect(
      makeVerifyUseCase(repo).execute({ challengeToken: wrongAud, code: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects a token signed with the wrong key', async () => {
    const { repo } = setupMfaAdmin();
    const wrongKey = jwt.sign(
      { sub: 'admin-1', email: 'admin@example.com', aud: ADMIN_MFA_CHALLENGE_AUD },
      'a-different-secret-padding-32-chars',
      { algorithm: 'HS256', expiresIn: '5m' },
    );
    await expect(
      makeVerifyUseCase(repo).execute({ challengeToken: wrongKey, code: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects when the admin no longer exists', async () => {
    const { repo } = setupMfaAdmin();
    repo.rows.delete('admin-1');
    const challengeToken = issueChallenge('admin-1', 'admin@example.com');
    await expect(
      makeVerifyUseCase(repo).execute({ challengeToken, code: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects when the admin is INACTIVE', async () => {
    const repo = new FakeAdminRepo();
    seedAdmin(repo, {
      status: 'SUSPENDED',
      mfaEnabledAt: new Date(),
      mfaSecretCiphertext: makeCipher().encrypt('JBSWY3DPEHPK3PXP'),
    });
    const challengeToken = issueChallenge('admin-1', 'admin@example.com');
    await expect(
      makeVerifyUseCase(repo).execute({ challengeToken, code: '123456' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
  });

  it('rejects when the admin un-enrolled between login and verify', async () => {
    const repo = new FakeAdminRepo();
    seedAdmin(repo, {
      // Admin was MFA-enrolled (login issued challenge), but the live
      // secret was cleared between login and verify. Surface a clean
      // 400 rather than letting decrypt explode on a null ciphertext.
      mfaEnabledAt: null,
      mfaSecretCiphertext: null,
    });
    const challengeToken = issueChallenge('admin-1', 'admin@example.com');
    await expect(
      makeVerifyUseCase(repo).execute({ challengeToken, code: '123456' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
  });

  it('rejects an invalid TOTP code', async () => {
    const { repo } = setupMfaAdmin();
    const challengeToken = issueChallenge('admin-1', 'admin@example.com');
    // 000000 has a ~3-in-a-million chance of being the actual code;
    // effectively always wrong.
    await expect(
      makeVerifyUseCase(repo).execute({ challengeToken, code: '000000' }),
    ).rejects.toBeInstanceOf(UnauthorizedAppException);
    // No session minted on failure.
    expect(repo.sessions).toHaveLength(0);
  });
});
