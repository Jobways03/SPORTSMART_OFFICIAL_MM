import 'reflect-metadata';
import { AdminMfaService } from '../../src/modules/admin-mfa/application/services/admin-mfa.service';
import { MfaSecretCipher } from '../../src/modules/admin-mfa/application/services/mfa-secret-cipher.service';
import { generateTotpSecret } from '../../src/modules/admin-mfa/domain/totp-secret';
import { verifyTotpCode } from '../../src/modules/admin-mfa/domain/totp-verify';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../src/core/exceptions';

// Phase 10 (PR 10.4) — AdminMfaService enrollment tests.
//
// Covers the orchestration the service owns: refusal semantics
// (not-found, already-enrolled, no pending), the begin → complete
// happy path, ciphertext round-trip through the cipher, and the
// atomic commit shape on success.

const KEY = 'a'.repeat(64);

function makeCipher(): MfaSecretCipher {
  return new MfaSecretCipher({
    get: (k: string) => (k === 'ADMIN_MFA_ENCRYPTION_KEY' ? KEY : undefined),
  } as any);
}

function makeEnv(appName: string = 'SportsMart') {
  return {
    getString: (k: string, fallback?: string) =>
      k === 'APP_NAME' ? appName : (fallback ?? ''),
  } as any;
}

interface MockAdminRow {
  id: string;
  email?: string;
  mfaEnabledAt?: Date | null;
  mfaPendingSecretCiphertext?: string | null;
  mfaSecretCiphertext?: string | null;
}

class FakeAdminRepo {
  public rows = new Map<string, MockAdminRow>();
  public updates: Array<{ id: string; data: Record<string, unknown> }> = [];

  async findAdminById(adminId: string, _select?: Record<string, boolean>) {
    return this.rows.get(adminId) ?? null;
  }

  async updateAdmin(adminId: string, data: Record<string, unknown>) {
    this.updates.push({ id: adminId, data });
    const row = this.rows.get(adminId);
    if (row) {
      Object.assign(row, data);
    }
  }
}

function buildService(repoOverride?: FakeAdminRepo) {
  const repo = repoOverride ?? new FakeAdminRepo();
  const cipher = makeCipher();
  const env = makeEnv();
  // PR 10.9 — pass-through backup-codes stub. generateAndHashForAdmin
  // is called by completeEnrollment; the consume/remainingCount
  // surface isn't exercised by these tests (the login-challenge and
  // replay-defence specs cover the consume path).
  const backupCodes = {
    generateAndHashForAdmin: async () =>
      Array.from({ length: 10 }, (_, i) => `code-${i}`),
    consume: async () => false,
    remainingCount: async () => 0,
  } as any;
  const svc = new AdminMfaService(repo as any, cipher, env, backupCodes);
  return { svc, repo, cipher };
}

describe('AdminMfaService.beginEnrollment (PR 10.4)', () => {
  it('returns an otpauth URL with the admin email as the label', async () => {
    const { svc, repo } = buildService();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: null,
    });
    const result = await svc.beginEnrollment('admin-1');
    expect(result.otpAuthUrl).toContain('otpauth://totp/SportsMart:admin%40example.com');
    expect(result.otpAuthUrl).toContain('secret=');
  });

  it('persists an encrypted pending secret on the admin row', async () => {
    const { svc, repo, cipher } = buildService();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: null,
    });
    const result = await svc.beginEnrollment('admin-1');

    // One write happened, against the pending column.
    expect(repo.updates).toHaveLength(1);
    const ciphertext = repo.updates[0].data.mfaPendingSecretCiphertext as string;
    expect(ciphertext).toBeTruthy();
    // The ciphertext should decrypt back to the same secret the
    // otpauth URL embeds — proves we're not double-generating.
    const decrypted = cipher.decrypt(ciphertext);
    expect(decrypted).toBe(result.secret);
  });

  it('rejects an already-enrolled admin with 409', async () => {
    const { svc, repo } = buildService();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: new Date('2025-01-01'),
    });
    await expect(svc.beginEnrollment('admin-1')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('rejects a missing admin with 404', async () => {
    const { svc } = buildService();
    await expect(svc.beginEnrollment('does-not-exist')).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
  });

  it('rejects an admin without an email (defensive)', async () => {
    const { svc, repo } = buildService();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: undefined,
      mfaEnabledAt: null,
    });
    await expect(svc.beginEnrollment('admin-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('starting over after a previous incomplete enrollment overwrites the pending secret', async () => {
    const { svc, repo } = buildService();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: null,
      mfaPendingSecretCiphertext: 'previous-attempt-ciphertext',
    });
    await svc.beginEnrollment('admin-1');
    const ciphertext = repo.updates[0].data.mfaPendingSecretCiphertext as string;
    expect(ciphertext).not.toBe('previous-attempt-ciphertext');
  });
});

describe('AdminMfaService.completeEnrollment (PR 10.4)', () => {
  it('verifies code, commits pending → live, sets mfaEnabledAt', async () => {
    const { svc, repo, cipher } = buildService();
    // Seed a pending secret manually (skipping beginEnrollment to
    // control the secret value for the verify step).
    const secret = generateTotpSecret();
    const pendingCt = cipher.encrypt(secret);
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: null,
      mfaPendingSecretCiphertext: pendingCt,
    });

    // Brute-compute the code for the current step (matches the
    // verifier's default window=±1, so this works against the
    // current second).
    const currentCode = computeCurrentCode(secret);

    await svc.completeEnrollment('admin-1', currentCode);

    expect(repo.updates).toHaveLength(1);
    const update = repo.updates[0].data;
    // Live column gets the pending ciphertext.
    expect(update.mfaSecretCiphertext).toBe(pendingCt);
    // Pending column is cleared.
    expect(update.mfaPendingSecretCiphertext).toBeNull();
    // enrolled-at is set to a recent timestamp.
    expect(update.mfaEnabledAt).toBeInstanceOf(Date);
    const enrolledMs = (update.mfaEnabledAt as Date).getTime();
    expect(Math.abs(Date.now() - enrolledMs)).toBeLessThan(5000);
  });

  it('rejects when no pending enrollment exists', async () => {
    const { svc, repo } = buildService();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: null,
      mfaPendingSecretCiphertext: null,
    });
    await expect(svc.completeEnrollment('admin-1', '123456')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('rejects an already-enrolled admin', async () => {
    const { svc, repo, cipher } = buildService();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: new Date('2025-01-01'),
      mfaPendingSecretCiphertext: cipher.encrypt('SOMESECRET'),
    });
    await expect(svc.completeEnrollment('admin-1', '123456')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('rejects an invalid code with 400', async () => {
    const { svc, repo, cipher } = buildService();
    const secret = generateTotpSecret();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: null,
      mfaPendingSecretCiphertext: cipher.encrypt(secret),
    });
    // 000000 has a ~3-in-a-million chance of matching the actual
    // current-step code; effectively always wrong.
    await expect(svc.completeEnrollment('admin-1', '000000')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    // No commit on failure — pending stays in place.
    expect(repo.updates).toHaveLength(0);
  });

  it('rejects a missing admin', async () => {
    const { svc } = buildService();
    await expect(
      svc.completeEnrollment('does-not-exist', '123456'),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('AdminMfaService — end-to-end begin → complete (PR 10.4)', () => {
  it('a fresh admin completes the round-trip', async () => {
    const { svc, repo } = buildService();
    repo.rows.set('admin-1', {
      id: 'admin-1',
      email: 'admin@example.com',
      mfaEnabledAt: null,
    });

    // 1. begin — get otpauth URL and the cleartext secret
    const { secret } = await svc.beginEnrollment('admin-1');
    // The fake repo applies updates back onto the row, so the
    // pending column is now populated.
    expect(repo.rows.get('admin-1')!.mfaPendingSecretCiphertext).toBeTruthy();

    // 2. complete with the current-step code derived from the secret
    const code = computeCurrentCode(secret);
    await svc.completeEnrollment('admin-1', code);

    // 3. row reflects committed state
    const row = repo.rows.get('admin-1')!;
    expect(row.mfaSecretCiphertext).toBeTruthy();
    expect(row.mfaPendingSecretCiphertext).toBeNull();
    expect(row.mfaEnabledAt).toBeInstanceOf(Date);
  });
});

// Helper — replicates the verifier's computation to get the
// current-step code without exporting computeTotpCode from the
// verifier module.
function computeCurrentCode(secretBase32: string): string {
  // Brute-force a code by trying values until verifyTotpCode says yes
  // is too slow; replicate the algorithm directly.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHmac } = require('crypto');
  // Reuse the verifier's exported base32 decoder.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { base32ToBuffer } = require('../../src/modules/admin-mfa/domain/totp-verify');
  const buf = base32ToBuffer(secretBase32);
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

// Smoke-check the helper itself so a future change to the verifier
// can't make the enrollment tests pass against a broken verifier.
describe('test-helper sanity (PR 10.4)', () => {
  it('computeCurrentCode produces a code the verifier accepts', () => {
    const secret = generateTotpSecret();
    const code = computeCurrentCode(secret);
    expect(verifyTotpCode({ secret, code }).valid).toBe(true);
  });
});
