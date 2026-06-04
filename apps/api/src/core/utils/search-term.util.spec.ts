/**
 * Phase 195 (#7/#9) — search-input hardening util.
 */
import {
  escapeLikePattern,
  sanitizeSearchTerm,
  prepareSearchToken,
  MAX_SEARCH_TERM_LENGTH,
} from './search-term.util';

describe('escapeLikePattern (#9)', () => {
  it('escapes % so a bare wildcard cannot match the whole catalog', () => {
    expect(escapeLikePattern('%')).toBe('\\%');
    expect(escapeLikePattern('100% cotton')).toBe('100\\% cotton');
  });
  it('escapes _ (single-char wildcard)', () => {
    expect(escapeLikePattern('ab_cd')).toBe('ab\\_cd');
  });
  it('escapes the backslash escape char itself, first', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    // combined: backslash then percent
    expect(escapeLikePattern('\\%')).toBe('\\\\\\%');
  });
  it('leaves ordinary text untouched', () => {
    expect(escapeLikePattern('running shoes')).toBe('running shoes');
  });
});

describe('sanitizeSearchTerm (#7)', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeSearchTerm('  nike   air  ')).toBe('nike air');
  });
  it('strips ASCII control characters', () => {
    // bell (0x07) + NUL (0x00) between tokens -> replaced with space, collapsed
    const input = 'ni' + String.fromCharCode(7) + String.fromCharCode(0) + 'ke';
    expect(sanitizeSearchTerm(input)).toBe('ni ke');
  });
  it('caps length at the max', () => {
    const long = 'a'.repeat(500);
    expect(sanitizeSearchTerm(long).length).toBe(MAX_SEARCH_TERM_LENGTH);
  });
  it('returns empty string for null/undefined/empty', () => {
    expect(sanitizeSearchTerm(undefined)).toBe('');
    expect(sanitizeSearchTerm(null)).toBe('');
    expect(sanitizeSearchTerm('   ')).toBe('');
  });
});

describe('prepareSearchToken', () => {
  it('returns empty for sub-2-char input', () => {
    expect(prepareSearchToken('a')).toBe('');
    expect(prepareSearchToken(' x ')).toBe('');
  });
  it('sanitizes then escapes', () => {
    expect(prepareSearchToken('  100%  ')).toBe('100\\%');
  });
});
