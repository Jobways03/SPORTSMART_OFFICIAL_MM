'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

/* ── Types ──────────────────────────────────────────────────── */

interface KpiData {
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  totalActiveSellers: number;
  totalCustomers: number;
  ordersToday: number;
  revenueToday: number;
  pendingOrders: number;
  totalPlatformMargin: number;
  avgOrderValue: number;
}

interface ProductPerformanceItem {
  productId: string;
  productCode: string | null;
  title: string;
  totalOrders: number;
  totalQuantitySold: number;
  totalRevenue: number;
  totalMargin: number;
}

interface SellerPerformanceItem {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  totalOrders: number;
  totalRevenue: number;
  avgDispatchSla: number;
  rejectionRate: number;
  totalMappedProducts: number;
  totalStock: number;
  isActive: boolean;
}

interface ProductPerformanceData {
  topByRevenue: ProductPerformanceItem[];
  mostSellersMapped: {
    productId: string;
    productCode: string | null;
    title: string;
    sellerCount: number;
  }[];
  lowestStock: {
    productId: string;
    productCode: string | null;
    title: string;
    totalStock: number;
  }[];
}

/* ── Formatting ─────────────────────────────────────────────── */

const inrCompact = (v: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(v);

const num = (v: number) => v.toLocaleString('en-IN');

const greetingFor = (d: Date) => {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const todayLabel = (d: Date) =>
  d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

/* ── Page ───────────────────────────────────────────────────── */

export default function DashboardHome() {
  const [adminName, setAdminName] = useState('');
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [productPerf, setProductPerf] = useState<ProductPerformanceData | null>(
    null,
  );
  const [sellerPerf, setSellerPerf] = useState<SellerPerformanceItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        setAdminName(JSON.parse(adminData).name || 'Admin');
      }
    } catch {}

    Promise.all([
      apiClient<KpiData>('/admin/dashboard/kpis').catch(() => null),
      apiClient<ProductPerformanceData>(
        '/admin/dashboard/product-performance?period=30d&limit=5',
      ).catch(() => null),
      apiClient<SellerPerformanceItem[]>(
        '/admin/dashboard/seller-performance',
      ).catch(() => null),
    ]).then(([kpiRes, prodRes, sellerRes]) => {
      if (kpiRes?.data) setKpis(kpiRes.data);
      if (prodRes?.data) setProductPerf(prodRes.data);
      if (sellerRes?.data)
        setSellerPerf(
          Array.isArray(sellerRes.data) ? sellerRes.data.slice(0, 5) : [],
        );
      setLoading(false);
    });
  }, []);

  const now = useMemo(() => new Date(), []);

  return (
    <div style={styles.page}>
      {/* ── Greeting header ────────────────────────────────── */}
      <header style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>
            {greetingFor(now)}
            {adminName ? `, ${adminName.split(' ')[0]}` : ''}.
          </h1>
          <p style={styles.headerSub}>
            Here's your marketplace overview for {todayLabel(now)}.
          </p>
        </div>
        <div style={styles.rangeBadge}>
          <svg viewBox="0 0 20 20" style={styles.rangeIcon} aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 4h10a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zM4 8h12M7 2v3M13 2v3"
            />
          </svg>
          Last 30 days
        </div>
      </header>

      {/* ── States ─────────────────────────────────────────── */}
      {loading ? (
        <SkeletonLayout />
      ) : (
        <>
          {/* ── Primary KPIs (revenue focus) ───────────────── */}
          {kpis && (
            <div style={styles.kpiGridPrimary}>
              <KpiCard
                label="Revenue"
                value={inrCompact(kpis.totalRevenue)}
                delta={
                  kpis.revenueToday > 0
                    ? `+${inrCompact(kpis.revenueToday)} today`
                    : 'No revenue today'
                }
                deltaTone={kpis.revenueToday > 0 ? 'positive' : 'muted'}
                emphasis
              />
              <KpiCard
                label="Orders"
                value={num(kpis.totalOrders)}
                delta={
                  kpis.ordersToday > 0
                    ? `+${num(kpis.ordersToday)} today`
                    : 'No orders today'
                }
                deltaTone={kpis.ordersToday > 0 ? 'positive' : 'muted'}
                emphasis
              />
              <KpiCard
                label="Avg order value"
                value={inrCompact(kpis.avgOrderValue)}
                emphasis
              />
              <KpiCard
                label="Platform margin"
                value={inrCompact(kpis.totalPlatformMargin)}
                emphasis
              />
            </div>
          )}

          {/* ── Secondary KPIs ─────────────────────────────── */}
          {kpis && (
            <div style={styles.kpiGridSecondary}>
              <KpiInline
                label="Pending orders"
                value={num(kpis.pendingOrders)}
                actionable={kpis.pendingOrders > 0}
                href="/dashboard/orders?status=pending"
              />
              <KpiInline
                label="Active products"
                value={num(kpis.totalProducts)}
                href="/dashboard/products"
              />
              <KpiInline
                label="Active sellers"
                value={num(kpis.totalActiveSellers)}
                href="/dashboard/sellers?filter=active"
              />
              <KpiInline
                label="Customers"
                value={num(kpis.totalCustomers)}
                href="/dashboard/customers"
              />
            </div>
          )}

          {/* ── Alert: pending orders ──────────────────────── */}
          {kpis && kpis.pendingOrders > 0 && (
            <Link href="/dashboard/orders?status=pending" style={styles.alert}>
              <div style={styles.alertLeft}>
                <span style={styles.alertDot} aria-hidden="true" />
                <div>
                  <div style={styles.alertTitle}>
                    {num(kpis.pendingOrders)} pending order
                    {kpis.pendingOrders === 1 ? '' : 's'} need attention
                  </div>
                  <div style={styles.alertBody}>
                    Review and acknowledge orders so fulfillment can proceed.
                  </div>
                </div>
              </div>
              <span style={styles.alertAction}>
                Review
                <svg
                  viewBox="0 0 20 20"
                  width="14"
                  height="14"
                  style={styles.alertChevron}
                  aria-hidden="true"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 4l6 6-6 6"
                  />
                </svg>
              </span>
            </Link>
          )}

          {/* ── Top products ───────────────────────────────── */}
          {productPerf && productPerf.topByRevenue.length > 0 && (
            <Section
              title="Top products"
              subtitle="Last 30 days, ranked by revenue"
              action={
                <Link href="/dashboard/products" style={styles.sectionAction}>
                  All products →
                </Link>
              }
            >
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Product</th>
                      <th style={styles.th}>Code</th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Orders
                      </th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Qty sold
                      </th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Revenue
                      </th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Margin
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {productPerf.topByRevenue.map((p, i) => (
                      <Row key={p.productId}>
                        <td style={styles.td}>
                          <div style={styles.rowTitle}>
                            <span style={styles.rank}>#{i + 1}</span>
                            <span style={styles.rowTitleText}>{p.title}</span>
                          </div>
                        </td>
                        <td style={{ ...styles.td, ...styles.mono }}>
                          {p.productCode || '—'}
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {p.totalOrders}
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {p.totalQuantitySold}
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {inrCompact(p.totalRevenue)}
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            color: '#475569',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {inrCompact(p.totalMargin)}
                        </td>
                      </Row>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ── Top sellers ────────────────────────────────── */}
          {sellerPerf.length > 0 && (
            <Section
              title="Top sellers"
              subtitle="Ranked by revenue in the last 30 days"
              action={
                <Link href="/dashboard/sellers" style={styles.sectionAction}>
                  All sellers →
                </Link>
              }
            >
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Seller</th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Orders
                      </th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Revenue
                      </th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Rejection
                      </th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Products
                      </th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Stock
                      </th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellerPerf.map((s) => (
                      <ClickableRow
                        key={s.sellerId}
                        href={`/dashboard/sellers?search=${encodeURIComponent(s.sellerName)}`}
                      >
                        <td style={styles.td}>
                          <div style={styles.sellerCell}>
                            <div style={styles.sellerName}>{s.sellerName}</div>
                            <div style={styles.sellerShop}>
                              {s.sellerShopName}
                            </div>
                          </div>
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {s.totalOrders}
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {inrCompact(s.totalRevenue)}
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            color:
                              s.rejectionRate > 10 ? '#b91c1c' : '#475569',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {Number(s.rejectionRate).toFixed(1)}%
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {s.totalMappedProducts}
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            textAlign: 'right' as const,
                            color: s.totalStock === 0 ? '#b91c1c' : '#0f172a',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {num(s.totalStock)}
                        </td>
                        <td style={styles.td}>
                          <StatusPill active={s.isActive} />
                        </td>
                      </ClickableRow>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ── Low stock warning ──────────────────────────── */}
          {productPerf && productPerf.lowestStock.length > 0 && (
            <Section
              title="Low stock"
              subtitle="Products running low across all sellers"
              action={
                <Link href="/dashboard/inventory" style={styles.sectionAction}>
                  All inventory →
                </Link>
              }
            >
              <div style={styles.lowStockGrid}>
                {productPerf.lowestStock.slice(0, 6).map((p) => {
                  const critical = p.totalStock <= 5;
                  return (
                    <Link
                      key={p.productId}
                      href={`/dashboard/products/${p.productId}/edit`}
                      style={styles.lowStockItem}
                    >
                      <div style={styles.lowStockTitle} title={p.title}>
                        {p.title}
                      </div>
                      <div style={styles.lowStockMeta}>
                        <span style={styles.lowStockCode}>
                          {p.productCode || '—'}
                        </span>
                        <span
                          style={{
                            ...styles.lowStockQty,
                            color: critical ? '#b91c1c' : '#b45309',
                          }}
                        >
                          {p.totalStock} left
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Section>
          )}

          {/* ── Quick actions ──────────────────────────────── */}
          <div style={styles.quickActionsHead}>
            <h2 style={styles.sectionTitle}>Quick actions</h2>
            <p style={styles.sectionSub}>
              Common admin tasks to keep your marketplace healthy.
            </p>
          </div>
          <div style={styles.quickActionsGrid}>
            <QuickAction
              title="Manage sellers"
              body="Review applications, track performance, and moderate seller accounts."
              cta="View sellers"
              href="/dashboard/sellers"
              icon={
                <svg viewBox="0 0 24 24" style={styles.qaIcon} aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM3 21c0-4 3-7 9-7s9 3 9 7"
                  />
                </svg>
              }
            />
            <QuickAction
              title="Review products"
              body="Approve, reject, or request changes on seller product submissions."
              cta="Review products"
              href="/dashboard/products"
              icon={
                <svg viewBox="0 0 24 24" style={styles.qaIcon} aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4"
                  />
                </svg>
              }
            />
            <QuickAction
              title="Analytics"
              body="Track revenue trends, conversion, and marketplace growth over time."
              cta="Open analytics"
              href="/dashboard/analytics"
              icon={
                <svg viewBox="0 0 24 24" style={styles.qaIcon} aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 20V10M10 20V4M16 20v-6M22 20H2"
                  />
                </svg>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

function QuickAction({
  title,
  body,
  cta,
  href,
  icon,
}: {
  title: string;
  body: string;
  cta: string;
  href: string;
  icon: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.qaCard,
        ...(hover ? styles.qaCardHover : {}),
      }}
    >
      <div style={styles.qaIconWrap}>{icon}</div>
      <div style={styles.qaTitle}>{title}</div>
      <div style={styles.qaBody}>{body}</div>
      <span style={styles.qaCta}>
        {cta}
        <svg
          viewBox="0 0 20 20"
          width="12"
          height="12"
          style={{
            ...styles.qaCtaChevron,
            transform: hover ? 'translateX(3px)' : 'translateX(0)',
          }}
          aria-hidden="true"
        >
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 4l6 6-6 6"
          />
        </svg>
      </span>
    </Link>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  delta,
  deltaTone = 'muted',
  emphasis,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: 'positive' | 'negative' | 'muted';
  emphasis?: boolean;
}) {
  return (
    <div style={styles.kpiCard}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, ...(emphasis ? styles.kpiValueXL : {}) }}>
        {value}
      </div>
      {delta && (
        <div
          style={{
            ...styles.kpiDelta,
            color:
              deltaTone === 'positive'
                ? '#15803d'
                : deltaTone === 'negative'
                  ? '#b91c1c'
                  : '#94a3b8',
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

function KpiInline({
  label,
  value,
  href,
  actionable,
}: {
  label: string;
  value: string;
  href: string;
  actionable?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.kpiInline,
        ...(actionable ? styles.kpiInlineActionable : {}),
        ...(hover ? styles.kpiInlineHover : {}),
      }}
    >
      <span
        style={{
          ...styles.kpiInlineLabel,
          ...(actionable ? { color: '#b45309' } : {}),
        }}
      >
        {label}
      </span>
      <span
        style={{
          ...styles.kpiInlineValue,
          ...(actionable ? { color: '#b45309' } : {}),
        }}
      >
        {value}
      </span>
    </Link>
  );
}

function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={styles.section}>
      <div style={styles.sectionHead}>
        <div style={{ minWidth: 0 }}>
          <h2 style={styles.sectionTitle}>{title}</h2>
          {subtitle && <p style={styles.sectionSub}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div style={styles.card}>{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.tr,
        background: hover ? '#f8fafc' : 'transparent',
      }}
    >
      {children}
    </tr>
  );
}

function ClickableRow({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [hover, setHover] = useState(false);
  return (
    <tr
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(href);
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.tr,
        background: hover ? '#f8fafc' : 'transparent',
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {children}
    </tr>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      style={{
        ...styles.pill,
        ...(active ? styles.pillActive : styles.pillInactive),
      }}
    >
      <span
        style={{
          ...styles.pillDot,
          background: active ? '#16a34a' : '#94a3b8',
        }}
      />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function SkeletonLayout() {
  return (
    <>
      <div style={styles.kpiGridPrimary}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={styles.kpiCard}>
            <div style={{ ...styles.skel, width: 80, height: 12 }} />
            <div
              style={{
                ...styles.skel,
                width: 120,
                height: 26,
                marginTop: 10,
              }}
            />
            <div
              style={{
                ...styles.skel,
                width: 90,
                height: 11,
                marginTop: 10,
              }}
            />
          </div>
        ))}
      </div>
      <div style={styles.kpiGridSecondary}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={styles.kpiInline}>
            <div style={{ ...styles.skel, width: 90, height: 12 }} />
            <div style={{ ...styles.skel, width: 30, height: 14 }} />
          </div>
        ))}
      </div>
      <style>{skelKeyframes}</style>
    </>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const skelKeyframes = `
@keyframes dash-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 1200,
    margin: '0 auto',
    color: '#0f172a',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },

  /* Header */
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#0f172a',
  },
  headerSub: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
  },
  rangeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    flexShrink: 0,
  },
  rangeIcon: {
    width: 14,
    height: 14,
    color: '#64748b',
  },

  /* KPI grids */
  kpiGridPrimary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 12,
  },
  kpiGridSecondary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 12,
    marginBottom: 24,
  },

  kpiCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '18px 20px',
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 8,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  },
  kpiValueXL: {
    fontSize: 26,
  },
  kpiDelta: {
    fontSize: 12,
    fontWeight: 500,
    marginTop: 8,
    fontVariantNumeric: 'tabular-nums',
  },

  kpiInline: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    textDecoration: 'none',
    color: 'inherit',
    transition: 'background-color 0.12s, border-color 0.12s',
  },
  kpiInlineHover: {
    background: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  kpiInlineActionable: {
    background: 'rgba(245, 158, 11, 0.06)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  kpiInlineLabel: {
    fontSize: 13,
    color: '#475569',
    fontWeight: 500,
  },
  kpiInlineValue: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  },

  /* Alert */
  alert: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '14px 18px',
    background: 'rgba(245, 158, 11, 0.08)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    borderRadius: 10,
    marginBottom: 24,
    textDecoration: 'none',
    color: 'inherit',
  },
  alertLeft: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    minWidth: 0,
  },
  alertDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#f59e0b',
    marginTop: 4,
    flexShrink: 0,
    boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.18)',
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#92400e',
  },
  alertBody: {
    fontSize: 12,
    color: '#a16207',
    marginTop: 2,
  },
  alertAction: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 600,
    color: '#92400e',
    background: '#ffffff',
    border: '1px solid rgba(245, 158, 11, 0.4)',
    borderRadius: 8,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  alertChevron: {
    marginLeft: 2,
  },

  /* Section */
  section: {
    marginBottom: 28,
  },
  sectionHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  sectionTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
    letterSpacing: '-0.01em',
  },
  sectionSub: {
    margin: '2px 0 0',
    fontSize: 12,
    color: '#64748b',
  },
  sectionAction: {
    fontSize: 13,
    fontWeight: 500,
    color: '#0f172a',
    textDecoration: 'none',
  },

  /* Table card */
  card: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableScroll: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
    transition: 'background-color 0.08s',
  },
  td: {
    padding: '12px 16px',
    verticalAlign: 'middle',
    fontSize: 13,
    color: '#0f172a',
  },
  mono: {
    fontFamily: '"SF Mono", Menlo, Consolas, monospace',
    fontSize: 12,
    color: '#475569',
  },

  rowTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  rank: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    padding: '2px 6px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    background: '#f1f5f9',
    borderRadius: 4,
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0,
  },
  rowTitleText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  sellerCell: {
    minWidth: 0,
  },
  sellerName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
  },
  sellerShop: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },

  /* Pill */
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 10px 2px 8px',
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 999,
    border: '1px solid',
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  pillActive: {
    background: 'rgba(22, 163, 74, 0.08)',
    color: '#15803d',
    borderColor: 'rgba(22, 163, 74, 0.2)',
  },
  pillInactive: {
    background: '#f1f5f9',
    color: '#475569',
    borderColor: '#e2e8f0',
  },

  /* Skeleton */
  skel: {
    display: 'inline-block',
    borderRadius: 4,
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'dash-shimmer 1.2s ease-in-out infinite',
  },

  /* Low stock grid */
  lowStockGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 1,
    background: '#e2e8f0',
  },
  lowStockItem: {
    display: 'block',
    padding: '14px 16px',
    background: '#ffffff',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'background-color 0.08s',
  },
  lowStockTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginBottom: 6,
  },
  lowStockMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  lowStockCode: {
    fontFamily: '"SF Mono", Menlo, Consolas, monospace',
    fontSize: 11,
    color: '#64748b',
  },
  lowStockQty: {
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },

  /* Quick actions */
  quickActionsHead: {
    marginTop: 8,
    marginBottom: 12,
  },
  quickActionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
    marginBottom: 12,
  },
  qaCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 20,
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    textDecoration: 'none',
    color: 'inherit',
    transition: 'background-color 0.12s, border-color 0.12s, transform 0.12s',
  },
  qaCardHover: {
    background: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  qaIconWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 8,
    background: 'rgba(0, 128, 96, 0.10)',
    color: '#00604a',
    marginBottom: 4,
  },
  qaIcon: {
    width: 20,
    height: 20,
  },
  qaTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
  },
  qaBody: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 1.5,
    flex: 1,
  },
  qaCta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    fontSize: 13,
    fontWeight: 600,
    color: '#0f172a',
  },
  qaCtaChevron: {
    transition: 'transform 0.18s ease',
  },
};
