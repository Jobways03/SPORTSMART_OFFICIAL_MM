/**
 * One-off ops script — enroll MFA for staging test admin accounts.
 *
 * Context: since 2026-06-22 every admin role is hard-blocked at login unless
 * MFA is enrolled (AdminLoginUseCase). The scoped test users created for the
 * seller-type isolation testing (d2c-admin@ / retail-admin@) had no MFA, so they
 * could not sign in. This mints a TOTP secret for each, encrypts it with the
 * SAME AES-256-GCM scheme the app uses (MfaSecretCipher), writes it to the Admin
 * row, and prints an otpauth:// URI so the secret can be added to an
 * authenticator app. No app-source imports — safe to run from the dist-only
 * image via `node` over stdin.
 *
 * Run as a one-off ECS task using the API task def (so ADMIN_MFA_ENCRYPTION_KEY
 * + DATABASE_URL are injected). Reversible: clearing the mfa_* columns (or the
 * admin self-service /admin/mfa/disable) undoes it.
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const TARGET_EMAILS = [
  'd2c-admin@sportsmart.com',
  'retail-admin@sportsmart.com',
];
const ISSUER = process.env.APP_NAME || 'SportsMart';

// ── Key loading — identical rule to MfaSecretCipher ──────────────────────
function loadKey() {
  const raw = process.env.ADMIN_MFA_ENCRYPTION_KEY;
  if (!raw) throw new Error('ADMIN_MFA_ENCRYPTION_KEY is not set');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest();
}

// ── base32 (RFC 4648, no padding) — identical to totp-secret.ts ──────────
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function bufferToBase32(buf) {
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
function generateTotpSecret() {
  return bufferToBase32(crypto.randomBytes(20)); // 160-bit per RFC 4226
}

// ── AES-256-GCM pack: base64(iv[12] || ct || tag[16]) — MfaSecretCipher ──
function encrypt(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

// ── otpauth:// URI — identical to totp-uri.ts (SHA1/6/30) ─────────────────
function buildOtpAuthUri({ issuer, account, secret }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('issuer', issuer);
  params.set('algorithm', 'SHA1');
  params.set('digits', '6');
  params.set('period', '30');
  const query = params.toString().replace(/\+/g, '%20');
  return `otpauth://totp/${label}?${query}`;
}

async function main() {
  const key = loadKey();
  const prisma = new PrismaClient();
  try {
    for (const email of TARGET_EMAILS) {
      const admin = await prisma.admin.findUnique({
        where: { email },
        select: { id: true, role: true, email: true },
      });
      if (!admin) {
        console.log(`SKIP  ${email} — no such admin`);
        continue;
      }
      const secret = generateTotpSecret();
      await prisma.admin.update({
        where: { id: admin.id },
        data: {
          mfaSecretCiphertext: encrypt(key, secret),
          mfaEnabledAt: new Date(),
          mfaPendingSecretCiphertext: null,
          mfaPendingExpiresAt: null,
          mfaLastUsedStep: null,
          mfaBackupCodesHashes: null,
          failedMfaAttempts: 0,
          mfaLockUntil: null,
        },
      });
      const uri = buildOtpAuthUri({ issuer: ISSUER, account: email, secret });
      console.log(`OK    ${email} (${admin.role})`);
      console.log(`  secret: ${secret}`);
      console.log(`  otpauth: ${uri}`);
    }
    console.log('DONE');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
