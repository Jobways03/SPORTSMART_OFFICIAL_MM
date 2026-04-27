'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface SellerInfo {
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string;
}

interface KpiState {
  products: number | null;
  orders: number | null;
  revenue: number | null;
  pending: number | null;
}

const INITIAL_KPIS: KpiState = {
  products: null,
  orders: null,
  revenue: null,
  pending: null,
};

const fmtCount = (v: number | null) =>
  v === null ? '—' : v.toLocaleString('en-IN');
const fmtInr = (v: number | null) =>
  v === null
    ? '₹—'
    : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

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

export default function DashboardPage() {
  const [seller, setSeller] = useState<SellerInfo | null>(null);
  const [kpis, setKpis] = useState<KpiState>(INITIAL_KPIS);

  useEffect(() => {
    try {
      const data = sessionStorage.getItem('seller');
      if (data) setSeller(JSON.parse(data));
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [productsRes, ordersRes, earningsRes] = await Promise.all([
        apiClient<{ pagination: { total: number } }>(
          '/seller/products?limit=1',
        ).catch(() => null),
        apiClient<{ pagination: { total: number } }>(
          '/seller/orders?limit=1',
        ).catch(() => null),
        apiClient<{ totalEarned: number; pendingSettlement: number }>(
          '/seller/earnings/summary',
        ).catch(() => null),
      ]);
      if (cancelled) return;
      setKpis({
        products: productsRes?.data?.pagination?.total ?? null,
        orders: ordersRes?.data?.pagination?.total ?? null,
        revenue: earningsRes?.data?.totalEarned ?? null,
        pending: earningsRes?.data?.pendingSettlement ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const now = useMemo(() => new Date(), []);

  if (!seller) return null;

  return (
    <div style={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>
            {greetingFor(now)}, {seller.sellerName.split(' ')[0]}.
          </h1>
          <p style={styles.headerSub}>
            Here's a snapshot of your store for {todayLabel(now)}.
          </p>
        </div>
      </header>

      {/* ── Primary KPIs ───────────────────────────────────── */}
      <div style={styles.kpiGridPrimary}>
        <KpiCard
          label="Total earned"
          value={fmtInr(kpis.revenue)}
          delta="Settled to your bank"
          emphasis
        />
        <KpiCard
          label="Pending settlement"
          value={fmtInr(kpis.pending)}
          delta="Awaiting next payout cycle"
          deltaTone={kpis.pending && kpis.pending > 0 ? 'positive' : 'muted'}
          emphasis
        />
        <KpiCard
          label="Orders"
          value={fmtCount(kpis.orders)}
          delta={
            kpis.orders === null
              ? undefined
              : kpis.orders === 0
                ? 'No orders received yet'
                : 'Lifetime orders'
          }
          emphasis
        />
        <KpiCard
          label="Products"
          value={fmtCount(kpis.products)}
          delta={
            kpis.products === null
              ? undefined
              : kpis.products === 0
                ? 'No products listed yet'
                : 'Products in your catalog'
          }
          emphasis
        />
      </div>

      {/* ── Onboarding alert (only when there are 0 products) ── */}
      {kpis.products === 0 && (
        <Link href="/dashboard/products/new" style={styles.alert}>
          <div style={styles.alertLeft}>
            <span style={styles.alertDot} aria-hidden="true" />
            <div>
              <div style={styles.alertTitle}>
                Start selling — list your first product
              </div>
              <div style={styles.alertBody}>
                Your shop is set up, but customers can't see anything yet. Add a
                product to go live.
              </div>
            </div>
          </div>
          <span style={styles.alertAction}>
            Add product
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

      {/* ── Quick actions ──────────────────────────────────── */}
      <div style={styles.sectionHeadBlock}>
        <h2 style={styles.sectionTitle}>Quick actions</h2>
        <p style={styles.sectionSub}>
          Common tasks to keep your store moving.
        </p>
      </div>
      <div style={styles.quickActionsGrid}>
        <QuickAction
          title="Complete profile"
          body="Add store details, logo, images, and policies so customers trust you."
          cta="Edit profile"
          href="/dashboard/profile"
          icon={
            <svg viewBox="0 0 24 24" style={styles.qaIcon} aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21c0-4 3.5-7 8-7s8 3 8 7"
              />
            </svg>
          }
        />
        <QuickAction
          title="Add a product"
          body="List a new product with variants, pricing, and inventory."
          cta="Add product"
          href="/dashboard/products/new"
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
          body="Accept, pack, and dispatch orders. Track deliveries in real time."
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
          title="Commission & earnings"
          body="Review per-order commissions, payouts, and settlement history."
          cta="Open earnings"
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

      {/* ── Account information ────────────────────────────── */}
      <div style={styles.sectionHeadBlock}>
        <h2 style={styles.sectionTitle}>Account information</h2>
        <p style={styles.sectionSub}>
          Details your customers and the platform see.
        </p>
      </div>
      <div style={styles.accountCard}>
        <AccountRow label="Shop name" value={seller.sellerShopName} />
        <AccountRow label="Email" value={seller.email} />
        <AccountRow label="Phone" value={seller.phoneNumber} />
      </div>
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

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.accountRow}>
      <div style={styles.accountLabel}>{label}</div>
      <div style={styles.accountValue}>{value}</div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: {
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

  /* KPI grid */
  kpiGridPrimary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 20,
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

  /* Section heading */
  sectionHeadBlock: {
    marginTop: 8,
    marginBottom: 12,
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

  /* Quick actions */
  quickActionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
    marginBottom: 24,
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
    transition: 'background-color 0.12s, border-color 0.12s',
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

  /* Account info */
  accountCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '8px 20px',
    marginBottom: 24,
  },
  accountRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    padding: '14px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  accountLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
    minWidth: 100,
  },
  accountValue: {
    fontSize: 14,
    color: '#0f172a',
    textAlign: 'right',
    wordBreak: 'break-word',
  },
};
