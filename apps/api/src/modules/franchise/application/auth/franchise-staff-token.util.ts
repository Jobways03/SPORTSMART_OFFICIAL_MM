import { createHash, randomBytes, randomUUID } from 'crypto';

/**
 * Phase 159u (staff-auth) — token helpers shared by the staff service (invite)
 * and the staff-auth service (login/refresh). Raw tokens go to the client; only
 * their SHA-256 hash is ever persisted (same contract as FranchiseSession).
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newRefreshToken(): { raw: string; hash: string } {
  const raw = randomUUID();
  return { raw, hash: hashToken(raw) };
}

export function newInviteToken(ttlHours = 72): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  // 32 bytes of CSPRNG entropy, url-safe — emailed in the activation link.
  const raw = randomBytes(32).toString('base64url');
  return {
    raw,
    hash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
  };
}
