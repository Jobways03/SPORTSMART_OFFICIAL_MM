import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the Shiprocket client — 401-retry and timeout
 * guards.
 *
 * Before: every operation called a bare `fetch()` with no timeout and
 * no 401 handling. If Shiprocket revoked our token (admin rotates the
 * Shiprocket password, or their auth service invalidates early) every
 * subsequent API call would 401 and throw, and the cached token stayed
 * valid in memory for up to 9 days — meaning every single shipping
 * request failed until a process restart. And with no timeouts, a hung
 * Shiprocket connection could pin customer-facing dispatch requests
 * indefinitely.
 *
 * After: a shared `request()` helper adds `AbortSignal.timeout(30s)` on
 * every call and retries once on 401 after forcing a token refresh.
 * Source-scan test — structural guard that survives refactors.
 */

describe('ShiprocketClient — 401-retry + timeout', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'src/integrations/shiprocket/clients/shiprocket.client.ts',
    ),
    'utf8',
  );

  it('all fetch calls go through AbortSignal.timeout (no bare fetch)', () => {
    // The shared helper uses signal: AbortSignal.timeout. Bare call-site
    // fetches (not through the helper) would be missed and we'd see
    // multiple fetch occurrences without signal.
    const fetchCount = (source.match(/\bfetch\s*\(/g) || []).length;
    const signalTimeoutCount = (source.match(/AbortSignal\.timeout/g) || [])
      .length;
    // Each fetch must be accompanied by signal: AbortSignal.timeout —
    // the helper wraps one, auth has its own. Both must be present.
    expect(fetchCount).toBeGreaterThan(0);
    expect(signalTimeoutCount).toBeGreaterThanOrEqual(fetchCount);
  });

  it('401 response triggers a forced re-auth + single retry', () => {
    // Look for the narrow pattern: a 401 branch that clears the token
    // and calls authenticate(true) (forceRefresh).
    expect(source).toMatch(/res\.status\s*===\s*401/);
    expect(source).toMatch(/authenticate\s*\(\s*true\s*\)/);
    expect(source).toMatch(/this\.token\s*=\s*null/);
  });

  it('authenticate accepts forceRefresh to bypass the 9-day cache', () => {
    expect(source).toMatch(/authenticate\s*\(\s*forceRefresh/);
  });
});
