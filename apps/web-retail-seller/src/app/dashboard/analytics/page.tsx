'use client';

// Phase 38+ (2026-06-08) — seller Analytics page.
//
// There is no dedicated seller-analytics backend endpoint yet, so this page
// composes a performance overview from the seller's existing data endpoints:
//   • /seller/earnings/summary  → all-time earned + pending settlement
//   • /seller/orders            → sub-orders (status mix + weekly trend) + total
//   • /seller/products          → catalogue size (pagination.total)
//   • /seller/returns           → returns count (→ return rate)
// KPI totals are all-time (pagination.total / the summary); the fulfillment
// mix, payment split and weekly trend are computed over the most recent batch
// of orders (RECENT_LIMIT). A server-aggregated version (true time-series over
// the full history) is the natural follow-up.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

const RECENT_LIMIT = 200;

interface SubOrderRow {
  id?: string;
  fulfillmentStatus?: string;
  paymentStatus?: string;
  createdAt?: string;
  masterOrder?: { createdAt?: string };
}

const FULFILL = [
  { key: 'DELIVERED', label: 'Delivered', color: '#7c3aed' },
  { key: 'FULFILLED', label: 'Fulfilled', color: '#16a34a' },
  { key: 'SHIPPED', label: 'Shipped', color: '#2563eb' },
  { key: 'PACKED', label: 'Packed', color: '#d97706' },
  { key: 'UNFULFILLED', label: 'Unfulfilled', color: '#94a3b8' },
  { key: 'CANCELLED', label: 'Cancelled', color: '#dc2626' },
];

const fmtInr = (v: number | null | undefined) =>
  v == null ? '₹—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtCount = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('en-IN');
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [earnings, setEarnings] = useState<{ totalEarned?: number; pendingSettlement?: number } | null>(null);
  const [ordersTotal, setOrdersTotal] = useState<number | null>(null);
  const [productsTotal, setProductsTotal] = useState<number | null>(null);
  const [returnsTotal, setReturnsTotal] = useState<number | null>(null);
  const [recent, setRecent] = useState<SubOrderRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [earnRes, ordersRes, prodRes, retRes] = await Promise.all([
          apiClient<any>('/seller/earnings/summary').catch(() => null),
          apiClient<any>(`/seller/orders?limit=${RECENT_LIMIT}`).catch(() => null),
          apiClient<any>('/seller/products?limit=1').catch(() => null),
          apiClient<any>('/seller/returns?limit=1').catch(() => null),
        ]);
        if (cancelled) return;
        setEarnings(earnRes?.data ?? null);
        const od = ordersRes?.data ?? {};
        setOrdersTotal(od?.pagination?.total ?? null);
        const list = od?.subOrders ?? od?.orders ?? od?.items ?? od?.data ?? [];
        setRecent(Array.isArray(list) ? list : []);
        setProductsTotal(prodRes?.data?.pagination?.total ?? null);
        setReturnsTotal(retRes?.data?.pagination?.total ?? null);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const recentN = recent.length;

  const fulfillCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const so of recent) {
      const k = (so.fulfillmentStatus || 'UNFULFILLED').toUpperCase();
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [recent]);

  const paid = useMemo(
    () => recent.filter((so) => (so.paymentStatus || '').toUpperCase() === 'PAID').length,
    [recent],
  );

  const weekly = useMemo(() => {
    const WEEKS = 8;
    const now = new Date();
    const buckets = Array.from({ length: WEEKS }, (_, idx) => {
      const i = WEEKS - 1 - idx;
      const end = new Date(now);
      end.setDate(now.getDate() - i * 7);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return {
        label: `${start.getDate()}/${start.getMonth() + 1}`,
        start: start.getTime(),
        end: end.getTime(),
        count: 0,
      };
    });
    for (const so of recent) {
      const ds = so.masterOrder?.createdAt || so.createdAt;
      if (!ds) continue;
      const t = new Date(ds).getTime();
      const b = buckets.find((bk) => t >= bk.start && t <= bk.end);
      if (b) b.count++;
    }
    return buckets;
  }, [recent]);

  const maxWeek = Math.max(1, ...weekly.map((w) => w.count));

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div>
          <h1 style={s.h1}>Store analytics</h1>
          <p style={s.sub}>Your store's performance at a glance.</p>
        </div>
        <Link href="/dashboard/accounts" style={s.linkBtn}>
          View finances →
        </Link>
      </header>

      {loading && <p style={s.muted}>Loading analytics…</p>}
      {err && <div style={s.errBox}>{err}</div>}

      {/* ── KPI row ── */}
      <div style={s.kpiRow}>
        <Kpi label="Total earned" value={fmtInr(earnings?.totalEarned)} hint="Settled to your bank" accent="#16a34a" />
        <Kpi label="Pending settlement" value={fmtInr(earnings?.pendingSettlement)} hint="Awaiting payout" accent="#d97706" />
        <Kpi label="Total orders" value={fmtCount(ordersTotal)} hint="All-time" accent="#2563eb" />
        <Kpi label="Products listed" value={fmtCount(productsTotal)} hint="In your catalogue" accent="#0f1115" />
        <Kpi
          label="Return rate"
          value={ordersTotal && returnsTotal != null ? `${pct(returnsTotal, ordersTotal)}%` : '—'}
          hint={returnsTotal != null ? `${fmtCount(returnsTotal)} returns` : ''}
          accent="#7c3aed"
        />
      </div>

      {/* ── Fulfillment + Payment ── */}
      <div style={s.twoCol}>
        <section style={s.card}>
          <h2 style={s.cardTitle}>Order fulfillment</h2>
          <p style={s.cardSub}>Across your {fmtCount(recentN)} most recent orders</p>
          <div style={s.segBar}>
            {recentN === 0 ? (
              <div style={{ width: '100%', background: '#f3f4f6' }} />
            ) : (
              FULFILL.map((f) => {
                const c = fulfillCounts[f.key] || 0;
                const w = (c / recentN) * 100;
                return w > 0 ? (
                  <div key={f.key} style={{ width: `${w}%`, background: f.color }} title={`${f.label}: ${c}`} />
                ) : null;
              })
            )}
          </div>
          <div style={s.legend}>
            {recentN === 0 ? (
              <span style={s.muted}>No recent orders yet.</span>
            ) : (
              FULFILL.map((f) => {
                const c = fulfillCounts[f.key] || 0;
                if (c === 0) return null;
                return (
                  <div key={f.key} style={s.legendItem}>
                    <span style={{ ...s.dot, background: f.color }} />
                    <span style={s.legendLabel}>{f.label}</span>
                    <span style={s.legendVal}>
                      {c} · {pct(c, recentN)}%
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section style={s.card}>
          <h2 style={s.cardTitle}>Payment status</h2>
          <p style={s.cardSub}>Across your {fmtCount(recentN)} most recent orders</p>
          <div style={s.statRow}>
            <Stat value={fmtCount(paid)} label="Paid" color="#16a34a" />
            <Stat value={fmtCount(recentN - paid)} label="Pending / other" color="#d97706" />
            <Stat value={recentN ? `${pct(paid, recentN)}%` : '—'} label="Paid share" color="#2563eb" />
          </div>
        </section>
      </div>

      {/* ── Weekly trend ── */}
      <section style={s.card}>
        <h2 style={s.cardTitle}>Orders over the last 8 weeks</h2>
        <p style={s.cardSub}>Based on your {fmtCount(recentN)} most recent orders</p>
        <div style={s.chart}>
          {weekly.map((w, i) => (
            <div key={i} style={s.barCol}>
              <span style={s.barCount}>{w.count || ''}</span>
              <div
                style={{
                  ...s.bar,
                  height: `${Math.max(2, (w.count / maxWeek) * 100)}%`,
                  background: w.count ? '#2563eb' : '#e5e7eb',
                }}
              />
              <span style={s.barLabel}>{w.label}</span>
            </div>
          ))}
        </div>
      </section>

      <p style={s.footnote}>
        Totals (earned, orders, products, returns) are all-time. Fulfillment, payment split and the
        weekly trend are computed from your {RECENT_LIMIT} most recent orders.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent: string }) {
  return (
    <div style={s.kpi}>
      <div style={{ ...s.kpiAccent, background: accent }} />
      <div style={s.kpiBody}>
        <span style={s.kpiLabel}>{label}</span>
        <span style={s.kpiValue}>{value}</span>
        {hint ? <span style={s.kpiHint}>{hint}</span> : null}
      </div>
    </div>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={s.stat}>
      <span style={{ ...s.statValue, color }}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: '8px 0 40px', maxWidth: 1100 },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 },
  h1: { fontSize: 24, fontWeight: 700, margin: 0, color: '#0f1115' },
  sub: { fontSize: 14, color: '#525A65', margin: '4px 0 0' },
  linkBtn: { fontSize: 13, fontWeight: 600, color: '#2563eb', textDecoration: 'none' },
  muted: { fontSize: 13, color: '#6b7280' },
  errBox: {
    padding: '10px 14px', borderRadius: 10, marginBottom: 16,
    background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: 13,
  },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 },
  kpi: { display: 'flex', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  kpiAccent: { width: 4, flexShrink: 0 },
  kpiBody: { display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 16px' },
  kpiLabel: { fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' },
  kpiValue: { fontSize: 22, fontWeight: 700, color: '#0f1115', fontVariantNumeric: 'tabular-nums' },
  kpiHint: { fontSize: 12, color: '#94a3b8' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 16 },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 },
  cardTitle: { fontSize: 15, fontWeight: 700, margin: 0, color: '#0f1115' },
  cardSub: { fontSize: 12, color: '#6b7280', margin: '4px 0 14px' },
  segBar: { display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: '#f3f4f6' },
  legend: { display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginTop: 14 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 },
  dot: { width: 9, height: 9, borderRadius: 999, flexShrink: 0 },
  legendLabel: { color: '#374151' },
  legendVal: { color: '#94a3b8', fontVariantNumeric: 'tabular-nums' },
  statRow: { display: 'flex', gap: 24, marginTop: 8 },
  stat: { display: 'flex', flexDirection: 'column', gap: 2 },
  statValue: { fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  statLabel: { fontSize: 12, color: '#6b7280' },
  chart: { display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, paddingTop: 8 },
  barCol: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 6 },
  barCount: { fontSize: 12, fontWeight: 600, color: '#374151', height: 16, fontVariantNumeric: 'tabular-nums' },
  bar: { width: '100%', maxWidth: 44, borderRadius: '4px 4px 0 0', transition: 'height 0.2s' },
  barLabel: { fontSize: 11, color: '#94a3b8' },
  footnote: { fontSize: 12, color: '#94a3b8', marginTop: 18, lineHeight: 1.5 },
};
