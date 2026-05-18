import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { BadRequestAppException } from '../../../../core/exceptions';

/**
 * Column-level encryption helper for affiliate PII (PAN, Aadhaar,
 * bank account number). AES-256-GCM with a 32-byte key and a fresh
 * 12-byte IV per record.
 *
 * Stored columns:
 *   {field}Enc — base64( ciphertext || authTag ), optionally prefixed
 *                with "v<N>:" to declare which key version produced it.
 *   {field}Iv  — base64( IV )
 *
 * # Key rotation (Phase 7 — 2026-05-16)
 *
 * Pre-Phase-7 this service supported only a single key from
 * `AFFILIATE_ENCRYPTION_KEY` and rotation required a giant "decrypt
 * with old, re-encrypt with new" backfill before the old key could be
 * retired. With versioning:
 *
 *   1. Declare both old + new keys in `AFFILIATE_ENCRYPTION_KEYS`
 *      (format: "v1=<64hex>,v2=<64hex>").
 *   2. Set `AFFILIATE_ENCRYPTION_ACTIVE_VERSION=v2` — new writes use
 *      v2 and carry a "v2:" prefix in the enc column.
 *   3. Old rows (no prefix) continue to decrypt with the unversioned
 *      `AFFILIATE_ENCRYPTION_KEY` (treated as v0).
 *   4. Re-encrypt at leisure; once every row is v2, drop the v0 key
 *      from `AFFILIATE_ENCRYPTION_KEYS` and the env entry.
 *
 * The format is forward-compatible: any future change (e.g. AES-GCM-SIV)
 * can sit behind a new version prefix without touching existing rows.
 */
@Injectable()
export class AffiliateEncryptionService {
  private readonly logger = new Logger(AffiliateEncryptionService.name);

  /** v0 = the unversioned legacy key. */
  private readonly legacyKey: Buffer;
  /** Map of versionId → key buffer. v0 is always present (legacy). */
  private readonly keyVersions: Map<string, Buffer>;
  /** Version used for NEW encryptions. Defaults to 'v0' (legacy). */
  private readonly activeVersion: string;

  constructor(envService: EnvService) {
    const raw = envService.getString('AFFILIATE_ENCRYPTION_KEY');
    this.legacyKey = this.deriveKey(raw);

    this.keyVersions = new Map();
    this.keyVersions.set('v0', this.legacyKey);

    // Optional multi-key map: "v1=<64hex>,v2=<64hex>". Each entry must
    // be exactly 64 hex chars (32 bytes) — anything else is rejected
    // at boot so a typo can't silently corrupt new rows.
    const rotationEnv = envService.getString('AFFILIATE_ENCRYPTION_KEYS', '');
    if (rotationEnv.trim()) {
      for (const piece of rotationEnv.split(',')) {
        const [version, value] = piece.split('=').map((s) => (s ?? '').trim());
        if (!version || !value) continue;
        if (!/^v\d+$/.test(version)) {
          throw new Error(
            `AFFILIATE_ENCRYPTION_KEYS: version "${version}" must be like "v1", "v2"`,
          );
        }
        if (!/^[0-9a-fA-F]{64}$/.test(value)) {
          throw new Error(
            `AFFILIATE_ENCRYPTION_KEYS: key for ${version} must be 64 hex chars (32 bytes)`,
          );
        }
        this.keyVersions.set(version, Buffer.from(value, 'hex'));
      }
    }

    const requested = envService.getString('AFFILIATE_ENCRYPTION_ACTIVE_VERSION', '');
    if (requested && !this.keyVersions.has(requested)) {
      throw new Error(
        `AFFILIATE_ENCRYPTION_ACTIVE_VERSION="${requested}" not present in AFFILIATE_ENCRYPTION_KEYS map`,
      );
    }
    this.activeVersion = requested || 'v0';
    if (this.activeVersion !== 'v0') {
      this.logger.log(
        `Affiliate encryption active version is ${this.activeVersion}; legacy v0 still readable as fallback`,
      );
    }
  }

  /**
   * Encrypt a plaintext string. Returns { enc, iv } both base64. The
   * `enc` value is prefixed with the active version (e.g. "v2:") so
   * decrypt can pick the right key without consulting the schema.
   * Empty / null input returns null (caller decides whether the field
   * is required).
   */
  encrypt(plaintext: string | null | undefined): { enc: string; iv: string } | null {
    if (!plaintext) return null;
    const iv = crypto.randomBytes(12);
    const key = this.keyVersions.get(this.activeVersion);
    if (!key) {
      // Defensive — constructor validates, but a hot-config flip
      // outside the constructor wouldn't catch it.
      throw new Error(
        `Affiliate encryption: active version ${this.activeVersion} has no key registered`,
      );
    }
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([ct, tag]).toString('base64');
    // v0 stays unprefixed for backward compatibility with rows written
    // before this versioning was introduced.
    const enc = this.activeVersion === 'v0' ? payload : `${this.activeVersion}:${payload}`;
    return { enc, iv: iv.toString('base64') };
  }

  /**
   * Decrypt back to plaintext. Picks the key by version prefix; rows
   * with no prefix are treated as v0 (legacy). Throws if the
   * ciphertext was tampered with (auth-tag mismatch) — surfaces as a
   * 400 to the caller, which is what we want: never silently return
   * garbage.
   */
  decrypt(enc: string, iv: string): string {
    try {
      const { version, payload } = this.parseEnvelope(enc);
      const key = this.keyVersions.get(version);
      if (!key) {
        throw new Error(
          `Affiliate encryption: no key registered for version ${version}`,
        );
      }
      const ivBuf = Buffer.from(iv, 'base64');
      const data = Buffer.from(payload, 'base64');
      // Last 16 bytes of `data` are the GCM auth tag.
      const tag = data.subarray(data.length - 16);
      const ct = data.subarray(0, data.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch {
      throw new BadRequestAppException(
        'Encrypted payload could not be decrypted (key mismatch or tampering)',
      );
    }
  }

  /**
   * Convenience for the schema's last-4 mirror field. Plaintext last
   * 4 chars are stored alongside the ciphertext for searchable lookups
   * (duplicate-PAN / duplicate-bank fraud detection without bulk
   * decrypt).
   */
  last4(plaintext: string): string {
    const trimmed = plaintext.replace(/\s+/g, '').trim();
    return trimmed.slice(-4);
  }

  /**
   * For ops: report which version each row was encrypted with, so the
   * rotation backfill cron can target only rows still on old versions.
   */
  versionOf(enc: string): string {
    return this.parseEnvelope(enc).version;
  }

  // ── Internal helpers ───────────────────────────────────────────

  private deriveKey(raw: string): Buffer {
    // Accept either a 64-char hex (32 bytes) or any string ≥32 bytes
    // long when interpreted as utf-8 — derive a deterministic key
    // from it via SHA-256 in that case.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }
    return crypto.createHash('sha256').update(raw, 'utf8').digest();
  }

  private parseEnvelope(enc: string): { version: string; payload: string } {
    // New format: "v<N>:<base64>" — anything else is v0 legacy.
    const match = /^(v\d+):(.+)$/.exec(enc);
    if (match) return { version: match[1]!, payload: match[2]! };
    return { version: 'v0', payload: enc };
  }
}
