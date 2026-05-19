'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminAnalyticsService,
  SalesSummary,
  SalesCompare,
  OrderStatusMix,
  ProductPerformance,
  CustomerAnalytics,
  ConversionFunnel,
  inr,
} from '@/services/admin-analytics.service';
import { ApiError } from '@/lib/api-client';

function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

const PRESETS = [
  { label: 'Last 7d', days: 7 },
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
];

export default function AnalyticsDashboardPage() {
  const router = useRouter();
  const [{ start, end }, setRange] = useState(defaultRange);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [statusMix, setStatusMix] = useState<OrderStatusMix[]>([]);
  const [topProducts, setTopProducts] = useState<ProductPerformance[]>([]);
  const [bottomProducts, setBottomProducts] = useState<ProductPerformance[]>([]);
  const [customers, setCustomers] = useState<CustomerAnalytics | null>(null);
  const [funnel, setFunnel] = useState<ConversionFunnel | null>(null);
  const [compare, setCompare] = useState<SalesCompare | null>(null);
  const [loading, setLoading] = useState(true);
  const [csvErr, setCsvErr] = useState<string | null>(null);

  // Pre-built ISO range so each CSV button can request the same window the
  // page is currently showing.
  const csvRange = {
    start: new Date(start).toISOString(),
    end: new Date(end + 'T23:59:59').toISOString(),
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const startISO = new Date(start).toISOString();
    const endISO = new Date(end + 'T23:59:59').toISOString();
    try {
      const [s, m, t, b, c, f, cmp] = await Promise.all([
        adminAnalyticsService.sales(startISO, endISO),
        adminAnalyticsService.orderStatusMix(startISO, endISO),
        adminAnalyticsService.topProducts(startISO, endISO, 10),
        adminAnalyticsService.bottomProducts(startISO, endISO, 10),
        adminAnalyticsService.customers(startISO, endISO),
        adminAnalyticsService.conversion(startISO, endISO),
        adminAnalyticsService.compare(startISO, endISO),
      ]);
      if (s.data) setSales(s.data);
      if (m.data) setStatusMix(m.data);
      if (t.data) setTopProducts(t.data);
      if (b.data) setBottomProducts(b.data);
      if (c.data) setCustomers(c.data);
      if (f.data) setFunnel(f.data);
      if (cmp.data) setCompare(cmp.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
    } finally {
      setLoading(false);
    }
  }, [start, end, router]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const setPreset = (days: number) => {
    const e = new Date();
    const s = new Date(e);
    s.setDate(s.getDate() - days);
    setRange({ start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) });
  };

  // Determine which preset is currently selected so the chip lights up.
  const activePreset = (() => {
    const startD = new Date(start);
    const endD = new Date(end);
    const today = new Date().toISOString().slice(0, 10);
    if (end !== today) return null;
    const diff = Math.round((endD.getTime() - startD.getTime()) / 86400000);
    return PRESETS.find((p) => p.days === diff)?.days ?? null;
  })();

  return (
    <div style={{ padding: '28px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={eyebrow}>INSIGHTS</div>
          <h1 style={pageTitle}>Analytics</h1>
          <p style={pageSubtitle}>Sales, orders, customers, and conversion at a glance.</p>
        </div>
        <div style={dateBar}>
          <div style={chipGroup}>
            {PRESETS.map((p) => {
              const active = activePreset === p.days;
              return (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => setPreset(p.days)}
                  style={chipStyle(active)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div style={dateInputGroup}>
            <input
              type="date"
              value={start}
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
              style={dateInput}
            />
            <span style={{ fontSize: 12, color: '#94A3B8' }}>→</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
              style={dateInput}
            />
          </div>
        </div>
      </div>

      {csvErr && (
        <div style={{
          padding: '10px 14px',
          marginBottom: 14,
          background: '#FEF2F2',
          border: '1px solid #FCA5A5',
          color: '#B91C1C',
          fontSize: 13,
          borderRadius: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}>
          <span>{csvErr}</span>
          <button
            type="button"
            onClick={() => setCsvErr(null)}
            style={{ background: 'transparent', border: 'none', color: '#B91C1C', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {loading && !sales ? (
        <div style={{ padding: 40, color: '#7A828F', textAlign: 'center' }}>Loading…</div>
      ) : (
        <>
          {/* KPI cards with vs-prior-period delta */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Kpi
              label="Gross revenue"
              value={sales ? inr(sales.grossRevenue) : '—'}
              sub={`${sales?.orderCount ?? 0} orders`}
              delta={compare?.deltas.grossRevenuePct ?? null}
              accent="indigo"
            />
            <Kpi
              label="Net revenue"
              value={sales ? inr(sales.netRevenue) : '—'}
              sub={`AOV ${sales ? inr(sales.averageOrderValue) : '—'}`}
              delta={compare?.deltas.netRevenuePct ?? null}
              accent="teal"
            />
            <Kpi
              label="Order count"
              value={String(sales?.orderCount ?? 0)}
              sub={`${customers?.newInPeriod ?? 0} new · ${customers?.returningInPeriod ?? 0} returning`}
              delta={compare?.deltas.orderCountPct ?? null}
              accent="amber"
            />
            <Kpi
              label="Paid orders"
              value={String(funnel?.ordersPaid ?? 0)}
              sub={`${((funnel?.checkoutToPaidRate ?? 0) * 100).toFixed(0)}% checkout→paid`}
              accent="rose"
            />
          </div>

          {/* Sales by day — simple SVG bar chart */}
          <Card
            title="Revenue by day"
            csvReport="sales-daily"
            csvRange={csvRange}
            onCsvError={setCsvErr}
          >
            {sales && sales.byDay.length > 0 ? (
              <SvgBars data={sales.byDay} />
            ) : (
              <div style={{ color: '#7A828F', fontSize: 13, textAlign: 'center', padding: 24 }}>No orders in this period.</div>
            )}
          </Card>

          {/* Status mix + top products */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <Card
              title="Order status mix"
              csvReport="order-status-mix"
              csvRange={csvRange}
              onCsvError={setCsvErr}
            >
              {statusMix.length === 0 ? (
                <div style={{ color: '#7A828F', fontSize: 13, padding: 16 }}>No data.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <th style={tinyTh}>Status</th>
                      <th style={{ ...tinyTh, textAlign: 'right' }}>Count</th>
                      <th style={{ ...tinyTh, textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusMix.map((s) => (
                      <tr key={s.status} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={tinyTd}><StatusChip status={s.status} /></td>
                        <td style={{ ...tinyTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.count}</td>
                        <td style={{ ...tinyTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#475569' }}>{inr(s.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card
              title="Top products"
              csvReport="top-products"
              csvRange={csvRange}
              onCsvError={setCsvErr}
            >
              {topProducts.length === 0 ? (
                <div style={{ color: '#7A828F', fontSize: 13, padding: 16 }}>No data.</div>
              ) : (
                <ProductTable rows={topProducts} />
              )}
            </Card>
          </div>

          {/* Bottom products row */}
          <div style={{ marginTop: 12 }}>
            <Card
              title="Slowest movers (bottom products)"
              csvReport="bottom-products"
              csvRange={csvRange}
              onCsvError={setCsvErr}
            >
              {bottomProducts.length === 0 ? (
                <div style={{ color: '#7A828F', fontSize: 13, padding: 16 }}>No data.</div>
              ) : (
                <ProductTable rows={bottomProducts} />
              )}
            </Card>
          </div>

          {/* Funnel */}
          <Card title="Conversion funnel">
            {funnel ? (
              <FunnelView funnel={funnel} />
            ) : (
              <div style={{ color: '#7A828F', fontSize: 13 }}>No data.</div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  delta,
  accent = 'indigo',
}: {
  label: string;
  value: string;
  sub?: string;
  /** Percent change vs prior period; null = baseline was zero. */
  delta?: number | null;
  /** Subtle accent strip — gives each KPI a quiet identity without
      flooding the page with colour. */
  accent?: 'indigo' | 'teal' | 'amber' | 'rose';
}) {
  const accentColor = {
    indigo: '#0F1115',
    teal: '#2A8595',
    amber: '#b45309',
    rose: '#b91c1c',
  }[accent];

  let deltaPill: React.ReactNode = null;
  if (delta != null) {
    const positive = delta >= 0;
    deltaPill = (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11.5,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 999,
          background: positive ? '#ECFDF5' : '#FEF2F2',
          color: positive ? '#047857' : '#B91C1C',
          border: `1px solid ${positive ? '#A7F3D0' : '#FECACA'}`,
        }}
      >
        {positive ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
      </span>
    );
  }

  return (
    <div style={{ ...kpiCard, position: 'relative', overflow: 'hidden' }}>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 3,
          background: accentColor,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <div style={kpiLabel}>{label}</div>
        {deltaPill}
      </div>
      <div style={kpiValue}>{value}</div>
      {sub && <div style={kpiSub}>{sub}</div>}
    </div>
  );
}


function Card({
  title,
  children,
  csvReport,
  csvRange,
  onCsvError,
}: {
  title: string;
  children: React.ReactNode;
  /** When set, renders a "CSV" button that fetches the report with the
      admin bearer token and triggers a blob download. */
  csvReport?: 'sales-daily' | 'top-products' | 'bottom-products' | 'order-status-mix';
  csvRange?: { start: string; end: string };
  onCsvError?: (msg: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!csvReport || !csvRange) return;
    setDownloading(true);
    try {
      await adminAnalyticsService.downloadCsv(csvReport, csvRange.start, csvRange.end);
    } catch (e) {
      onCsvError?.(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 14,
        padding: '18px 20px',
        marginTop: 14,
        boxShadow: '0 1px 0 rgba(15,23,42,0.02)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
          {title}
        </h3>
        {csvReport && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11.5,
              fontWeight: 600,
              color: '#475569',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              padding: '5px 10px',
              background: downloading ? '#F1F5F9' : '#F8FAFC',
              cursor: downloading ? 'not-allowed' : 'pointer',
              opacity: downloading ? 0.7 : 1,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {downloading ? 'Downloading…' : 'CSV'}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function ProductTable({ rows }: { rows: ProductPerformance[] }) {
  const maxRevenue = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #F1F5F9' }}>
          <th style={{ ...tinyTh, width: 40 }}>#</th>
          <th style={tinyTh}>Product</th>
          <th style={{ ...tinyTh, textAlign: 'right' }}>Units</th>
          <th style={{ ...tinyTh, textAlign: 'right' }}>Revenue</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p, idx) => {
          const pct = (p.revenue / maxRevenue) * 100;
          return (
            <tr key={p.productId} style={{ borderBottom: '1px solid #F1F5F9' }}>
              <td style={{ ...tinyTd, color: '#94A3B8', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {idx + 1}
              </td>
              <td style={{ ...tinyTd, fontWeight: 500, color: '#0F172A' }} title={p.title}>
                {p.title.length > 32 ? p.title.slice(0, 30) + '…' : p.title}
              </td>
              <td style={{ ...tinyTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#475569' }}>
                {p.unitsSold}
              </td>
              <td style={{ ...tinyTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0F172A', position: 'relative' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 60,
                      height: 6,
                      borderRadius: 999,
                      background: '#F1F5F9',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        height: '100%',
                        width: `${pct}%`,
                        background:
                          idx === 0
                            ? '#0F1115'
                            : '#D2D6DC',
                        borderRadius: 999,
                      }}
                    />
                  </span>
                  <span style={{ minWidth: 64, textAlign: 'right' }}>{inr(p.revenue)}</span>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SvgBars({ data }: { data: SalesSummary['byDay'] }) {
  const w = 1100;
  const h = 240;
  const padX = 24;
  const padTop = 28;
  const padBottom = 32;
  const chartH = h - padTop - padBottom;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const barW = (w - padX * 2) / data.length - 6;
  // Grid lines at 25/50/75/100% of max
  const gridLines = [0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        {/* Near-black gradient: feels data-focused, matches the design
            palette. Lighter at top, deeper at the base for visual weight. */}
        <linearGradient id="bar-grad-indigo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7A828F" />
          <stop offset="100%" stopColor="#0F1115" />
        </linearGradient>
        <linearGradient id="bar-grad-peak" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0F1115" />
          <stop offset="100%" stopColor="#0F1115" />
        </linearGradient>
      </defs>
      {/* Grid lines + y-axis ticks */}
      {gridLines.map((g) => {
        const y = padTop + chartH * (1 - g);
        return (
          <g key={g}>
            <line x1={padX + 36} y1={y} x2={w - padX} y2={y} stroke="#EEF2FF" />
            <text x={padX + 30} y={y + 3} fontSize="9" fill="#94A3B8" textAnchor="end">
              ₹{Math.round(max * g).toLocaleString('en-IN')}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = padX + 40 + i * ((w - padX * 2 - 40) / data.length);
        const slot = (w - padX * 2 - 40) / data.length;
        const thisBarW = Math.min(barW, slot - 6);
        const barH = (d.revenue / max) * chartH;
        const y = padTop + chartH - barH;
        const isTop = d.revenue === max && d.revenue > 0;
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={y}
              width={thisBarW}
              height={barH}
              fill={isTop ? 'url(#bar-grad-peak)' : 'url(#bar-grad-indigo)'}
              rx={6}
            />
            {/* Highlight max-day value above the bar */}
            {isTop && (
              <text
                x={x + thisBarW / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="#0F1115"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                ₹{Math.round(d.revenue).toLocaleString('en-IN')}
              </text>
            )}
            <text
              x={x + thisBarW / 2}
              y={h - 10}
              textAnchor="middle"
              fontSize="10"
              fill="#94A3B8"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {d.date.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StatusChip({ status }: { status: string }) {
  const s = status.toLowerCase();
  const map: Record<string, { bg: string; fg: string; border: string; dot: string }> = {
    delivered: { bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', dot: '#22C55E' },
    cancelled: { bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA', dot: '#EF4444' },
    'exception queue': { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', dot: '#F59E0B' },
    exception: { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', dot: '#F59E0B' },
    'routed to seller': { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', dot: '#3B82F6' },
    routed: { bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE', dot: '#3B82F6' },
    paid: { bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0', dot: '#22C55E' },
    refunded: { bg: '#F5F3FF', fg: '#6D28D9', border: '#DDD6FE', dot: '#8B5CF6' },
  };
  const tone = map[s] ?? { bg: '#F1F5F9', fg: '#475569', border: '#E2E8F0', dot: '#94A3B8' };
  const label = status.replace(/_/g, ' ').toLowerCase();
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 10px 3px 8px',
      borderRadius: 999,
      fontSize: 11.5,
      fontWeight: 600,
      background: tone.bg,
      color: tone.fg,
      border: `1px solid ${tone.border}`,
      textTransform: 'capitalize',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.dot }} />
      {label}
    </span>
  );
}

function FunnelView({ funnel }: { funnel: ConversionFunnel }) {
  const max = Math.max(funnel.cartCreated, funnel.checkoutInitiated, funnel.ordersPlaced, funnel.ordersPaid, 1);
  // Indigo progression: light → deep indigo signals "moving deeper into the
  // funnel". The final "Orders paid" bar gets the darkest indigo so the eye
  // naturally lands on the conversion outcome, without alarming reds.
  const steps = [
    { label: 'Carts created', value: funnel.cartCreated, color: '#D2D6DC' },
    { label: 'Checkout initiated (est.)', value: funnel.checkoutInitiated, color: '#7A828F' },
    { label: 'Orders placed', value: funnel.ordersPlaced, color: '#525A65' },
    { label: 'Orders paid', value: funnel.ordersPaid, color: '#0F1115' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const dropPct = prev != null && prev > 0 ? Math.round((1 - s.value / prev) * 100) : null;
        return (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 100px', gap: 14, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, color: '#0F172A', fontWeight: 500 }}>{s.label}</div>
              {dropPct !== null && (
                <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                  {dropPct > 0 ? `↓ ${dropPct}% from prev` : 'no drop'}
                </div>
              )}
            </div>
            <div style={{ background: '#F1F5F9', borderRadius: 9999, height: 26, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                background: s.color,
                width: `${(s.value / max) * 100}%`,
                height: '100%',
                borderRadius: 9999,
                transition: 'width 300ms ease',
              }} />
            </div>
            <span style={{ textAlign: 'right', fontSize: 15, fontWeight: 700, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
              {s.value.toLocaleString('en-IN')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const tinyTh: React.CSSProperties = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#64748B',
};
const tinyTd: React.CSSProperties = { padding: '12px 12px', fontSize: 13, color: '#0F172A' };
const dateInput: React.CSSProperties = {
  height: 34,
  padding: '0 10px',
  border: '1px solid #D2D6DC',
  background: '#fff',
  borderRadius: 8,
  fontSize: 12.5,
  outline: 'none',
  color: '#0F172A',
  fontVariantNumeric: 'tabular-nums',
};
const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.2,
  color: '#64748B',
  marginBottom: 4,
};
const pageTitle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  margin: 0,
  color: '#0F172A',
  letterSpacing: '-0.02em',
};
const pageSubtitle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 13.5,
  color: '#64748B',
  lineHeight: 1.55,
  maxWidth: 560,
};
const dateBar: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  flexWrap: 'wrap',
};
const chipGroup: React.CSSProperties = {
  display: 'inline-flex',
  background: '#F1F5F9',
  padding: 3,
  borderRadius: 10,
  gap: 2,
};
const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  fontSize: 12.5,
  fontWeight: 600,
  border: 'none',
  borderRadius: 8,
  background: active ? '#fff' : 'transparent',
  color: active ? '#0F172A' : '#64748B',
  cursor: 'pointer',
  boxShadow: active ? '0 1px 0 rgba(15,23,42,0.06), 0 2px 6px -2px rgba(15,23,42,0.12)' : 'none',
  transition: 'background 120ms ease, color 120ms ease',
});
const dateInputGroup: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};
const kpiCard: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #E5E7EB',
  borderRadius: 14,
  padding: '18px 20px',
  boxShadow: '0 1px 0 rgba(15,23,42,0.02)',
};
const kpiLabel: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
const kpiValue: React.CSSProperties = {
  fontSize: 30,
  fontWeight: 700,
  color: '#0F172A',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.02em',
  lineHeight: 1.1,
};
const kpiSub: React.CSSProperties = {
  fontSize: 12,
  color: '#64748B',
  marginTop: 6,
};
