/**
 * Phase 49 (2026-05-21) — locks the CMS sanitizer contract. These
 * tests sit between the API DTO accept-everything pattern and the
 * storefront's `dangerouslySetInnerHTML` render — if the sanitizer
 * ever regresses, the storefront becomes an XSS surface.
 */

import { sanitizeCmsBody, stripHtmlToPlainText } from './rich-text-sanitizer';

describe('sanitizeCmsBody (Phase 49)', () => {
  it('strips <script> tags entirely', () => {
    const out = sanitizeCmsBody('<p>Hi</p><script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeCmsBody('<p onclick="alert(1)">Click</p>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('<p');
  });

  it('strips javascript: hrefs', () => {
    const out = sanitizeCmsBody('<a href="javascript:alert(1)">Click</a>');
    expect(out).not.toContain('javascript:');
  });

  it('strips data: hrefs', () => {
    const out = sanitizeCmsBody('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');
    expect(out).not.toContain('data:');
  });

  it('strips protocol-relative //evil.com hrefs', () => {
    const out = sanitizeCmsBody('<a href="//evil.com">x</a>');
    expect(out).not.toContain('evil.com');
  });

  it('keeps safe https hrefs', () => {
    const out = sanitizeCmsBody('<a href="https://example.com">link</a>');
    expect(out).toContain('https://example.com');
  });

  it('rewrites external links with rel=noopener + target=_blank', () => {
    const out = sanitizeCmsBody('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="nofollow noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it('preserves headings, lists, paragraphs, em/strong', () => {
    const html =
      '<h2>Section</h2><p>Hello <strong>bold</strong> <em>italic</em></p><ul><li>One</li></ul>';
    const out = sanitizeCmsBody(html);
    expect(out).toContain('<h2');
    expect(out).toContain('<p');
    expect(out).toContain('<strong');
    expect(out).toContain('<em');
    expect(out).toContain('<ul');
    expect(out).toContain('<li');
  });

  it('preserves tables (required for jurisdiction listings)', () => {
    const out = sanitizeCmsBody(
      '<table><thead><tr><th>State</th></tr></thead><tbody><tr><td>TN</td></tr></tbody></table>',
    );
    expect(out).toContain('<table');
    expect(out).toContain('<thead');
    expect(out).toContain('<td');
  });

  it('preserves img with safe src + alt', () => {
    const out = sanitizeCmsBody(
      '<img src="https://res.cloudinary.com/x/img.jpg" alt="hero">',
    );
    expect(out).toContain('<img');
    expect(out).toContain('src="https://res.cloudinary.com/x/img.jpg"');
  });

  it('strips <iframe>', () => {
    const out = sanitizeCmsBody('<iframe src="https://evil.com"></iframe>');
    expect(out).not.toContain('<iframe');
  });

  it('strips <style>', () => {
    const out = sanitizeCmsBody('<style>body{display:none}</style><p>Hi</p>');
    expect(out).not.toContain('<style');
  });
});

describe('stripHtmlToPlainText (Phase 49)', () => {
  it('removes all tags', () => {
    expect(stripHtmlToPlainText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('collapses whitespace', () => {
    expect(stripHtmlToPlainText('<p>  Hello   \n   world  </p>')).toBe('Hello world');
  });

  it('returns empty for HTML-only input', () => {
    expect(stripHtmlToPlainText('<script>alert(1)</script>')).toBe('');
  });
});
