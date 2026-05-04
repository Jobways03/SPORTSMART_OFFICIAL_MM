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

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: '#0F1115' }}>Analytics</h1>
          <p style={{ marginTop: 4, fontSize: 14, color: '#525A65' }}>Sales, orders, customers, and conversion.</p>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {PRESETS.map((p) => (
            <button key={p.days} type="button" onClick={() => setPreset(p.days)} style={{
              height: 32, padding: '0 12px', border: '1px solid #D2D6DC', background: '#fff',
              borderRadius: 9999, fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}>{p.label}</button>
          ))}
          <input type="date" value={start} onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))} style={dateInput} />
          <span style={{ fontSize: 12, color: '#7A828F' }}>→</span>
          <input type="date" value={end} onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))} style={dateInput} />
        </div>
      </div>

      {loading && !sales ? (
        <div style={{ padding: 40, color: '#7A828F', textAlign: 'center' }}>Loading…</div>
      ) : (
        <>
          {/* KPI cards with vs-prior-period delta */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
            <Kpi
              label="Gross revenue"
              value={sales ? inr(sales.grossRevenue) : '—'}
              sub={`${sales?.orderCount ?? 0} orders`}
              delta={compare?.deltas.grossRevenuePct ?? null}
            />
            <Kpi
              label="Net revenue"
              value={sales ? inr(sales.netRevenue) : '—'}
              sub={`AOV ${sales ? inr(sales.averageOrderValue) : '—'}`}
              delta={compare?.deltas.netRevenuePct ?? null}
            />
            <Kpi
              label="Order count"
              value={String(sales?.orderCount ?? 0)}
              sub={`${customers?.newInPeriod ?? 0} new · ${customers?.returningInPeriod ?? 0} returning`}
              delta={compare?.deltas.orderCountPct ?? null}
            />
            <Kpi
              label="Paid orders"
              value={String(funnel?.ordersPaid ?? 0)}
              sub={`${((funnel?.checkoutToPaidRate ?? 0) * 100).toFixed(0)}% checkout→paid`}
            />
          </div>

          {/* Sales by day — simple SVG bar chart */}
          <Card
            title="Revenue by day"
            csvHref={adminAnalyticsService.csvUrl(
              'sales-daily',
              new Date(start).toISOString(),
              new Date(end + 'T23:59:59').toISOString(),
            )}
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
              csvHref={adminAnalyticsService.csvUrl(
                'order-status-mix',
                new Date(start).toISOString(),
                new Date(end + 'T23:59:59').toISOString(),
              )}
            >
              {statusMix.length === 0 ? (
                <div style={{ color: '#7A828F', fontSize: 13, padding: 16 }}>No data.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <th style={tinyTh}>Status</th>
                      <th style={{ ...tinyTh, textAlign: 'right' }}>Count</th>
                      <th style={{ ...tinyTh, textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusMix.map((s) => (
                      <tr key={s.status} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={tinyTd}>{s.status.replace(/_/g, ' ').toLowerCase()}</td>
                        <td style={{ ...tinyTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.count}</td>
                        <td style={{ ...tinyTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{inr(s.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card
              title="Top products"
              csvHref={adminAnalyticsService.csvUrl(
                'top-products',
                new Date(start).toISOString(),
                new Date(end + 'T23:59:59').toISOString(),
              )}
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
              csvHref={adminAnalyticsService.csvUrl(
                'bottom-products',
                new Date(start).toISOString(),
                new Date(end + 'T23:59:59').toISOString(),
              )}
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
}: {
  label: string;
  value: string;
  sub?: string;
  /** Percent change vs prior period; null = baseline was zero. */
  delta?: number | null;
}) {
  let deltaTxt: React.ReactNode = null;
  if (delta != null) {
    const positive = delta >= 0;
    deltaTxt = (
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: positive ? '#15803d' : '#b91c1c',
          marginLeft: 8,
        }}
      >
        {positive ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
      </span>
    );
  } else if (delta === null) {
    deltaTxt = (
      <span style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 8 }}>—</span>
    );
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#7A828F', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 4 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#0F1115', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
        {deltaTxt}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#7A828F', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Card({
  title,
  children,
  csvHref,
}: {
  title: string;
  children: React.ReactNode;
  csvHref?: string;
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16, padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#525A65', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>{title}</h3>
        {csvHref && (
          <a
            href={csvHref}
            download
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#525A65',
              textDecoration: 'none',
              border: '1px solid #D2D6DC',
              borderRadius: 6,
              padding: '3px 8px',
            }}
          >
            ⬇ CSV
          </a>
        )}
      </div>
      {children}
    </div>
  );
}

function ProductTable({ rows }: { rows: ProductPerformance[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
          <th style={tinyTh}>Product</th>
          <th style={{ ...tinyTh, textAlign: 'right' }}>Units</th>
          <th style={{ ...tinyTh, textAlign: 'right' }}>Revenue</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.productId} style={{ borderBottom: '1px solid #F3F4F6' }}>
            <td style={{ ...tinyTd, fontWeight: 500 }}>{p.title.length > 30 ? p.title.slice(0, 28) + '…' : p.title}</td>
            <td style={{ ...tinyTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.unitsSold}</td>
            <td style={{ ...tinyTd, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{inr(p.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SvgBars({ data }: { data: SalesSummary['byDay'] }) {
  const w = 1100;
  const h = 200;
  const pad = 24;
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const barW = (w - pad * 2) / data.length - 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      {data.map((d, i) => {
        const x = pad + i * (barW + 4);
        const barH = (d.revenue / max) * (h - pad * 2);
        const y = h - pad - barH;
        return (
          <g key={d.date}>
            <rect x={x} y={y} width={barW} height={barH} fill="#0F1115" rx={4} />
            <text x={x + barW / 2} y={h - 8} textAnchor="middle" fontSize="9" fill="#525A65">
              {d.date.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function FunnelView({ funnel }: { funnel: ConversionFunnel }) {
  const max = Math.max(funnel.cartCreated, funnel.checkoutInitiated, funnel.ordersPlaced, funnel.ordersPaid, 1);
  const steps = [
    { label: 'Carts created', value: funnel.cartCreated, color: '#cbd5e1' },
    { label: 'Checkout initiated (est.)', value: funnel.checkoutInitiated, color: '#94a3b8' },
    { label: 'Orders placed', value: funnel.ordersPlaced, color: '#475569' },
    { label: 'Orders paid', value: funnel.ordersPaid, color: '#0F1115' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s) => (
        <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 80px', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#525A65' }}>{s.label}</span>
          <div style={{ background: '#F3F4F6', borderRadius: 9999, height: 24, overflow: 'hidden' }}>
            <div style={{ background: s.color, width: `${(s.value / max) * 100}%`, height: '100%', borderRadius: 9999 }} />
          </div>
          <span style={{ textAlign: 'right', fontSize: 14, fontWeight: 600, color: '#0F1115', fontVariantNumeric: 'tabular-nums' }}>{s.value.toLocaleString('en-IN')}</span>
        </div>
      ))}
    </div>
  );
}

const tinyTh: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#7A828F' };
const tinyTd: React.CSSProperties = { padding: '8px 10px', fontSize: 13, color: '#0F1115' };
const dateInput: React.CSSProperties = { height: 32, padding: '0 8px', border: '1px solid #D2D6DC', background: '#fff', borderRadius: 9999, fontSize: 12, outline: 'none' };
