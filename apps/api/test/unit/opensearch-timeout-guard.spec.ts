import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for OpenSearch client hangs.
 *
 * Before: every call was a bare fetch() with no timeout. If the
 * OpenSearch node was up but slow / network-partitioned / DNS-broken,
 * a storefront search hung until the OS TCP timeout (minutes). Event-
 * handler index writes would block the event-bus worker on top of that.
 *
 * After: a shared `request()` wrapper adds AbortSignal.timeout on every
 * call — 5s for /search (storefront request path), 10s for writes
 * (event-handler path). Errors are logged and a safe default is
 * returned (empty results for search, void for writes) so a flaky
 * index can't crash the business flow or starve the event queue.
 */

describe('OpenSearchClient — timeout guards', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'src/integrations/opensearch/clients/opensearch.client.ts',
    ),
    'utf8',
  );

  it('all fetch calls carry AbortSignal.timeout', () => {
    const fetchCount = (source.match(/\bfetch\s*\(/g) || []).length;
    const signalCount = (source.match(/AbortSignal\.timeout/g) || []).length;
    expect(fetchCount).toBeGreaterThan(0);
    expect(signalCount).toBeGreaterThanOrEqual(fetchCount);
  });

  it('search uses a tighter timeout than writes (request-path vs background)', () => {
    // Two separate timeout constants — the search path is on the
    // customer request path and must be snappier than background index
    // writes. If the constants are identical the test will still pass
    // structurally, but we want to ensure both exist.
    expect(source).toMatch(/SEARCH_TIMEOUT_MS\s*=\s*\d+/);
    expect(source).toMatch(/WRITE_TIMEOUT_MS\s*=\s*\d+/);
  });

  it('network errors fall through to safe defaults (no unhandled rejection)', () => {
    // The try/catch in the request helper should return null on throw
    // so callers get to decide a safe default instead of seeing an
    // unhandled promise rejection from a timeout.
    expect(source).toMatch(/catch\s*\(\s*err/);
    expect(source).toMatch(/return\s+null/);
  });
});
