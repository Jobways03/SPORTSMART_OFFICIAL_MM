import 'reflect-metadata';
import { MfaSecretCipher } from '../../src/modules/admin-mfa/application/services/mfa-secret-cipher.service';

// Phase 10 (PR 10.2) — MfaSecretCipher (AES-256-GCM, single-column layout).
//
// Tests cover the round-trip, the auth-tag tampering defence, the
// wrong-key failure mode, and the unconfigured-key fail-fast.
// Together these are the invariants the enrollment + verification
// flows (PR 10.3+) lean on.

// Hex key (64 chars = 32 bytes) — the cipher uses verbatim when the
// regex matches, otherwise it SHA-256-derives. Two distinct hex keys
// for the wrong-key test.
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

function makeEnv(value: string | undefined): any {
  return {
    get: (k: string) => (k === 'ADMIN_MFA_ENCRYPTION_KEY' ? value : undefined),
  };
}

describe('MfaSecretCipher (PR 10.2)', () => {
  describe('isConfigured', () => {
    it('returns true when ADMIN_MFA_ENCRYPTION_KEY is set', () => {
      const c = new MfaSecretCipher(makeEnv(KEY_A));
      expect(c.isConfigured()).toBe(true);
    });

    it('returns false when the key is missing', () => {
      const c = new MfaSecretCipher(makeEnv(undefined));
      expect(c.isConfigured()).toBe(false);
    });

    it('returns false when the key is empty string', () => {
      // Distinguishes "env declared but blank" from "absent". Both
      // mean unconfigured.
      const c = new MfaSecretCipher(makeEnv(''));
      expect(c.isConfigured()).toBe(false);
    });
  });

  describe('round-trip', () => {
    it('encrypt then decrypt returns the original plaintext', () => {
      const c = new MfaSecretCipher(makeEnv(KEY_A));
      const original = 'JBSWY3DPEHPK3PXP'; // example TOTP secret
      const packed = c.encrypt(original);
      expect(c.decrypt(packed)).toBe(original);
    });

    it('encrypts the same plaintext to a different ciphertext each call (fresh IV)', () => {
      // Same plaintext + same key — the IV is randomBytes per encrypt,
      // so the packed output must differ. If a future refactor
      // accidentally reuses the IV the security model collapses
      // (GCM IV reuse leaks the keystream and the auth tag).
      const c = new MfaSecretCipher(makeEnv(KEY_A));
      const pt = 'JBSWY3DPEHPK3PXP';
      const a = c.encrypt(pt);
      const b = c.encrypt(pt);
      expect(a).not.toBe(b);
    });

    it('produces base64 output of the expected length range', () => {
      const c = new MfaSecretCipher(makeEnv(KEY_A));
      // 32-byte plaintext → 12 IV + 32 ct + 16 tag = 60 bytes → 80 base64 chars.
      // The exact length is deterministic for a fixed plaintext length.
      const pt = 'X'.repeat(32);
      const packed = c.encrypt(pt);
      expect(packed).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64 alphabet
      expect(packed.length).toBe(80);
    });
  });

  describe('tampering detection', () => {
    it('rejects a ciphertext whose auth tag has been flipped', () => {
      const c = new MfaSecretCipher(makeEnv(KEY_A));
      const packed = c.encrypt('JBSWY3DPEHPK3PXP');
      // Flip a bit in the auth tag (last 16 bytes of the base64-
      // decoded payload). Easiest way: decode, mutate, re-encode.
      const buf = Buffer.from(packed, 'base64');
      buf[buf.length - 1] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => c.decrypt(tampered)).toThrow(/decrypted/i);
    });

    it('rejects a ciphertext whose ciphertext body has been flipped', () => {
      const c = new MfaSecretCipher(makeEnv(KEY_A));
      const packed = c.encrypt('JBSWY3DPEHPK3PXP');
      const buf = Buffer.from(packed, 'base64');
      // Middle byte is in the ciphertext range (between IV and tag).
      buf[buf.length / 2 | 0] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => c.decrypt(tampered)).toThrow(/decrypted/i);
    });

    it('rejects a payload shorter than IV + tag combined', () => {
      const c = new MfaSecretCipher(makeEnv(KEY_A));
      const tooShort = Buffer.alloc(20).toString('base64'); // 20 < 12+16
      expect(() => c.decrypt(tooShort)).toThrow(/too short/i);
    });
  });

  describe('wrong-key failure', () => {
    it('cipher built with KEY_B cannot decrypt a ciphertext made with KEY_A', () => {
      const a = new MfaSecretCipher(makeEnv(KEY_A));
      const b = new MfaSecretCipher(makeEnv(KEY_B));
      const packed = a.encrypt('JBSWY3DPEHPK3PXP');
      expect(() => b.decrypt(packed)).toThrow(/decrypted/i);
    });
  });

  describe('unconfigured key', () => {
    it('encrypt throws a clear error when the key is missing', () => {
      const c = new MfaSecretCipher(makeEnv(undefined));
      expect(() => c.encrypt('anything')).toThrow(/ADMIN_MFA_ENCRYPTION_KEY/);
    });

    it('decrypt throws a clear error when the key is missing', () => {
      const c = new MfaSecretCipher(makeEnv(undefined));
      expect(() => c.decrypt('anything')).toThrow(/ADMIN_MFA_ENCRYPTION_KEY/);
    });

    it('the module can still be instantiated without a key (no constructor throw)', () => {
      // The deliberate design: unconfigured key must not break module
      // bootstrap. Tests of unrelated modules don't carry the MFA
      // key and shouldn't fail because of this service.
      expect(() => new MfaSecretCipher(makeEnv(undefined))).not.toThrow();
    });
  });

  describe('key derivation', () => {
    it('accepts a non-hex string ≥32 chars (SHA-256 derives the key)', () => {
      // The fallback path: any utf-8 string is hashed to 32 bytes via
      // SHA-256. The cipher should round-trip cleanly under this path.
      const c = new MfaSecretCipher(
        makeEnv('replace-me-with-a-strong-random-string-min32-chars'),
      );
      const pt = 'JBSWY3DPEHPK3PXP';
      const packed = c.encrypt(pt);
      expect(c.decrypt(packed)).toBe(pt);
    });
  });
});
