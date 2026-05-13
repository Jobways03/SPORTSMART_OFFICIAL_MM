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
 * For each `@Post('<route>')` decorator we care about, walk up to 5
 * lines BEFORE and after to find an adjacent `@Throttle(...)`. That
 * decorator-stacking pattern is how NestJS chains decorators on the
 * same method.
 */
function hasAdjacentThrottle(source: string, postPattern: RegExp): boolean {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!postPattern.test(lines[i])) continue;
    // Look for @Throttle within ±5 lines (typical decorator stack)
    const start = Math.max(0, i - 5);
    const end = Math.min(lines.length - 1, i + 5);
    for (let j = start; j <= end; j++) {
      if (/@Throttle\s*\(/.test(lines[j])) return true;
    }
    return false;
  }
  // Pattern not found at all — surface as a test failure, but only on
  // the file-level "endpoint exists" assertion, not here.
  return false;
}

function routeExists(source: string, postPattern: RegExp): boolean {
  return source.split('\n').some((line) => postPattern.test(line));
}

describe('Auth endpoint throttle coverage (PR 3.4)', () => {
  describe.each(AUTH_CONTROLLERS)('$file', ({ file, routePatterns }) => {
    const source = read(file);

    it.each(routePatterns.map((p) => p.source))(
      'route %s exists in the controller (sanity check)',
      (patternSource) => {
        const pattern = new RegExp(patternSource);
        expect(routeExists(source, pattern)).toBe(true);
      },
    );

    it.each(routePatterns.map((p) => p.source))(
      'route %s has an adjacent @Throttle decorator',
      (patternSource) => {
        const pattern = new RegExp(patternSource);
        expect(hasAdjacentThrottle(source, pattern)).toBe(true);
      },
    );
  });

  it('the throttle limit is tight: every @Throttle on a login endpoint sets limit <= 10', () => {
    // Catches a future "loosen the limit to 100 because users
    // complained" commit. 10 attempts/minute/IP is more than enough
    // for a user who genuinely forgot their password; it's a tight
    // ceiling for a credential-spray attacker.
    const allFiles = AUTH_CONTROLLERS.map((c) => read(c.file));
    const allThrottleArgs = allFiles
      .flatMap((source) => [...source.matchAll(/@Throttle\s*\(\s*\{[^}]*limit\s*:\s*(\d+)/g)])
      .map((m) => parseInt(m[1], 10));
    expect(allThrottleArgs.length).toBeGreaterThan(0);
    for (const limit of allThrottleArgs) {
      expect(limit).toBeLessThanOrEqual(10);
    }
  });
});
