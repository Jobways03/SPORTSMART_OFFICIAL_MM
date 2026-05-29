// Phase 95 (2026-05-23) — coverage for shared text sanitizer.

import { sanitizeText, sanitizeOptionalText } from './sanitize-text';

describe('sanitizeText', () => {
  it('strips HTML tags', () => {
    expect(sanitizeText('Hello <script>alert(1)</script> world')).toBe(
      'Hello alert(1) world',
    );
  });

  it('strips control chars', () => {
    expect(sanitizeText('Hello\x00\x07world')).toBe('Helloworld');
  });

  it('collapses whitespace', () => {
    expect(sanitizeText('a   b\n\n c')).toBe('a b c');
  });

  it('caps at maxLength', () => {
    expect(sanitizeText('a'.repeat(200), { maxLength: 50 })).toHaveLength(50);
  });

  it('returns null on empty / whitespace-only', () => {
    expect(sanitizeText('   ')).toBeNull();
    expect(sanitizeText('')).toBeNull();
    expect(sanitizeText(null)).toBeNull();
    expect(sanitizeText(undefined)).toBeNull();
  });

  it('returns empty string when nullifyEmpty=false', () => {
    expect(sanitizeText('   ', { nullifyEmpty: false })).toBe('');
  });
});

describe('sanitizeOptionalText', () => {
  it('returns undefined for undefined input (DTO-friendly)', () => {
    expect(sanitizeOptionalText(undefined)).toBeUndefined();
  });

  it('returns sanitized string for valid input', () => {
    expect(sanitizeOptionalText('hi <b>there</b>')).toBe('hi there');
  });

  it('returns undefined for empty input', () => {
    expect(sanitizeOptionalText('')).toBeUndefined();
    expect(sanitizeOptionalText('  ')).toBeUndefined();
  });
});
