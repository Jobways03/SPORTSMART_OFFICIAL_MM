import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { BadRequestAppException } from '../../../../core/exceptions';

/**
 * Column-level encryption helper for affiliate PII (PAN, Aadhaar,
 * bank account number). AES-256-GCM with a 32-byte key from env
 * (`AFFILIATE_ENCRYPTION_KEY`) and a fresh 12-byte IV per record.
 *
 * Stored columns:
 *   {field}Enc — base64( ciphertext || authTag )
 *   {field}Iv  — base64( IV )
 *
 * To rotate the key in production: read all rows with the old key,
 * decrypt, re-encrypt with the new key, write back. Keep the old
 * key around as a fallback during the rolling rotation.
 */
@Injectable()
export class AffiliateEncryptionService {
  private readonly key: Buffer;

  constructor(envService: EnvService) {
    const raw = envService.getString('AFFILIATE_ENCRYPTION_KEY');
    // Accept either a 64-char hex (32 bytes) or any string ≥32 bytes
    // long when interpreted as utf-8 — derive a deterministic key
    // from it via SHA-256 in that case.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      this.key = crypto.createHash('sha256').update(raw, 'utf8').digest();
    }
  }

  /**
   * Encrypt a plaintext string. Returns { enc, iv } both base64.
   * Caller stores both columns. Empty / null input returns null
   * (caller decides whether the field is required).
   */
  encrypt(plaintext: string | null | undefined): { enc: string; iv: string } | null {
    if (!plaintext) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      enc: Buffer.concat([ct, tag]).toString('base64'),
      iv: iv.toString('base64'),
    };
  }

  /**
   * Decrypt back to plaintext. Throws if the ciphertext was tampered
   * with (auth-tag mismatch) — surfaces as a 400 to the caller, which
   * is what we want: never silently return garbage.
   */
  decrypt(enc: string, iv: string): string {
    try {
      const ivBuf = Buffer.from(iv, 'base64');
      const data = Buffer.from(enc, 'base64');
      // Last 16 bytes of `data` are the GCM auth tag.
      const tag = data.subarray(data.length - 16);
      const ct = data.subarray(0, data.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, ivBuf);
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
}
