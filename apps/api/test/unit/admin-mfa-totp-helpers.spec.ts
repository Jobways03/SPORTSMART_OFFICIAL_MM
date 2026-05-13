import 'reflect-metadata';
import {
  bufferToBase32,
  generateTotpSecret,
} from '../../src/modules/admin-mfa/domain/totp-secret';
import { buildOtpAuthUri } from '../../src/modules/admin-mfa/domain/totp-uri';

describe('TOTP secret generator (PR 10.1)', () => {
  it('produces a base32 string of the expected length for 20 bytes', () => {
    // 20 bytes = 160 bits. Base32 packs 5 bits per char, so
    // ceil(160/5) = 32 characters. No padding because our encoder
    // omits the `=` suffix.
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32);
  });

  it('contains only RFC 4648 base32 alphabet characters', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('returns a different secret on every call (CSPRNG, not pseudo-random)', () => {
    // 100 draws against a 160-bit space — collision probability is
    // 1/2^160 per pair, well below any reasonable flake threshold.
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(generateTotpSecret());
    }
    expect(seen.size).toBe(100);
  });

  describe('bufferToBase32', () => {
    it('encodes a known input correctly (RFC 4648 vector)', () => {
      // RFC 4648 §10 test vector: "foobar" → "MZXW6YTBOI" (unpadded).
      // Our encoder omits padding so this is the exact expected output.
      expect(bufferToBase32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    });

    it('encodes an empty buffer to an empty string', () => {
      expect(bufferToBase32(Buffer.alloc(0))).toBe('');
    });
  });
});

describe('otpauth URI builder (PR 10.1)', () => {
  const baseArgs = {
    issuer: 'SportsMart',
    account: 'admin@sportsmart.example.com',
    secret: 'JBSWY3DPEHPK3PXP', // example secret from Google Authenticator wiki
  };

  it('produces a well-formed otpauth://totp URI with all defaults', () => {
    const uri = buildOtpAuthUri(baseArgs);
    expect(uri).toMatch(
      /^otpauth:\/\/totp\/SportsMart:admin%40sportsmart\.example\.com\?/,
    );
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=SportsMart');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('URL-encodes account labels containing reserved characters', () => {
    const uri = buildOtpAuthUri({
      ...baseArgs,
      account: 'user+test@example.com',
    });
    // `+` and `@` both need percent-encoding in the label path.
    expect(uri).toContain('user%2Btest%40example.com');
  });

  it('encodes spaces in the issuer as %20 (not + per the otpauth spec)', () => {
    // Authenticator apps render the issuer as a display name; passing
    // "Sports Mart" must produce "Sports%20Mart" not "Sports+Mart"
    // because Google Authenticator and Authy parse the URI as a plain
    // URL where + means literal plus, not space.
    const uri = buildOtpAuthUri({
      ...baseArgs,
      issuer: 'Sports Mart',
    });
    expect(uri).toContain('Sports%20Mart');
    expect(uri).not.toContain('Sports+Mart');
  });

  it('overrides accept tightened algorithm / digits / period', () => {
    const uri = buildOtpAuthUri({
      ...baseArgs,
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
    });
    expect(uri).toContain('algorithm=SHA256');
    expect(uri).toContain('digits=8');
    expect(uri).toContain('period=60');
  });
});
