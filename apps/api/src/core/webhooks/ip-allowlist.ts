// Phase 86 (2026-05-23) — Gap #15 closure.
//
// IPv4/IPv6 allowlist matcher for inbound webhooks. Accepts a
// comma-separated list of bare IPs (`52.66.10.5`) and CIDR ranges
// (`52.66.0.0/16`, `2001:db8::/32`). Empty / unset allowlist =
// pass-through (callers decide whether to fail-closed when empty).
//
// Why this lives outside the controller: the same primitive is
// reused by both Shiprocket and iThink webhook paths, and will be
// used by the Razorpay path in a follow-up. Putting it in
// `core/webhooks/` keeps the policy single-sourced.

import { isIP, isIPv4, isIPv6 } from 'net';

export type IpAllowlistEntry =
  | { type: 'exact'; address: string }
  | { type: 'cidr-v4'; baseInt: number; prefix: number }
  | { type: 'cidr-v6'; baseBytes: bigint; prefix: number };

/**
 * Parse a comma-separated allowlist string into structured entries.
 * Whitespace + empty tokens are stripped. Invalid entries throw at
 * parse time — caller decides whether to surface as configuration
 * error or fail-closed silently.
 */
export function parseAllowlist(raw: string | undefined): IpAllowlistEntry[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((token) => {
      if (token.includes('/')) {
        const parts = token.split('/');
        const base = parts[0] ?? '';
        const prefixStr = parts[1] ?? '';
        const prefix = Number(prefixStr);
        if (!Number.isInteger(prefix) || prefix < 0) {
          throw new Error(`Invalid CIDR prefix: ${token}`);
        }
        if (isIPv4(base)) {
          if (prefix > 32) throw new Error(`Invalid IPv4 prefix: ${token}`);
          return {
            type: 'cidr-v4' as const,
            baseInt: ipv4ToInt(base),
            prefix,
          };
        }
        if (isIPv6(base)) {
          if (prefix > 128) throw new Error(`Invalid IPv6 prefix: ${token}`);
          return {
            type: 'cidr-v6' as const,
            baseBytes: ipv6ToBigInt(base),
            prefix,
          };
        }
        throw new Error(`Invalid CIDR base address: ${token}`);
      }
      if (!isIP(token)) {
        throw new Error(`Invalid IP literal: ${token}`);
      }
      return { type: 'exact' as const, address: normaliseIp(token) };
    });
}

/**
 * Test a candidate IP against a parsed allowlist. Returns `true`
 * when the allowlist is empty (pass-through — caller decides policy)
 * OR when the IP matches any entry.
 */
export function ipMatchesAllowlist(
  candidate: string,
  allowlist: IpAllowlistEntry[],
): boolean {
  if (allowlist.length === 0) return true;
  if (!isIP(candidate)) return false;

  const norm = normaliseIp(candidate);
  for (const entry of allowlist) {
    if (entry.type === 'exact') {
      if (entry.address === norm) return true;
      continue;
    }
    if (entry.type === 'cidr-v4' && isIPv4(candidate)) {
      const candInt = ipv4ToInt(candidate);
      const mask = entry.prefix === 0 ? 0 : (~0 << (32 - entry.prefix)) >>> 0;
      if ((candInt & mask) === (entry.baseInt & mask)) return true;
      continue;
    }
    if (entry.type === 'cidr-v6' && isIPv6(candidate)) {
      const candBytes = ipv6ToBigInt(candidate);
      const totalBits = 128;
      const shift = BigInt(totalBits - entry.prefix);
      const mask =
        entry.prefix === 0
          ? 0n
          : ((1n << BigInt(entry.prefix)) - 1n) << shift;
      if ((candBytes & mask) === (entry.baseBytes & mask)) return true;
      continue;
    }
  }
  return false;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  const d = parts[3] ?? 0;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipv6ToBigInt(ip: string): bigint {
  // Expand the address to 8 hextets (handling `::`) then parse.
  const expanded = expandIPv6(ip);
  const parts = expanded.split(':');
  let result = 0n;
  for (const part of parts) {
    result = (result << 16n) | BigInt(parseInt(part, 16));
  }
  return result;
}

function expandIPv6(ip: string): string {
  if (!ip.includes('::')) {
    // Already full form; pad each hextet to 4 chars for consistency.
    return ip
      .split(':')
      .map((h) => h.padStart(4, '0'))
      .join(':');
  }
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const middle = Array(missing).fill('0');
  return [...headParts, ...middle, ...tailParts]
    .map((h) => h.padStart(4, '0'))
    .join(':');
}

/**
 * Normalise representations: strip IPv6 zone suffix, lowercase
 * hextets, collapse leading zeros. Used so exact-match comparisons
 * don't fail on cosmetic differences.
 */
function normaliseIp(ip: string): string {
  if (isIPv4(ip)) return ip;
  if (isIPv6(ip)) {
    const noZone = ip.split('%')[0] ?? ip;
    return expandIPv6(noZone).toLowerCase();
  }
  return ip;
}
