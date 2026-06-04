// Phase 93 (2026-05-23) — evidence URL allowlist coverage.
// Media now lives at the R2 public delivery base; the default trusted host
// is the dev-stub host (placehold.co) when R2 isn't configured, and callers
// supply the real R2 host via resolveTrustedMediaHosts() / allowedHosts.

import {
  isValidEvidenceUrl,
  validateEvidenceUrls,
} from './evidence-url-validator';

describe('isValidEvidenceUrl (Phase 93)', () => {
  it('accepts the default (dev-stub) media host', () => {
    const r = isValidEvidenceUrl('https://placehold.co/600x400/test.jpg');
    expect(r).toEqual({ valid: true });
  });

  it('accepts a subdomain of a configured allowed host', () => {
    const r = isValidEvidenceUrl('https://cdn.media.example.com/v1/x.jpg', {
      allowedHosts: ['media.example.com'],
    });
    expect(r).toEqual({ valid: true });
  });

  it('rejects http://', () => {
    const r = isValidEvidenceUrl('http://placehold.co/test.jpg');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/https/);
  });

  it('rejects javascript: URLs', () => {
    const r = isValidEvidenceUrl('javascript:alert(1)');
    expect(r.valid).toBe(false);
  });

  it('rejects data: URLs', () => {
    const r = isValidEvidenceUrl('data:image/png;base64,AAAA');
    expect(r.valid).toBe(false);
  });

  it('rejects file: URLs', () => {
    const r = isValidEvidenceUrl('file:///etc/passwd');
    expect(r.valid).toBe(false);
  });

  it('rejects localhost', () => {
    const r = isValidEvidenceUrl('https://localhost/evidence.jpg');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/Localhost/i);
  });

  it('rejects 127.0.0.1', () => {
    const r = isValidEvidenceUrl('https://127.0.0.1/evidence.jpg');
    expect(r.valid).toBe(false);
  });

  it('rejects cloud metadata endpoints', () => {
    const r = isValidEvidenceUrl('https://169.254.169.254/latest/meta-data/');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/metadata/i);
  });

  it('rejects non-allowlisted hosts', () => {
    const r = isValidEvidenceUrl('https://evil.example.com/photo.jpg');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toMatch(/allowlist/);
  });

  it('rejects URLs longer than max length', () => {
    const long = 'https://placehold.co/' + 'a'.repeat(3000);
    const r = isValidEvidenceUrl(long);
    expect(r.valid).toBe(false);
  });

  it('respects custom allowedHosts', () => {
    const r = isValidEvidenceUrl('https://cdn.example.com/photo.jpg', {
      allowedHosts: ['cdn.example.com'],
    });
    expect(r).toEqual({ valid: true });
  });

  it('validateEvidenceUrls returns first failing index', () => {
    const result = validateEvidenceUrls([
      'https://placehold.co/ok.jpg',
      'https://evil.example.com/bad.jpg',
      'https://placehold.co/also-ok.jpg',
    ]);
    expect(result?.index).toBe(1);
  });

  it('validateEvidenceUrls returns null when all valid', () => {
    const result = validateEvidenceUrls([
      'https://placehold.co/a.jpg',
      'https://placehold.co/b.jpg',
    ]);
    expect(result).toBeNull();
  });
});
