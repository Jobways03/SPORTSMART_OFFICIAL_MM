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

interface RecentOrder {
  id: string;
  orderNumber: string;
  totalAmount: number;
  discountAmount?: number;
  paymentStatus: string;
  itemCount: number;
  createdAt: string;
  customer: { firstName: string; lastName: string; email: string };
}

type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/* ── Formatting ─────────────────────────────────────────────── */

const inrCompact = (v: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(v);

const inr = (v: number) =>
  `₹${Number(v).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const initials = (first: string, last: string) =>
  `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';

function avatarColor(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    bg: `hsl(${hue}, 42%, 94%)`,
    fg: `hsl(${hue}, 48%, 30%)`,
  };
}

function paymentPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'PAID':
      return { label: 'Paid', tone: 'success' };
    case 'PENDING':
      return { label: 'Pending', tone: 'warning' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'danger' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'info' };
    default:
      return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

/* ── Page ───────────────────────────────────────────────────── */

export default function AdminDashboardPage() {
  const router = useRouter();
  const [adminName, setAdminName] = useState('');
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) {
        const admin = JSON.parse(adminData);
        setAdminName(admin.name || 'Admin');
      }
    } catch {}

    Promise.all([
      apiClient<KpiData>('/admin/dashboard/kpis').catch(() => null),
      apiClient<{ orders: RecentOrder[] }>('/admin/orders?limit=5').catch(
        () => null,
      ),
    ]).then(([kpiRes, ordersRes]) => {
      if (kpiRes?.data) setKpis(kpiRes.data);
      if (ordersRes?.data?.orders) setRecentOrders(ordersRes.data.orders);
      setLoading(false);
    });
  }, []);

  const now = useMemo(() => new Date(), []);

  return (
    <div style={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
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
      </header>

      {/* ── States ─────────────────────────────────────────── */}
      {loading ? (
        <SkeletonLayout />
      ) : !kpis ? (
        <ErrorState />
      ) : (
        <>
          {/* ── Primary KPIs ─────────────────────────────── */}
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

          {/* ── Secondary KPIs (clickable) ─────────────────── */}
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
              href="/dashboard/sellers"
            />
            <KpiInline
              label="Customers"
              value={num(kpis.totalCustomers)}
              href="/dashboard/customers"
            />
          </div>

          {/* ── Alert: pending orders ──────────────────────── */}
          {kpis.pendingOrders > 0 && (
            <Link
              href="/dashboard/orders?status=pending"
              style={styles.alert}
            >
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
                  style={{ marginLeft: 2 }}
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

          {/* ── Recent orders ──────────────────────────────── */}
          {recentOrders.length > 0 && (
            <Section
              title="Recent orders"
              subtitle={`Latest ${recentOrders.length} orders across the marketplace`}
              action={
                <Link href="/dashboard/orders" style={styles.sectionAction}>
                  All orders →
                </Link>
              }
            >
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Order</th>
                      <th style={styles.th}>Customer</th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Items
                      </th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>
                        Amount
                      </th>
                      <th style={styles.th}>Payment</th>
                      <th style={styles.th}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map((o) => (
                      <OrderRow
                        key={o.id}
                        order={o}
                        onOpen={() =>
                          router.push(`/dashboard/orders/${o.id}`)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* ── Quick actions ──────────────────────────────── */}
          <div style={styles.quickActionsHead}>
            <h2 style={styles.sectionTitle}>Quick actions</h2>
            <p style={styles.sectionSub}>
              Common admin tasks to keep the marketplace healthy.
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
              title="Manage orders"
              body="Track, reassign, and resolve issues on marketplace orders."
              cta="View orders"
              href="/dashboard/orders"
              icon={
                <svg viewBox="0 0 24 24" style={styles.qaIcon} aria-hidden="true">
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 7h16v14H4zM4 7l4-3h8l4 3M9 12h6M9 16h6"
                  />
                </svg>
              }
            />
            <QuickAction
              title="Commissions"
              body="Review seller commissions, settlements, and platform earnings."
              cta="Open commissions"
              href="/dashboard/commission"
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
      <div
        style={{
          ...styles.kpiValue,
          ...(emphasis ? styles.kpiValueXL : {}),
        }}
      >
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

function OrderRow({
  order: o,
  onOpen,
}: {
  order: RecentOrder;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const pay = paymentPill(o.paymentStatus);
  const customerName =
    [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') ||
    o.customer?.email ||
    'Unknown';
  const color = avatarColor(customerName);
  const total =
    Number(o.totalAmount) + Number(o.discountAmount || 0);
  return (
    <tr
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      style={{
        ...styles.tr,
        background: hover ? '#f8fafc' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td style={styles.td}>
        <span style={styles.orderNumber}>#{o.orderNumber}</span>
      </td>
      <td style={styles.td}>
        <div style={styles.customerCell}>
          <div
            style={{
              ...styles.avatar,
              background: color.bg,
              color: color.fg,
            }}
            aria-hidden="true"
          >
            {initials(o.customer?.firstName ?? '', o.customer?.lastName ?? '')}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.customerName}>{customerName}</div>
            {o.customer?.email && (
              <div style={styles.customerEmail} title={o.customer.email}>
                {o.customer.email}
              </div>
            )}
          </div>
        </div>
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          color: '#475569',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {o.itemCount}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {inr(total)}
      </td>
      <td style={styles.td}>
        <Pill label={pay.label} tone={pay.tone} />
      </td>
      <td style={{ ...styles.td, color: '#475569', whiteSpace: 'nowrap' }}>
        {fmtDate(o.createdAt)}
      </td>
    </tr>
  );
}

function Pill({ label, tone }: { label: string; tone: PillTone }) {
  const toneStyles = pillTones[tone];
  return (
    <span style={{ ...styles.pill, ...toneStyles.wrap }}>
      <span style={{ ...styles.pillDot, background: toneStyles.dot }} />
      {label}
    </span>
  );
}

const pillTones: Record<
  PillTone,
  { wrap: React.CSSProperties; dot: string }
> = {
  success: {
    wrap: {
      background: 'rgba(22, 163, 74, 0.08)',
      color: '#15803d',
      borderColor: 'rgba(22, 163, 74, 0.2)',
    },
    dot: '#16a34a',
  },
  warning: {
    wrap: {
      background: 'rgba(245, 158, 11, 0.1)',
      color: '#b45309',
      borderColor: 'rgba(245, 158, 11, 0.25)',
    },
    dot: '#f59e0b',
  },
  danger: {
    wrap: {
      background: 'rgba(220, 38, 38, 0.08)',
      color: '#b91c1c',
      borderColor: 'rgba(220, 38, 38, 0.2)',
    },
    dot: '#dc2626',
  },
  info: {
    wrap: {
      background: 'rgba(14, 116, 144, 0.08)',
      color: '#0e7490',
      borderColor: 'rgba(14, 116, 144, 0.2)',
    },
    dot: '#0891b2',
  },
  neutral: {
    wrap: {
      background: '#f1f5f9',
      color: '#475569',
      borderColor: '#e2e8f0',
    },
    dot: '#94a3b8',
  },
};

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

function ErrorState() {
  return (
    <div style={styles.errorState}>
      <svg viewBox="0 0 48 48" style={styles.errorIcon} aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M24 4a20 20 0 100 40 20 20 0 000-40zm0 10v14m0 4v2"
        />
      </svg>
      <h3 style={styles.errorTitle}>Couldn't load the dashboard</h3>
      <p style={styles.errorBody}>
        Something went wrong fetching marketplace data. Refresh the page to try
        again.
      </p>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const skelKeyframes = `
@keyframes sa-shimmer {
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
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
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
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(245, 158, 11, 0.3)',
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
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 8,
    flexShrink: 0,
    whiteSpace: 'nowrap',
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

  /* Table */
  card: {
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableScroll: { overflowX: 'auto' },
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
    cursor: 'pointer',
    outline: 'none',
    transition: 'background-color 0.08s',
  },
  td: {
    padding: '12px 16px',
    verticalAlign: 'middle',
    fontSize: 13,
    color: '#0f172a',
  },
  orderNumber: {
    fontWeight: 600,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },

  customerCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  customerName: {
    fontWeight: 600,
    color: '#0f172a',
    fontSize: 13,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  customerEmail: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 260,
  },

  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 10px 3px 8px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
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

  /* Error */
  errorState: {
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: '56px 24px',
    textAlign: 'center',
  },
  errorIcon: {
    width: 40,
    height: 40,
    color: '#94a3b8',
    marginBottom: 12,
  },
  errorTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
  },
  errorBody: {
    margin: '6px auto 0',
    fontSize: 13,
    color: '#64748b',
    maxWidth: 360,
  },

  /* Skeleton */
  skel: {
    display: 'inline-block',
    borderRadius: 4,
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'sa-shimmer 1.2s ease-in-out infinite',
  },
};
