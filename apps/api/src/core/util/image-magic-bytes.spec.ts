// Phase 96 (2026-05-23) — Phase 97 audit Gap #4 closure coverage.

import { detectImageMime, validateImageUpload } from './image-magic-bytes';

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const GIF89_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const EXE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]); // MZ
const RANDOM = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

describe('detectImageMime (Phase 96)', () => {
  it('detects JPEG', () => {
    expect(detectImageMime(JPEG_HEADER)).toBe('image/jpeg');
  });
  it('detects PNG', () => {
    expect(detectImageMime(PNG_HEADER)).toBe('image/png');
  });
  it('detects WEBP', () => {
    expect(detectImageMime(WEBP_HEADER)).toBe('image/webp');
  });
  it('detects GIF', () => {
    expect(detectImageMime(GIF89_HEADER)).toBe('image/gif');
  });
  it('rejects EXE header', () => {
    expect(detectImageMime(EXE_HEADER)).toBeNull();
  });
  it('rejects random bytes', () => {
    expect(detectImageMime(RANDOM)).toBeNull();
  });
});

describe('validateImageUpload (Phase 96)', () => {
  it('accepts PNG with matching mime', () => {
    expect(validateImageUpload(PNG_HEADER, 'image/png')).toEqual({
      ok: true,
      detected: 'image/png',
    });
  });

  it('normalizes image/jpg → image/jpeg', () => {
    expect(validateImageUpload(JPEG_HEADER, 'image/jpg')).toEqual({
      ok: true,
      detected: 'image/jpeg',
    });
  });

  it('rejects mismatch (PNG buffer / claimed image/jpeg)', () => {
    const result = validateImageUpload(PNG_HEADER, 'image/jpeg');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/does not match/);
    }
  });

  it('rejects EXE polyglot', () => {
    const result = validateImageUpload(EXE_HEADER, 'image/png');
    expect(result.ok).toBe(false);
  });

  it('rejects GIF when not in allowlist', () => {
    const result = validateImageUpload(GIF89_HEADER, 'image/gif');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not in allowed list/);
    }
  });

  it('accepts GIF when explicitly allowed', () => {
    expect(
      validateImageUpload(GIF89_HEADER, 'image/gif', [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ]),
    ).toEqual({ ok: true, detected: 'image/gif' });
  });
});
