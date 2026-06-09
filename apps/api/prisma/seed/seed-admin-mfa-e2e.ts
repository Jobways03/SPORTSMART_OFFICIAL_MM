/**
 * Enrolls a KNOWN, deterministic TOTP secret on the SUPER_ADMIN so:
 *   1. order-lifecycle E2E tests can complete the admin MFA challenge, and
 *   2. a super-admin whose MFA secret was reset can sign in again (SUPER_ADMIN
 *      logins are MFA-enrollment-enforced — admin-login.use-case.ts).
 *
 * It encrypts the secret EXACTLY as MfaSecretCipher does — AES-256-GCM, key
 * from ADMIN_MFA_ENCRYPTION_KEY (64-hex used verbatim, else SHA-256-derived),
 * packed as base64(iv[12] || ciphertext || authTag[16]) — and stamps
 * mfa_secret_ciphertext + mfa_enabled_at on the admin row.
 *
 * Dev/test ONLY. The secret is checked into the repo so tests can hardcode it;
 * never run this against a real admin.
 *
 * Run:
 *   pnpm --filter @sportsmart/api exec ts-node prisma/seed/seed-admin-mfa-e2e.ts
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL || 'admin@sportsmart.com';
// Deterministic 32-char base32 (20 bytes) secret — the canonical RFC test
// vector style value. Tests generate codes from this same string.
const SECRET_BASE32 =
  process.env.E2E_ADMIN_TOTP_SECRET || 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function loadKey(): Buffer {
  const raw = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  if (!raw) throw new Error('ADMIN_MFA_ENCRYPTION_KEY is required in .env');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

async function main() {
  const key = loadKey();
  const ciphertext = encrypt(SECRET_BASE32, key);

  const admin = await prisma.admin.update({
    where: { email: ADMIN_EMAIL },
    data: {
      mfaSecretCiphertext: ciphertext,
      mfaEnabledAt: new Date(),
      mfaPendingSecretCiphertext: null,
      mfaPendingExpiresAt: null,
      mfaLockUntil: null,
      failedMfaAttempts: 0,
    },
  });

  console.log(`✅ MFA enrolled on ${admin.email} (${admin.role})`);
  console.log(`   TOTP secret (base32): ${SECRET_BASE32}`);
  console.log('   Login flow: POST /admin/auth/login → mfaRequired + challengeToken,');
  console.log('   then complete the MFA challenge with a 6-digit code derived from');
  console.log('   this secret (RFC 6238, HMAC-SHA1, 30s step, 6 digits).');
}

main()
  .catch((err) => {
    console.error('seed-admin-mfa-e2e failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
