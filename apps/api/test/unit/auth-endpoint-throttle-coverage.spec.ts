import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phase 3 (PR 3.4) — auth endpoint throttle coverage.
 *
 * The per-account `failedLoginAttempts` + `lockUntil` mechanism only
 * defends against brute-forcing a single account. It does NOT defend
 * against credential spray: an attacker rotating through many emails
 * from one IP exhausts a few attempts on each account, never tripping
 * the per-account lock. The defence at the right layer is per-IP rate
 * limiting on the login endpoint itself.
 *
 * Four of the five persona login controllers already carry
 * `@Throttle({ default: { limit: 5, ttl: 60_000 } })`. The affiliate
 * controller did not — PR 3.4 closes that gap. Same fix shape
 * applies to the OTP-style endpoints (forgot-password,
 * verify-reset-otp, reset-password) where an unthrottled endpoint
 * lets an attacker burn through OTP email volume or guess OTP codes.
 *
 * This source-scan pins the contract so a future controller
 * accidentally added without a throttle decorator fails CI.
 */

interface LoginControllerCheck {
  file: string;
  /** Every method handler whose route ends in /login or matches
   *  one of the OTP-style auth endpoints. */
  routePatterns: RegExp[];
}

const AUTH_CONTROLLERS: LoginControllerCheck[] = [
  {
    file: 'src/modules/identity/presentation/controllers/login.controller.ts',
    routePatterns: [/@Post\(\s*['"]login['"]\s*\)/],
  },
  {
    file: 'src/modules/admin/presentation/controllers/admin-auth.controller.ts',
    routePatterns: [
      /@Post\(\s*['"]login['"]\s*\)/,
      /@Post\(\s*['"]forgot-password['"]\s*\)/,
      /@Post\(\s*['"]verify-reset-otp['"]\s*\)/,
      /@Post\(\s*['"]reset-password['"]\s*\)/,
    ],
  },
  {
    file: 'src/modules/seller/presentation/controllers/seller-login.controller.ts',
    routePatterns: [/@Post\(\s*['"]login['"]\s*\)/],
  },
  {
    file: 'src/modules/franchise/presentation/controllers/franchise-auth.controller.ts',
    routePatterns: [
      /@Post\(\s*['"]login['"]\s*\)/,
      /@Post\(\s*['"]forgot-password['"]\s*\)/,
      /@Post\(\s*['"]verify-reset-otp['"]\s*\)/,
      /@Post\(\s*['"]reset-password['"]\s*\)/,
    ],
  },
  {
    file: 'src/modules/affiliate/presentation/controllers/affiliate-auth.controller.ts',
    routePatterns: [
      /@Post\(\s*['"]login['"]\s*\)/,
      /@Post\(\s*['"]forgot-password['"]\s*\)/,
      /@Post\(\s*['"]verify-reset-otp['"]\s*\)/,
      /@Post\(\s*['"]reset-password['"]\s*\)/,
    ],
  },
];

function read(rel: string): string {
  return readFileSync(join(__dirname, '..', '..', rel), 'utf8');
}

/**
 * Locate the decorator block of the method whose `@Post` matches
 * `postPattern`, and report whether it carries an `@Throttle` plus that
 * throttle's `limit`. The block is bounded by the surrounding route
 * decorators — we expand from the `@Post` line but never cross another
 * `@Post(` (a route boundary) or the opening of the handler body, so we
 * only ever see THIS route's decorators. This avoids two brittleness
 * traps the old ±5-line window had: (1) a `@Throttle` stacked >5 lines
 * from `@Post` (other decorators in between) was missed; (2) the
 * separate `refresh` route's deliberately-higher cap leaked into the
 * limit scan.
 */
function routeThrottle(
  source: string,
  postPattern: RegExp,
): { exists: boolean; throttled: boolean; limit: number | null } {
  const lines = source.split('\n');
  const idx = lines.findIndex((l) => postPattern.test(l));
  if (idx === -1) return { exists: false, throttled: false, limit: null };
  // Expand up over a contiguous decorator stack above @Post.
  let up = idx;
  while (up > 0 && /^\s*[@)]/.test(lines[up - 1]) && !/@Post\(/.test(lines[up - 1])) {
    up--;
  }
  // Expand down through the rest of the stack + handler signature,
  // stopping at the next route or the opening of the method body.
  let down = idx;
  while (down < lines.length - 1) {
    if (/@Post\(/.test(lines[down + 1])) break; // next route boundary
    down++;
    if (/\)\s*[:{].*$/.test(lines[down]) || /\{\s*$/.test(lines[down])) break; // body opened
    if (down - idx > 16) break; // safety bound
  }
  const block = lines.slice(up, down + 1).join('\n');
  const throttled = /@Throttle\s*\(/.test(block);
  const m = block.match(/@Throttle\s*\(\s*\{[^}]*limit\s*:\s*(\d+)/);
  return { exists: true, throttled, limit: m ? parseInt(m[1], 10) : null };
}

describe('Auth endpoint throttle coverage (PR 3.4)', () => {
  describe.each(AUTH_CONTROLLERS)('$file', ({ file, routePatterns }) => {
    const source = read(file);

    it.each(routePatterns.map((p) => p.source))(
      'route %s exists in the controller (sanity check)',
      (patternSource) => {
        const pattern = new RegExp(patternSource);
        expect(routeThrottle(source, pattern).exists).toBe(true);
      },
    );

    it.each(routePatterns.map((p) => p.source))(
      'route %s has a @Throttle decorator in its stack',
      (patternSource) => {
        const pattern = new RegExp(patternSource);
        expect(routeThrottle(source, pattern).throttled).toBe(true);
      },
    );
  });

  it('the throttle limit is tight on every login / OTP route: limit <= 10', () => {
    // Catches a future "loosen the limit to 100 because users complained"
    // commit. 10 attempts/minute/IP is plenty for a genuine forgotten
    // password; a tight ceiling for a credential-spray attacker. Scoped to
    // the login/OTP routes this spec tracks — NOT every @Throttle in the
    // file (the `refresh` route deliberately runs a higher cap because it
    // requires a valid refresh token and is not a credential-spray surface).
    const limits: number[] = [];
    for (const { file, routePatterns } of AUTH_CONTROLLERS) {
      const source = read(file);
      for (const p of routePatterns) {
        const { limit } = routeThrottle(source, p);
        if (limit !== null) limits.push(limit);
      }
    }
    expect(limits.length).toBeGreaterThan(0);
    for (const limit of limits) {
      expect(limit).toBeLessThanOrEqual(10);
    }
  });
});
