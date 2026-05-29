import 'reflect-metadata';
import * as jwt from 'jsonwebtoken';
import { AdminMfaVerifyChallengeUseCase } from '../../src/modules/admin-mfa/application/use-cases/admin-mfa-verify-challenge.use-case';
import { AdminMfaService } from '../../src/modules/admin-mfa/application/services/admin-mfa.service';
import { MfaSecretCipher } from '../../src/modules/admin-mfa/application/services/mfa-secret-cipher.service';
import { generateTotpSecret } from '../../src/modules/admin-mfa/domain/totp-secret';
import { base32ToBuffer } from '../../src/modules/admin-mfa/domain/totp-verify';
import { ADMIN_MFA_CHALLENGE_AUD } from '../../src/modules/admin/application/use-cases/admin-login.use-case';
import { UnauthorizedAppException } from '../../src/core/exceptions';

// Phase 10 (PR 10.7) — Anti-replay defence via mfaLastUsedStep.
//
// The verifier records the matched TOTP step on every successful
// authentication. Subsequent calls reject codes whose step is <=
// the recorded value. Tests:
//
//   1. After enrollment-complete writes mfaLastUsedStep, a verify
//      for the same step fails.
//   2. Re-presenting the same code (same step) at the verify
//      endpoint within its validity fails.
//   3. A code from a strictly-newer step succeeds (and advances
//      the baseline).
//   4. Enrollment-complete itself seeds the baseline so the
//      following verify can't replay the enrollment code.

const JWT_ADMIN_SECRET = 'test-secret-min-32-chars-long-padding-x';
const ENCRYPTION_KEY = 'a'.repeat(64);

function makeEnv(): any {
  return {
    getString: (k: string, fallback?: string) => {
      const map: Record<string, string> = {
        JWT_ADMIN_SECRET,
        JWT_ACCESS_TTL: '1h',
        JWT_REFRESH_TTL: '30d',
        APP_NAME: 'SportsMart',
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
  email?: string;
  name?: string;
  role?: string;
  status?: string;
  mfaEnabledAt?: Date | null;
  mfaSecretCiphertext?: string | null;
  mfaPendingSecretCiphertext?: string | null;
  mfaLastUsedStep?: number | null;
  lastLoginAt?: Date | null;
}

class FakeAdminRepo {
  public rows = new Map<string, AdminRow>();
  public sessions: any[] = [];

  async findAdminById(adminId: string, _select?: Record<string, boolean>) {
    return this.rows.get(adminId) ?? null;
  }

  async updateAdmin(adminId: string, data: Record<string, unknown>) {
    const row = this.rows.get(adminId);
    if (row) Object.assign(row, data);
  }

  // Phase 1 / H3 — atomic CAS advance. Mirrors the prod repo: only
  // succeeds when current step is null or strictly less than `step`.
  // The verify-challenge use-case calls this on every TOTP path so
  // the test fake must implement it for the spec to exercise the
  // happy path.
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
    const sess = { id: `sess-${this.sessions.length + 1}`, ...data };
    this.sessions.push(sess);
    return sess;
  }
}

// PR 10.9 — pass-through backup-codes stub. Replay-defence tests
// exercise the TOTP step path; the dedicated backup-codes spec
// covers the consume/remove-from-list path.
function makeBackupCodesStub() {
  return {
    generateAndHashForAdmin: async () =>
      Array.from({ length: 10 }, (_, i) => `code-${i}`),
    consume: async () => false,
    remainingCount: async () => 0,
  } as any;
}

function makeVerifyUseCase(repo: FakeAdminRepo) {
  // Phase 23 (2026-05-20) — verify use-case gained audit + eventBus.
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  // Phase 26 (2026-05-20) — verify use-case gained AccessLogService
  // (LOGIN_SUCCESS row on MFA-pass) + RedisService (JTI one-time-use).
  // The replay-defence specs don't observe either; stub both.
  const accessLog = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const redis = { acquireLock: jest.fn().mockResolvedValue(true) } as any;
  return new AdminMfaVerifyChallengeUseCase(
    repo as any,
    makeEnv(),
    makeCipher(),
    makeBackupCodesStub(),
    audit,
    eventBus,
    accessLog,
    redis,
  );
}

function makeEnrollService(repo: FakeAdminRepo) {
  // Phase 25 (2026-05-20) — service gained audit + events.
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const events = { emit: jest.fn() } as any;
  return new AdminMfaService(
    repo as any,
    makeCipher(),
    makeEnv(),
    makeBackupCodesStub(),
    audit,
    events,
  );
}

function issueChallenge(adminId: string): string {
  return jwt.sign(
    { sub: adminId, email: 'admin@example.com', aud: ADMIN_MFA_CHALLENGE_AUD },
    JWT_ADMIN_SECRET,
    { algorithm: 'HS256', expiresIn: '5m' },
  );
}

function codeForStep(secret: string, step: number): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHmac } = require('crypto');
  const buf = base32ToBuffer(secret);
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

function currentStep(): number {
  return Math.floor(Date.now() / 1000 / 30);
}

describe('Anti-replay defence (PR 10.7)', () => {
  describe('AdminMfaVerifyChallengeUseCase', () => {
    function setupEnrolled(lastUsedStep: number | null = null) {
      const repo = new FakeAdminRepo();
      const secret = generateTotpSecret();
      repo.rows.set('admin-1', {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin One',
        role: 'SELLER_ADMIN',
        status: 'ACTIVE',
        mfaEnabledAt: new Date('2025-01-01'),
        mfaSecretCiphertext: makeCipher().encrypt(secret),
        mfaLastUsedStep: lastUsedStep,
      });
      return { repo, secret };
    }

    it('rejects a code whose step equals mfaLastUsedStep (literal replay)', async () => {
      const { repo, secret } = setupEnrolled(currentStep());
      const challenge = issueChallenge('admin-1');
      const code = codeForStep(secret, currentStep());
      await expect(
        makeVerifyUseCase(repo).execute({ challengeToken: challenge, code }),
      ).rejects.toBeInstanceOf(UnauthorizedAppException);
      // No session minted.
      expect(repo.sessions).toHaveLength(0);
    });

    it('rejects a code whose step is less than mfaLastUsedStep (skew-window replay)', async () => {
      // After verifying step N, an attacker tries the +1-step code
      // they captured along with it. step N+1 - 1 step skew = step N
      // — same case as above but framed differently.
      const lastUsed = currentStep();
      const { repo, secret } = setupEnrolled(lastUsed);
      const challenge = issueChallenge('admin-1');
      // Try the previous step (within the default ±1 verify window).
      const code = codeForStep(secret, lastUsed - 1);
      await expect(
        makeVerifyUseCase(repo).execute({ challengeToken: challenge, code }),
      ).rejects.toBeInstanceOf(UnauthorizedAppException);
    });

    it('accepts a code whose step is strictly greater than mfaLastUsedStep', async () => {
      // Simulate: admin last verified an hour ago, now logs in
      // again. Current step is way ahead of mfaLastUsedStep.
      const { repo, secret } = setupEnrolled(currentStep() - 100);
      const challenge = issueChallenge('admin-1');
      const code = codeForStep(secret, currentStep());
      const result = await makeVerifyUseCase(repo).execute({
        challengeToken: challenge,
        code,
      });
      expect(result.accessToken).toBeTruthy();
      // Baseline advanced to the new step.
      expect(repo.rows.get('admin-1')!.mfaLastUsedStep).toBe(currentStep());
    });

    it('accepts a code on first verify when mfaLastUsedStep is NULL', async () => {
      // Edge case: admin enrolled long ago (before PR 10.7 shipped)
      // and is verifying for the first time after migration.
      // mfaLastUsedStep is null; any valid code should be accepted
      // and the baseline written.
      const { repo, secret } = setupEnrolled(null);
      const challenge = issueChallenge('admin-1');
      const code = codeForStep(secret, currentStep());
      const result = await makeVerifyUseCase(repo).execute({
        challengeToken: challenge,
        code,
      });
      expect(result.accessToken).toBeTruthy();
      expect(repo.rows.get('admin-1')!.mfaLastUsedStep).toBe(currentStep());
    });

    it('the same code presented twice in quick succession fails the second time', async () => {
      // The realistic replay attack: attacker captures code on the
      // first verify, replays before the 30s window closes.
      const { repo, secret } = setupEnrolled(null);
      const challenge = issueChallenge('admin-1');
      const code = codeForStep(secret, currentStep());

      // First verify succeeds.
      await makeVerifyUseCase(repo).execute({
        challengeToken: challenge,
        code,
      });

      // Second verify with the same code is now a replay (baseline
      // advanced after the first). Issue a fresh challenge since the
      // verify-use case might have minted a session and the
      // challenge token expires anyway after 5min — but for this
      // test we just need to reuse the SAME code, not the same
      // challenge. Issue a fresh challenge.
      const challenge2 = issueChallenge('admin-1');
      await expect(
        makeVerifyUseCase(repo).execute({ challengeToken: challenge2, code }),
      ).rejects.toBeInstanceOf(UnauthorizedAppException);
    });
  });

  describe('AdminMfaService.completeEnrollment', () => {
    it('seeds mfaLastUsedStep on enrollment completion', async () => {
      const repo = new FakeAdminRepo();
      const secret = generateTotpSecret();
      repo.rows.set('admin-1', {
        id: 'admin-1',
        email: 'admin@example.com',
        mfaEnabledAt: null,
        mfaPendingSecretCiphertext: makeCipher().encrypt(secret),
      });
      const code = codeForStep(secret, currentStep());
      await makeEnrollService(repo).completeEnrollment('admin-1', code);
      // Baseline is set to the enrollment-step. The next verify
      // with the same code (same step) will be rejected as a replay.
      expect(repo.rows.get('admin-1')!.mfaLastUsedStep).toBe(currentStep());
    });

    it('an enrollment code cannot be immediately replayed against the verify endpoint', async () => {
      // End-to-end attack: attacker watches the enrollment-complete
      // request go through, captures the code, tries to use the
      // same code against /admin/auth/mfa-verify before the 30s
      // window closes. mfaLastUsedStep is seeded by enrollment so
      // the replay fails.
      const repo = new FakeAdminRepo();
      const secret = generateTotpSecret();
      repo.rows.set('admin-1', {
        id: 'admin-1',
        email: 'admin@example.com',
        name: 'Admin One',
        role: 'SELLER_ADMIN',
        status: 'ACTIVE',
        mfaEnabledAt: null,
        mfaPendingSecretCiphertext: makeCipher().encrypt(secret),
      });
      const code = codeForStep(secret, currentStep());
      await makeEnrollService(repo).completeEnrollment('admin-1', code);

      // mfaSecretCiphertext is now populated. Attacker replays the
      // captured code against the challenge-verify endpoint.
      const challenge = issueChallenge('admin-1');
      await expect(
        makeVerifyUseCase(repo).execute({ challengeToken: challenge, code }),
      ).rejects.toBeInstanceOf(UnauthorizedAppException);
    });
  });
});
