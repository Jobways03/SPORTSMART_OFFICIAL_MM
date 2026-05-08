import { Injectable } from '@nestjs/common';

/**
 * Phase 8 (PR 8.4) — Lightweight in-process Prometheus metrics.
 *
 * Why not pull in `prom-client`:
 *   - We export a tiny set of counters / gauges / histograms today —
 *     nothing requiring the full library's quantile estimators or
 *     summary types.
 *   - The wire format (text exposition) is stable and well-documented;
 *     emitting it ourselves is ~80 lines of code with no new dep.
 *   - The public shape below mirrors prom-client's API
 *     (`registry.counter(name, labels?)`, `.inc()`, `.observe()`), so
 *     when we DO need histograms with proper buckets we can swap to
 *     prom-client without churning the call sites.
 *
 * Limits:
 *   - No native histogram percentiles. We bucket against fixed
 *     boundaries and let Prometheus do quantile aggregation across
 *     the time series (the standard pattern).
 *   - In-process state. A multi-pod deploy gets per-pod metrics that
 *     the Prometheus scraper aggregates. Acceptable for our scale.
 */

type Labels = Record<string, string>;

interface CounterEntry {
  type: 'counter';
  name: string;
  help: string;
  values: Map<string, number>;
}

interface GaugeEntry {
  type: 'gauge';
  name: string;
  help: string;
  values: Map<string, number>;
}

interface HistogramEntry {
  type: 'histogram';
  name: string;
  help: string;
  buckets: number[];
  /// per labelset: { sum, count, bucketCounts[] }
  values: Map<string, { sum: number; count: number; bucketCounts: number[] }>;
}

type Entry = CounterEntry | GaugeEntry | HistogramEntry;

const DEFAULT_BUCKETS_MS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000,
];

@Injectable()
export class MetricsRegistry {
  private readonly entries = new Map<string, Entry>();

  // ── Public API ────────────────────────────────────────────────

  counter(name: string, help: string): CounterHandle {
    const entry = this.ensure(name, help, 'counter') as CounterEntry;
    return new CounterHandle(entry);
  }

  gauge(name: string, help: string): GaugeHandle {
    const entry = this.ensure(name, help, 'gauge') as GaugeEntry;
    return new GaugeHandle(entry);
  }

  histogram(
    name: string,
    help: string,
    buckets: number[] = DEFAULT_BUCKETS_MS,
  ): HistogramHandle {
    let entry = this.entries.get(name) as HistogramEntry | undefined;
    if (!entry) {
      entry = {
        type: 'histogram',
        name,
        help,
        buckets: [...buckets].sort((a, b) => a - b),
        values: new Map(),
      };
      this.entries.set(name, entry);
    } else if (entry.type !== 'histogram') {
      throw new Error(
        `Metric ${name} already registered as ${entry.type}, cannot redeclare as histogram`,
      );
    }
    return new HistogramHandle(entry);
  }

  // ── Exposition ────────────────────────────────────────────────

  /**
   * Render the registry in Prometheus text exposition format.
   * Stable column order (HELP / TYPE / samples) so diffs in scrape
   * dumps are readable.
   */
  render(): string {
    const out: string[] = [];
    for (const entry of this.entries.values()) {
      out.push(`# HELP ${entry.name} ${entry.help}`);
      out.push(`# TYPE ${entry.name} ${entry.type}`);
      if (entry.type === 'counter' || entry.type === 'gauge') {
        for (const [labelKey, value] of entry.values) {
          out.push(`${entry.name}${labelKey} ${value}`);
        }
      } else {
        // Histogram: bucketCounts already stores cumulative counts per
        // boundary (every observation ≤ boundary[i] increments slot i
        // in observe()). Emit directly — Prometheus exposition expects
        // cumulative counts.
        for (const [labelKey, h] of entry.values) {
          for (let i = 0; i < entry.buckets.length; i++) {
            out.push(
              `${entry.name}_bucket${withLabel(labelKey, 'le', String(entry.buckets[i]))} ${h.bucketCounts[i]}`,
            );
          }
          out.push(
            `${entry.name}_bucket${withLabel(labelKey, 'le', '+Inf')} ${h.count}`,
          );
          out.push(`${entry.name}_sum${labelKey} ${h.sum}`);
          out.push(`${entry.name}_count${labelKey} ${h.count}`);
        }
      }
    }
    return out.join('\n') + '\n';
  }

  /** Reset all values. Test-only. */
  reset(): void {
    this.entries.clear();
  }

  // ── Internals ─────────────────────────────────────────────────

  private ensure(
    name: string,
    help: string,
    type: 'counter' | 'gauge',
  ): Entry {
    let entry = this.entries.get(name);
    if (!entry) {
      entry =
        type === 'counter'
          ? { type, name, help, values: new Map() }
          : { type, name, help, values: new Map() };
      this.entries.set(name, entry);
    } else if (entry.type !== type) {
      throw new Error(
        `Metric ${name} already registered as ${entry.type}, cannot redeclare as ${type}`,
      );
    }
    return entry;
  }
}

// ── Handles ─────────────────────────────────────────────────────

export class CounterHandle {
  constructor(private readonly entry: CounterEntry) {}
  inc(labels: Labels = {}, value = 1): void {
    const key = labelKey(labels);
    this.entry.values.set(key, (this.entry.values.get(key) ?? 0) + value);
  }
}

export class GaugeHandle {
  constructor(private readonly entry: GaugeEntry) {}
  set(value: number, labels: Labels = {}): void {
    this.entry.values.set(labelKey(labels), value);
  }
  inc(labels: Labels = {}, value = 1): void {
    const key = labelKey(labels);
    this.entry.values.set(key, (this.entry.values.get(key) ?? 0) + value);
  }
  dec(labels: Labels = {}, value = 1): void {
    this.inc(labels, -value);
  }
}

export class HistogramHandle {
  constructor(private readonly entry: HistogramEntry) {}
  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let h = this.entry.values.get(key);
    if (!h) {
      h = {
        sum: 0,
        count: 0,
        bucketCounts: new Array(this.entry.buckets.length).fill(0),
      };
      this.entry.values.set(key, h);
    }
    h.sum += value;
    h.count += 1;
    for (let i = 0; i < this.entry.buckets.length; i++) {
      if (value <= this.entry.buckets[i]) {
        h.bucketCounts[i] += 1;
      }
    }
  }
}

// ── Label helpers ───────────────────────────────────────────────

/**
 * Stable string representation of the labels map. Sorts keys so
 * `{a:'1', b:'2'}` and `{b:'2', a:'1'}` collapse to the same map key.
 */
function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${parts.join(',')}}`;
}

function withLabel(existingKey: string, name: string, value: string): string {
  // existingKey is either '' or '{...}'.
  const inner = `${name}="${escapeLabelValue(value)}"`;
  if (!existingKey) return `{${inner}}`;
  return existingKey.replace(/\}$/, `,${inner}}`);
}

function escapeLabelValue(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
