/**
 * Bootstrap MFA enrollment for the seed SUPER_ADMIN.
 *
 * Why this exists: a SUPER_ADMIN is hard-blocked at login until MFA is
 * enrolled (admin-login.use-case.ts), but the enrollment endpoints are
 * guarded by AdminAuthGuard — which needs a session you can't get without
 * MFA. This one-off script closes that first-login chicken-and-egg by
 * enrolling MFA directly, reusing the EXACT same crypto the runtime uses:
 *   - 20-byte base32 TOTP secret (domain/totp-secret.ts)
 *   - AES-256-GCM, base64(iv12 || ct || tag16) (mfa-secret-cipher.service.ts)
 *   - RFC 6238 SHA1 / 6-digit / 30s codes (domain/totp-verify.ts)
 *
 * Run from apps/api:  npx ts-node prisma/scripts/enroll-superadmin-mfa.ts
 *
 * Prints the base32 secret + otpauth URI (add to your authenticator app)
 * and a live code so you can verify immediately. Re-running rotates the
 * secret (overwrites the previous one).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createHash, createHmac, randomBytes } from 'crypto';

const EMAIL = process.env.ADMIN_SEED_EMAIL || 'admin@sportsmart.com';
const APP_NAME = process.env.APP_NAME || 'SportsMart';
const KEY_RAW = process.env.ADMIN_MFA_ENCRYPTION_KEY;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function bufferToBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]!;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32ToBuffer(input: string): Buffer {
  const cleaned = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function loadKey(raw?: string): Buffer {
  if (!raw) throw new Error('ADMIN_MFA_ENCRYPTION_KEY is not set in the environment.');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  if (raw.length >= 32) return createHash('sha256').update(raw, 'utf8').digest();
  throw new Error('ADMIN_MFA_ENCRYPTION_KEY must be 64 hex chars or a >=32-char string.');
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

function computeTotp(secret: string, step: number): string {
  const secretBuf = base32ToBuffer(secret);
  const stepBuf = Buffer.alloc(8);
  stepBuf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  stepBuf.writeUInt32BE(step & 0xffffffff, 4);
  const hmac = createHmac('sha1', secretBuf).update(stepBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const truncated =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(truncated % 1_000_000).padStart(6, '0');
}

function buildOtpAuthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('issuer', issuer);
  params.set('algorithm', 'SHA1');
  params.set('digits', '6');
  params.set('period', '30');
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`;
}

async function main(): Promise<void> {
  const key = loadKey(KEY_RAW);
  const prisma = new PrismaClient();
  try {
    const admin = await prisma.admin.findUnique({
      where: { email: EMAIL },
      select: { id: true, email: true, role: true },
    });
    if (!admin) {
      console.error(`No admin found with email ${EMAIL}. Run the admin seed first.`);
      process.exit(1);
    }

    const secret = generateSecret();
    const ciphertext = encrypt(secret, key);

    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        mfaSecretCiphertext: ciphertext,
        mfaEnabledAt: new Date(),
        mfaPendingSecretCiphertext: null,
        mfaPendingExpiresAt: null,
        mfaLastUsedStep: null,
        failedMfaAttempts: 0,
        mfaLockUntil: null,
      },
    });

    const step = Math.floor(Date.now() / 1000 / 30);
    const code = computeTotp(secret, step);
    const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);

    console.log('\n================ SUPER_ADMIN MFA ENROLLED ================');
    console.log(`Account      : ${admin.email} (${admin.role})`);
    console.log(`Secret (base32): ${secret}`);
    console.log(`otpauth URI  : ${buildOtpAuthUri(APP_NAME, admin.email, secret)}`);
    console.log(`Current code : ${code}   (valid ${secondsLeft}s more)`);
    console.log('==========================================================');
    console.log('Add the secret (or scan the otpauth URI as a QR) into Google');
    console.log('Authenticator / Authy / 1Password. Then log in with your');
    console.log('password; when prompted for the 6-digit code, use the app.');
    console.log('==========================================================\n');
  } finally {
    await prisma.$disconnect();
  }
}

function generateSecret(): string {
  return bufferToBase32(randomBytes(20));
}

main().catch((err) => {
  console.error('Failed to enroll MFA:', err);
  process.exit(1);
});
