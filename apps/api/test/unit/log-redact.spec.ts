import 'reflect-metadata';
import {
  redactEmail,
  redactPhone,
} from '../../src/bootstrap/logging/log-redact';

/**
 * Regression test for the logging redaction helpers.
 *
 * Before: notification + WhatsApp code paths logged full email
 * addresses and phone numbers ("Email notification sent to
 * alice@acme.com" / "OTP sent to +919876543210"). Anyone with log
 * access could reconstruct the user directory.
 *
 * After: shared helpers keep enough signal for an operator to search
 * ("***3210", "a***@acme.com") but no longer leak the full value.
 */

describe('log-redact — redactEmail', () => {
  it('masks the local part and keeps the domain for searchability', () => {
    expect(redactEmail('alice@acme.com')).toBe('a***@acme.com');
  });

  it('still returns a stable form for very short local parts', () => {
    expect(redactEmail('a@acme.com')).toBe('a***@acme.com');
  });

  it('returns [redacted] for nullish / malformed input', () => {
    expect(redactEmail(null)).toBe('[redacted]');
    expect(redactEmail(undefined)).toBe('[redacted]');
    expect(redactEmail('')).toBe('[redacted]');
    expect(redactEmail('no-at-sign')).toBe('[redacted]');
    expect(redactEmail('@no-local.com')).toBe('[redacted]');
    expect(redactEmail('no-domain@')).toBe('[redacted]');
  });

  it('does not include any character of the local part beyond the first', () => {
    const redacted = redactEmail('someverylonglocalpart@acme.com');
    expect(redacted).toBe('s***@acme.com');
    expect(redacted).not.toMatch(/omeverylonglocalpart/);
  });
});

describe('log-redact — redactPhone', () => {
  it('keeps the last four digits and masks the rest', () => {
    expect(redactPhone('9876543210')).toBe('***3210');
  });

  it('handles phone numbers with country codes and punctuation', () => {
    expect(redactPhone('+91 98765-43210')).toBe('***3210');
    expect(redactPhone('(917) 555-0123')).toBe('***0123');
  });

  it('returns [redacted] for nullish / unusable input', () => {
    expect(redactPhone(null)).toBe('[redacted]');
    expect(redactPhone(undefined)).toBe('[redacted]');
    expect(redactPhone('')).toBe('[redacted]');
    expect(redactPhone('abc')).toBe('[redacted]');
    expect(redactPhone('123')).toBe('[redacted]');
  });

  it('never returns anything containing the leading digits of the input', () => {
    const input = '9876543210';
    const redacted = redactPhone(input);
    expect(redacted).not.toContain('9876');
    expect(redacted).not.toContain('98765');
  });
});
