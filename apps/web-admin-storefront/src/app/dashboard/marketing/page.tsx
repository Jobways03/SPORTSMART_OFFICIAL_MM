'use client';

// Phase 38+ (2026-06-08) — Marketing hub. Replaces the old placeholder stub.
//
// The marketplace already ships Discounts (full CRUD + analytics + abuse) and a
// Flash Sales backend (admin/flash-sales: list/detail/create) that has NO admin
// UI. This page becomes the marketing landing: live counts, a read-only Flash
// Sales list (otherwise invisible in the admin), and cards linking to the
// marketing / merchandising tools that exist. Composes existing endpoints —
// no new backend. Data access is defensive (response shapes handled with
// fallbacks) so it renders correctly regardless of minor envelope differences.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface FlashSaleRow {
  id?: string;
  name?: string;
  title?: string;
  status?: string;
  isActive?: boolean;
  startsAt?: string;
  startDate?: string;
  startAt?: string;
  endsAt?: string;
  endDate?: string;
  endAt?: string;
  membersOnly?: boolean;
  collectionSlug?: string | null;
}

const TOOLS = [
  { href: '/dashboard/discounts', icon: '🎟️', title: 'Discounts & Coupons', desc: 'Create and manage discount codes, automatic offers and coupon rules.' },
  { href: '/dashboard/discounts/analytics', icon: '📊', title: 'Discount Analytics', desc: 'Redemptions, revenue impact and top-performing discounts.' },
  { href: '/dashboard/discounts/abuse', icon: '🛡️', title: 'Abuse Monitor', desc: 'Review and flag suspicious or abusive coupon usage.' },
  { href: '/dashboard/products/collections', icon: '🗂️', title: 'Collections', desc: 'Curate product collections for storefront merchandising.' },
  { href: '/dashboard/content', icon: '🖼️', title: 'Storefront Content', desc: 'Manage homepage banners, sections and storefront content.' },
  { href: '/dashboard/blog-posts', icon: '📝', title: 'Blog Posts', desc: 'Publish content-marketing posts to the storefront blog.' },
];

const ACTIVE_STATES = ['ACTIVE', 'LIVE', 'RUNNING', 'ONGOING'];

const fmtDate = (v?: string) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
};
const fmtCount = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-IN'));

function flashIsActive(f: FlashSaleRow): boolean {
  if (typeof f.isActive === 'boolean') return f.isActive;
  if (f.status) return ACTIVE_STATES.includes(String(f.status).toUpperCase());
  return false;
}
const flashName = (f: FlashSaleRow) => f.name || f.title || '(untitled sale)';
const flashStart = (f: FlashSaleRow) => f.startsAt || f.startDate || f.startAt;
const flashEnd = (f: FlashSaleRow) => f.endsAt || f.endDate || f.endAt;

export default function MarketingPage() {
  const [discountTotal, setDiscountTotal] = useState<number | null>(null);
  const [flashSales, setFlashSales] = useState<FlashSaleRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [discRes, flashRes] = await Promise.all([
        apiClient<any>('/admin/discounts?limit=1').catch(() => null),
        apiClient<any>('/admin/flash-sales').catch(() => null),
      ]);
      if (cancelled) return;
      const dd = discRes?.data ?? {};
      const dlist = dd?.discounts ?? dd?.items ?? dd?.data ?? (Array.isArray(dd) ? dd : []);
      setDiscountTotal(dd?.pagination?.total ?? (Array.isArray(dlist) ? dlist.length : null));
      const fd = flashRes?.data ?? {};
      const flist = fd?.flashSales ?? fd?.items ?? fd?.data ?? (Array.isArray(fd) ? fd : []);
      setFlashSales(Array.isArray(flist) ? flist : []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeFlash = useMemo(() => flashSales.filter(flashIsActive).length, [flashSales]);

  return (
    <div style={st.page}>
      <header style={st.header}>
        <div>
          <h1 style={st.h1}>Marketing</h1>
          <p style={st.sub}>Campaigns, promotions and storefront merchandising.</p>
        </div>
        <Link href="/dashboard/discounts/new" style={st.cta}>
          + New discount
        </Link>
      </header>

      {/* KPIs */}
      <div style={st.kpiRow}>
        <Kpi label="Total discounts" value={fmtCount(discountTotal)} hint="Codes + automatic offers" accent="#2563eb" />
        <Kpi label="Flash sales" value={fmtCount(loading && !flashSales.length ? null : flashSales.length)} hint="All scheduled sales" accent="#7c3aed" />
        <Kpi label="Active flash sales" value={fmtCount(loading && !flashSales.length ? null : activeFlash)} hint="Live right now" accent="#16a34a" />
      </div>

      {/* Flash sales — the capability with no other admin UI */}
      <section style={st.card}>
        <div style={st.cardHead}>
          <div>
            <h2 style={st.cardTitle}>Flash sales</h2>
            <p style={st.cardSub}>Scheduled time-boxed storefront sales. Click a row to edit.</p>
          </div>
          <Link href="/dashboard/marketing/flash-sales/new" style={st.smallBtn}>+ New flash sale</Link>
        </div>
        {loading && flashSales.length === 0 ? (
          <p style={st.muted}>Loading…</p>
        ) : flashSales.length === 0 ? (
          <div style={st.empty}>No flash sales scheduled.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Sale</th>
                  <th style={st.th}>Window</th>
                  <th style={st.th}>Audience</th>
                  <th style={st.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {flashSales.map((f, i) => {
                  const active = flashIsActive(f);
                  return (
                    <tr key={f.id ?? i} style={st.tr}>
                      <td style={st.td}>
                        {f.id ? (
                          <Link href={`/dashboard/marketing/flash-sales/${f.id}`} style={{ fontWeight: 600, color: '#2563eb', textDecoration: 'none' }}>
                            {flashName(f)}
                          </Link>
                        ) : (
                          <span style={{ fontWeight: 600, color: '#0f1115' }}>{flashName(f)}</span>
                        )}
                      </td>
                      <td style={{ ...st.td, color: '#6b7280' }}>
                        {fmtDate(flashStart(f))} → {fmtDate(flashEnd(f))}
                      </td>
                      <td style={{ ...st.td, color: '#6b7280' }}>
                        {f.membersOnly ? 'Members only' : 'Everyone'}
                      </td>
                      <td style={st.td}>
                        <span style={{ ...st.badge, background: active ? '#dcfce7' : '#f3f4f6', color: active ? '#166534' : '#6b7280' }}>
                          {active ? 'Active' : f.status ? String(f.status) : 'Scheduled'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tool cards */}
      <h2 style={{ ...st.cardTitle, margin: '8px 2px 12px' }}>Marketing tools</h2>
      <div style={st.toolGrid}>
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} style={st.tool}>
            <span style={st.toolIcon}>{t.icon}</span>
            <span style={st.toolTitle}>{t.title}</span>
            <span style={st.toolDesc}>{t.desc}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent: string }) {
  return (
    <div style={st.kpi}>
      <div style={{ ...st.kpiAccent, background: accent }} />
      <div style={st.kpiBody}>
        <span style={st.kpiLabel}>{label}</span>
        <span style={st.kpiValue}>{value}</span>
        {hint ? <span style={st.kpiHint}>{hint}</span> : null}
      </div>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page: { padding: '8px 0 40px', maxWidth: 1100 },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 16 },
  h1: { fontSize: 24, fontWeight: 700, margin: 0, color: '#0f1115' },
  sub: { fontSize: 14, color: '#525A65', margin: '4px 0 0' },
  cta: { fontSize: 13, fontWeight: 600, color: '#fff', background: '#2563eb', padding: '9px 14px', borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap' },
  muted: { fontSize: 13, color: '#6b7280' },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 18 },
  kpi: { display: 'flex', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' },
  kpiAccent: { width: 4, flexShrink: 0 },
  kpiBody: { display: 'flex', flexDirection: 'column', gap: 2, padding: '14px 16px' },
  kpiLabel: { fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' },
  kpiValue: { fontSize: 24, fontWeight: 700, color: '#0f1115', fontVariantNumeric: 'tabular-nums' },
  kpiHint: { fontSize: 12, color: '#94a3b8' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 22 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: 700, margin: 0, color: '#0f1115' },
  cardSub: { fontSize: 12, color: '#6b7280', margin: '4px 0 0' },
  smallBtn: { fontSize: 13, fontWeight: 600, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', padding: '7px 12px', borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap', alignSelf: 'flex-start' },
  empty: { padding: 32, textAlign: 'center', color: '#9ca3af', background: '#f9fafb', borderRadius: 8, border: '1px dashed #e5e7eb', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '10px 12px', fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '12px', verticalAlign: 'middle' },
  badge: { display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600 },
  toolGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 },
  tool: { display: 'flex', flexDirection: 'column', gap: 6, padding: 18, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, textDecoration: 'none' },
  toolIcon: { fontSize: 22 },
  toolTitle: { fontSize: 14, fontWeight: 700, color: '#0f1115' },
  toolDesc: { fontSize: 12.5, color: '#6b7280', lineHeight: 1.5 },
};
