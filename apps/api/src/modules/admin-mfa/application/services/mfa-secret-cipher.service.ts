import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { BadRequestAppException } from '../../../../core/exceptions';

/**
 * Phase 10 (PR 10.2) — at-rest encryption for admin TOTP secrets.
 *
 * AES-256-GCM with a 32-byte key from `ADMIN_MFA_ENCRYPTION_KEY` and
 * a fresh 12-byte IV per encryption. The persisted column shape is
 * a SINGLE base64-encoded string with layout:
 *
 *   base64( iv[0..12) || ciphertext[12..N-16) || authTag[N-16..N) )
 *
 * The IV-prefix-plus-tag-suffix packing keeps the schema simple
 * (one nullable column per secret, see PR 10.1) and lets decrypt
 * split on fixed offsets without an extra IV-storage column. The
 * affiliate encryption service uses a two-column shape (separate
 * iv column) for inspectability; for TOTP secrets the single-column
 * shape is preferable because the secret is opaque anyway — there's
 * no human-readable inspection use case.
 *
 * Key-loading rules (same as AffiliateEncryptionService):
 *   - 64-char hex value (32 bytes after decoding) is used verbatim.
 *   - Any other string ≥32 chars is run through SHA-256 to derive a
 *     deterministic 32-byte key.
 *   - Missing / undefined key → constructor stores `null` so module
 *     bootstrap succeeds (dev/CI without the key still boots). Any
 *     subsequent encrypt() / decrypt() call throws a clear error.
 *     This shape was chosen so unrelated test modules aren't broken
 *     just because the MFA key isn't set; the error surfaces only on
 *     an actual MFA operation.
 *
 * Tampering / auth-tag mismatch: decrypt() throws BadRequestApp on
 * any GCM tag failure rather than silently returning garbage. The
 * caller (controller layer) surfaces it as a 400 so an attacker
 * can't distinguish "wrong key" from "tampered ciphertext" — both
 * present as opaque decrypt failures.
 */
@Injectable()
export class MfaSecretCipher {
  private readonly key: Buffer | null;

  constructor(envService: EnvService) {
    // EnvService.get() returns the raw value (possibly undefined or
    // empty); getString() would throw on a missing key. The cipher
    // must boot without the key (dev/CI) so unrelated test modules
    // aren't broken — encrypt/decrypt then surface the missing-key
    // condition only when actually invoked.
    const raw = envService.get('ADMIN_MFA_ENCRYPTION_KEY');
    if (raw === undefined || raw === null || raw === '') {
      this.key = null;
      return;
    }
    const str = String(raw);
    if (/^[0-9a-fA-F]{64}$/.test(str)) {
      this.key = Buffer.from(str, 'hex');
    } else {
      this.key = crypto.createHash('sha256').update(str, 'utf8').digest();
    }
  }

  /**
   * Returns true when the cipher is ready to encrypt/decrypt.
   * The Nest module wiring + the controllers that gate on this
   * use the flag to decide whether to expose the MFA endpoints
   * at all in dev (PR 10.3 wiring) vs. always-on in prod once
   * ADMIN_MFA_ENCRYPTION_KEY graduates to requiredInProd.
   */
  isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (this.key === null) {
      throw new BadRequestAppException(
        'ADMIN_MFA_ENCRYPTION_KEY is not configured; admin MFA secrets cannot be encrypted',
      );
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString('base64');
  }

  decrypt(packed: string): string {
    if (this.key === null) {
      throw new BadRequestAppException(
        'ADMIN_MFA_ENCRYPTION_KEY is not configured; admin MFA secrets cannot be decrypted',
      );
    }
    let data: Buffer;
    try {
      data = Buffer.from(packed, 'base64');
    } catch {
      throw new BadRequestAppException(
        'MFA secret payload is not valid base64',
      );
    }
    // Layout: [iv (12)] [ct (variable)] [tag (16)]. Minimum total is
    // 12 + 0 + 16 = 28 bytes — anything shorter is structurally bad.
    if (data.length < 28) {
      throw new BadRequestAppException(
        'MFA secret payload is too short to contain IV + tag',
      );
    }
    const iv = data.subarray(0, 12);
    const tag = data.subarray(data.length - 16);
    const ct = data.subarray(12, data.length - 16);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch {
      throw new BadRequestAppException(
        'MFA secret could not be decrypted (key mismatch or tampering)',
      );
    }
  }
}
