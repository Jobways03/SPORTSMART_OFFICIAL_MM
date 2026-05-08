import 'reflect-metadata';
import { MetricsRegistry } from '../../src/core/metrics/metrics.registry';

/**
 * Phase 8 (PR 8.4) — MetricsRegistry.
 *
 * The renderer is the trust boundary for Prometheus scraping — a bug
 * here means dashboards either lie or stop working entirely. Pin the
 * three metric types, the label-key normalisation, and the
 * exposition format quirks (`le="+Inf"`, cumulative buckets,
 * idempotent re-registration).
 */
describe('MetricsRegistry', () => {
  it('renders an empty registry as just a trailing newline', () => {
    const r = new MetricsRegistry();
    expect(r.render()).toBe('\n');
  });

  it('counters increment and render with labels', () => {
    const r = new MetricsRegistry();
    const c = r.counter('returns_created_total', 'Returns opened');
    c.inc({ initiator: 'CUSTOMER' });
    c.inc({ initiator: 'CUSTOMER' });
    c.inc({ initiator: 'ADMIN' });
    const out = r.render();
    expect(out).toContain('# HELP returns_created_total Returns opened');
    expect(out).toContain('# TYPE returns_created_total counter');
    expect(out).toContain('returns_created_total{initiator="CUSTOMER"} 2');
    expect(out).toContain('returns_created_total{initiator="ADMIN"} 1');
  });

  it('label key is order-independent', () => {
    const r = new MetricsRegistry();
    const c = r.counter('x', 'help');
    c.inc({ a: '1', b: '2' });
    c.inc({ b: '2', a: '1' });
    expect(r.render()).toContain('x{a="1",b="2"} 2');
  });

  it('gauges support set / inc / dec', () => {
    const r = new MetricsRegistry();
    const g = r.gauge('queue_depth', 'Queue depth');
    g.set(10, { queue: 'returns' });
    g.inc({ queue: 'returns' }, 5);
    g.dec({ queue: 'returns' }, 2);
    expect(r.render()).toContain('queue_depth{queue="returns"} 13');
  });

  it('histogram observe populates cumulative buckets + sum + count + +Inf', () => {
    const r = new MetricsRegistry();
    const h = r.histogram('refund_latency_ms', 'Refund latency', [50, 100, 500]);
    h.observe(40);
    h.observe(120);
    h.observe(600);
    const out = r.render();
    // Cumulative: le=50 → 1, le=100 → 1, le=500 → 2, le=+Inf → 3
    expect(out).toContain('refund_latency_ms_bucket{le="50"} 1');
    expect(out).toContain('refund_latency_ms_bucket{le="100"} 1');
    expect(out).toContain('refund_latency_ms_bucket{le="500"} 2');
    expect(out).toContain('refund_latency_ms_bucket{le="+Inf"} 3');
    expect(out).toContain('refund_latency_ms_sum 760');
    expect(out).toContain('refund_latency_ms_count 3');
  });

  it('histogram with labels renders one series per labelset', () => {
    const r = new MetricsRegistry();
    const h = r.histogram('lat_ms', 'lat', [10, 50, 100]);
    h.observe(40, { route: '/a' });
    h.observe(60, { route: '/a' });
    h.observe(5, { route: '/b' });
    const out = r.render();
    expect(out).toContain('lat_ms_bucket{route="/a",le="10"} 0');
    expect(out).toContain('lat_ms_bucket{route="/a",le="50"} 1');
    expect(out).toContain('lat_ms_bucket{route="/a",le="100"} 2');
    expect(out).toContain('lat_ms_bucket{route="/a",le="+Inf"} 2');
    expect(out).toContain('lat_ms_bucket{route="/b",le="10"} 1');
  });

  it('escapes label values (quote, backslash, newline)', () => {
    const r = new MetricsRegistry();
    const c = r.counter('x', 'help');
    c.inc({ msg: 'a"b\\c\nd' });
    expect(r.render()).toContain('x{msg="a\\"b\\\\c\\nd"} 1');
  });

  it('rejects re-registering the same name with a different type', () => {
    const r = new MetricsRegistry();
    r.counter('x', 'help');
    expect(() => r.gauge('x', 'help2')).toThrow(/already registered/);
  });

  it('repeated registration of the same type returns the same handle (idempotent)', () => {
    const r = new MetricsRegistry();
    const a = r.counter('x', 'help');
    const b = r.counter('x', 'help');
    a.inc();
    b.inc();
    expect(r.render()).toContain('x 2');
  });
});
