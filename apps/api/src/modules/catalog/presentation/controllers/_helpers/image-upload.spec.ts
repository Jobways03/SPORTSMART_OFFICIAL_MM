/**
 * Phase 42 (2026-05-21) — locks the contract on the shared image-upload
 * helpers used by all four product/variant image controllers.
 */

import { IMAGE_MULTER_OPTIONS, sanitizeAltText, ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from './image-upload';

describe('IMAGE_MULTER_OPTIONS.fileFilter', () => {
  function run(mimetype: string): boolean {
    let accepted = false;
    IMAGE_MULTER_OPTIONS.fileFilter({} as any, { mimetype }, (_err, ok) => {
      accepted = ok;
    });
    return accepted;
  }

  it('accepts all listed MIME types', () => {
    for (const mime of ALLOWED_IMAGE_MIME_TYPES) {
      expect(run(mime)).toBe(true);
    }
  });

  it('rejects SVG', () => {
    expect(run('image/svg+xml')).toBe(false);
  });

  it('rejects PDF', () => {
    expect(run('application/pdf')).toBe(false);
  });

  it('rejects HTML', () => {
    expect(run('text/html')).toBe(false);
  });

  it('exposes the 5 MB cap', () => {
    expect(IMAGE_MULTER_OPTIONS.limits.fileSize).toBe(MAX_IMAGE_BYTES);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe('sanitizeAltText', () => {
  it('returns null for non-string input', () => {
    expect(sanitizeAltText(undefined)).toBeNull();
    expect(sanitizeAltText(null)).toBeNull();
    expect(sanitizeAltText(42 as any)).toBeNull();
    expect(sanitizeAltText({} as any)).toBeNull();
  });

  it('returns null for empty / whitespace strings', () => {
    expect(sanitizeAltText('')).toBeNull();
    expect(sanitizeAltText('   ')).toBeNull();
  });

  it('passes ordinary text through unchanged', () => {
    expect(sanitizeAltText('Red leather running shoe')).toBe('Red leather running shoe');
  });

  it('strips simple HTML tags', () => {
    expect(sanitizeAltText('Red <b>leather</b> shoe')).toBe('Red leather shoe');
  });

  it('strips script tags (leaves visible text, which React will escape)', () => {
    // The sanitizer is defence-in-depth — it strips angle-bracket
    // wrappers so a future renderer using innerHTML cannot execute
    // them. The textual payload remains; React's default JSX
    // escapes it in attribute position.
    expect(sanitizeAltText('<script>alert(1)</script>Shoe')).toBe('alert(1)Shoe');
  });

  it('caps at 160 characters', () => {
    const long = 'a'.repeat(500);
    const out = sanitizeAltText(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(160);
  });

  it('strips ASCII control characters', () => {
    const withControl = `Red${String.fromCharCode(0x00)}${String.fromCharCode(0x1F)}${String.fromCharCode(0x7F)}shoe`;
    expect(sanitizeAltText(withControl)).toBe('Redshoe');
  });
});
