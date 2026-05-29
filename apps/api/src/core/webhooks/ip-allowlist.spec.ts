// Phase 86 (2026-05-23) — Gap #15. IP allowlist primitive coverage.

import { ipMatchesAllowlist, parseAllowlist } from './ip-allowlist';

describe('ip-allowlist', () => {
  describe('parseAllowlist', () => {
    it('returns empty array for undefined / empty', () => {
      expect(parseAllowlist(undefined)).toEqual([]);
      expect(parseAllowlist('')).toEqual([]);
      expect(parseAllowlist('  ')).toEqual([]);
    });

    it('parses bare IPv4', () => {
      const out = parseAllowlist('1.2.3.4');
      expect(out).toEqual([{ type: 'exact', address: '1.2.3.4' }]);
    });

    it('parses IPv4 CIDR', () => {
      const out = parseAllowlist('10.0.0.0/8');
      expect(out[0]?.type).toBe('cidr-v4');
    });

    it('parses IPv6 + CIDR', () => {
      const out = parseAllowlist('::1, 2001:db8::/32');
      expect(out).toHaveLength(2);
      expect(out[0]?.type).toBe('exact');
      expect(out[1]?.type).toBe('cidr-v6');
    });

    it('strips whitespace + ignores empty tokens', () => {
      const out = parseAllowlist(' 1.1.1.1 ,, 2.2.2.2 , ');
      expect(out).toHaveLength(2);
    });

    it('throws on garbage', () => {
      expect(() => parseAllowlist('not-an-ip')).toThrow(/Invalid IP literal/);
    });

    it('throws on bad prefix', () => {
      expect(() => parseAllowlist('1.2.3.4/40')).toThrow(/Invalid IPv4 prefix/);
    });
  });

  describe('ipMatchesAllowlist', () => {
    it('empty allowlist passes through (true)', () => {
      expect(ipMatchesAllowlist('1.2.3.4', [])).toBe(true);
    });

    it('exact IPv4 match', () => {
      const list = parseAllowlist('52.66.10.5');
      expect(ipMatchesAllowlist('52.66.10.5', list)).toBe(true);
      expect(ipMatchesAllowlist('52.66.10.6', list)).toBe(false);
    });

    it('IPv4 CIDR /24 match', () => {
      const list = parseAllowlist('52.66.10.0/24');
      expect(ipMatchesAllowlist('52.66.10.1', list)).toBe(true);
      expect(ipMatchesAllowlist('52.66.10.255', list)).toBe(true);
      expect(ipMatchesAllowlist('52.66.11.1', list)).toBe(false);
    });

    it('IPv4 CIDR /16 match', () => {
      const list = parseAllowlist('52.66.0.0/16');
      expect(ipMatchesAllowlist('52.66.10.1', list)).toBe(true);
      expect(ipMatchesAllowlist('52.66.255.255', list)).toBe(true);
      expect(ipMatchesAllowlist('52.67.0.1', list)).toBe(false);
    });

    it('IPv4 /0 matches everything', () => {
      const list = parseAllowlist('0.0.0.0/0');
      expect(ipMatchesAllowlist('1.2.3.4', list)).toBe(true);
    });

    it('IPv6 exact match', () => {
      const list = parseAllowlist('2001:db8::1');
      expect(ipMatchesAllowlist('2001:db8::1', list)).toBe(true);
      expect(ipMatchesAllowlist('2001:db8::2', list)).toBe(false);
    });

    it('IPv6 CIDR /64 match', () => {
      const list = parseAllowlist('2001:db8::/64');
      expect(ipMatchesAllowlist('2001:db8::1', list)).toBe(true);
      expect(ipMatchesAllowlist('2001:db8::ffff:ffff:ffff:ffff', list)).toBe(true);
      expect(ipMatchesAllowlist('2001:db9::1', list)).toBe(false);
    });

    it('does not cross IPv4/IPv6 boundaries', () => {
      const v4List = parseAllowlist('52.66.0.0/16');
      expect(ipMatchesAllowlist('2001:db8::1', v4List)).toBe(false);
      const v6List = parseAllowlist('2001:db8::/32');
      expect(ipMatchesAllowlist('52.66.10.1', v6List)).toBe(false);
    });

    it('mixed allowlist matches whichever family', () => {
      const list = parseAllowlist('52.66.0.0/16, 2001:db8::/32');
      expect(ipMatchesAllowlist('52.66.10.1', list)).toBe(true);
      expect(ipMatchesAllowlist('2001:db8::1', list)).toBe(true);
      expect(ipMatchesAllowlist('1.2.3.4', list)).toBe(false);
    });

    it('rejects malformed candidate IP', () => {
      const list = parseAllowlist('1.2.3.4');
      expect(ipMatchesAllowlist('not-an-ip', list)).toBe(false);
    });
  });
});
