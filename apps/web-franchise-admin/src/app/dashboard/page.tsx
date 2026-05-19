'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminFranchisesService } from '@/services/admin-franchises.service';

interface KpiState {
  totalFranchises: number | null;
  activeFranchises: number | null;
  pendingVerification: number | null;
  totalOrders: number | null;
  pendingSettlements: number | null;
}

const INITIAL_KPIS: KpiState = {
  totalFranchises: null,
  activeFranchises: null,
  pendingVerification: null,
  totalOrders: null,
  pendingSettlements: null,
};

// ── Icons (inline SVG, no dependency) ────────────────────────────────
const Ic = {
  storefront: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M10 20v-6h4v6" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  shield: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  package: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </svg>
  ),
  catalog: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  ),
  banknote: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2" /><path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  percent: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="5" x2="5" y2="19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
};

// ── Stat tint palette ────────────────────────────────────────────────
type Tint = 'blue' | 'emerald' | 'amber' | 'sky' | 'orange';
const TINTS: Record<Tint, { bg: string; fg: string; ring: string }> = {
  blue:    { bg: '#eff6ff', fg: '#1d4ed8', ring: '#dbeafe' },
  emerald: { bg: '#ecfdf5', fg: '#047857', ring: '#d1fae5' },
  amber:   { bg: '#fffbeb', fg: '#b45309', ring: '#fde68a' },
  sky:     { bg: '#f0f9ff', fg: '#0369a1', ring: '#bae6fd' },
  orange:  { bg: '#fff7ed', fg: '#c2410c', ring: '#fed7aa' },
};

export default function FranchiseAdminDashboardPage() {
  const [adminName, setAdminName] = useState('');
  const [kpis, setKpis] = useState<KpiState>(INITIAL_KPIS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const adminData = sessionStorage.getItem('admin');
      if (adminData) setAdminName(JSON.parse(adminData).name);
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const franchisesPromise = adminFranchisesService
        .listFranchises({ limit: 100 })
        .then((res) => res.data ?? null)
        .catch(() => null);

      const pendingSettlementsPromise = adminFranchisesService
        .listSettlements({ status: 'PENDING', limit: 1 })
        .then((res: any) => res?.data?.pagination?.total ?? null)
        .catch(() => null);

      const [franchisesData, pendingSettlements] = await Promise.all([
        franchisesPromise,
        pendingSettlementsPromise,
      ]);
      if (cancelled) return;

      let totalFranchises: number | null = null;
      let activeFranchises: number | null = null;
      let pendingVerification: number | null = null;
      let franchiseIds: string[] = [];

      if (franchisesData) {
        totalFranchises = franchisesData.pagination.total;
        activeFranchises = franchisesData.franchises.filter(
          (f) => f.status === 'ACTIVE',
        ).length;
        pendingVerification = franchisesData.franchises.filter(
          (f) => f.verificationStatus !== 'VERIFIED',
        ).length;
        franchiseIds = franchisesData.franchises.map((f) => f.id);
      }

      setKpis((prev) => ({
        ...prev,
        totalFranchises,
        activeFranchises,
        pendingVerification,
        pendingSettlements,
      }));

      if (franchiseIds.length > 0) {
        const totals = await Promise.all(
          franchiseIds.map((id) =>
            adminFranchisesService
              .listFranchiseOrders(id, { limit: 1 })
              .then((r) => r.data?.pagination.total ?? 0)
              .catch(() => 0),
          ),
        );
        if (cancelled) return;
        const totalOrders = totals.reduce((a, b) => a + b, 0);
        setKpis((prev) => ({ ...prev, totalOrders }));
      } else {
        setKpis((prev) => ({ ...prev, totalOrders: 0 }));
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const fmt = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-IN'));

  const today = useMemo(
    () =>
      new Date().toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    [],
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Show the empty-state banner when the DB really has nothing yet —
  // not while we're still loading the first batch of KPIs.
  const isEmpty =
    loaded &&
    (kpis.totalFranchises ?? 0) === 0 &&
    (kpis.totalOrders ?? 0) === 0;

  return (
    <div style={page}>
      {/* ── Header ───────────────────────────────────────────── */}
      <header style={headerWrap}>
        <div>
          <div style={eyebrow}>{today}</div>
          <h1 style={h1}>
            {greeting}
            {adminName ? `, ${adminName.split(' ')[0]}` : ''}.
          </h1>
          <p style={sub}>
            Here&apos;s a snapshot of every franchise on the platform.
          </p>
        </div>
      </header>

      {isEmpty && (
        <div style={emptyBanner}>
          <span style={emptyIcon}>{Ic.info}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#0c4a6e', fontSize: 14 }}>
              No franchise data yet
            </div>
            <div style={{ fontSize: 13, color: '#075985', marginTop: 2 }}>
              Onboard your first franchise from{' '}
              <Link href="/dashboard/franchises" style={emptyLink}>
                Franchises
              </Link>{' '}
              to start seeing orders, settlements, and verification flow through this dashboard.
            </div>
          </div>
        </div>
      )}

      {/* ── KPI strip ────────────────────────────────────────── */}
      <section style={statGrid}>
        <Stat
          label="Total franchises"
          value={fmt(kpis.totalFranchises)}
          icon={Ic.storefront}
          tint="blue"
          loading={kpis.totalFranchises === null}
          hint="Onboarded entities"
        />
        <Stat
          label="Active"
          value={fmt(kpis.activeFranchises)}
          icon={Ic.check}
          tint="emerald"
          loading={kpis.activeFranchises === null}
          hint="Fulfilling orders today"
        />
        <Stat
          label="Pending verification"
          value={fmt(kpis.pendingVerification)}
          icon={Ic.shield}
          tint="amber"
          loading={kpis.pendingVerification === null}
          hint="Awaiting KYC review"
          actionable={(kpis.pendingVerification ?? 0) > 0}
        />
        <Stat
          label="Total orders"
          value={fmt(kpis.totalOrders)}
          icon={Ic.package}
          tint="sky"
          loading={kpis.totalOrders === null}
          hint="Across all franchises"
        />
        <Stat
          label="Pending settlements"
          value={fmt(kpis.pendingSettlements)}
          icon={Ic.wallet}
          tint="orange"
          loading={kpis.pendingSettlements === null}
          hint="Awaiting payout"
          actionable={(kpis.pendingSettlements ?? 0) > 0}
        />
      </section>

      {/* ── Quick actions ────────────────────────────────────── */}
      <section style={{ marginTop: 28 }}>
        <div style={sectionHead}>
          <h2 style={h2}>Quick actions</h2>
          <p style={sectionSub}>Jump straight to the workflows you use most.</p>
        </div>
        <div style={actionGrid}>
          <ActionCard
            href="/dashboard/franchises"
            title="Manage franchises"
            desc="Review profiles, status, and KYC docs"
            icon={Ic.storefront}
            tint="blue"
          />
          <ActionCard
            href="/dashboard/catalog"
            title="Catalog mappings"
            desc="Approve and price franchise catalog rows"
            icon={Ic.catalog}
            tint="emerald"
          />
          <ActionCard
            href="/dashboard/procurement"
            title="Procurement"
            desc="Stock requests and confirmations"
            icon={Ic.package}
            tint="amber"
          />
          <ActionCard
            href="/dashboard/orders"
            title="Orders"
            desc="Track sub-orders routed to franchises"
            icon={Ic.cart}
            tint="sky"
          />
          <ActionCard
            href="/dashboard/inventory"
            title="Inventory"
            desc="Stock levels per franchise node"
            icon={Ic.package}
            tint="orange"
          />
          <ActionCard
            href="/dashboard/settlements"
            title="Settlements"
            desc="Cycle approvals and payout marks"
            icon={Ic.banknote}
            tint="emerald"
          />
          <ActionCard
            href="/dashboard/commission"
            title="Commission"
            desc="Per-order margin records"
            icon={Ic.percent}
            tint="blue"
          />
        </div>
      </section>

      {/* ── Footer hint ──────────────────────────────────────── */}
      <footer style={footer}>
        Need a deeper view? Use the sidebar to access every franchise workflow.
        Every KPI on this page reflects live data — refresh to see the latest.
      </footer>
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────

function Stat({
  label,
  value,
  icon,
  tint,
  loading,
  hint,
  actionable,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tint: Tint;
  loading?: boolean;
  hint?: string;
  actionable?: boolean;
}) {
  const t = TINTS[tint];
  return (
    <div
      style={{
        ...statCard,
        boxShadow: actionable
          ? `0 0 0 3px ${t.ring}, 0 1px 2px rgba(15,23,42,0.04)`
          : '0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      <div style={statRow}>
        <span style={{ ...statBadge, background: t.bg, color: t.fg }}>{icon}</span>
        <span style={statLabel}>{label}</span>
      </div>
      <div style={statValue}>
        {loading ? <Skeleton width={48} height={28} /> : value}
      </div>
      {hint && <div style={statHint}>{hint}</div>}
    </div>
  );
}

function ActionCard({
  href,
  title,
  desc,
  icon,
  tint,
}: {
  href: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
  tint: Tint;
}) {
  const [hover, setHover] = useState(false);
  const t = TINTS[tint];
  return (
    <Link
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...actionCard,
        borderColor: hover ? '#cbd5e1' : '#e5e7eb',
        boxShadow: hover
          ? '0 8px 24px rgba(15,23,42,0.06)'
          : '0 1px 2px rgba(15,23,42,0.04)',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <span style={{ ...actionIcon, background: t.bg, color: t.fg }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={actionTitle}>{title}</div>
        <div style={actionDesc}>{desc}</div>
      </div>
      <span style={{ color: hover ? '#475569' : '#cbd5e1', transition: 'color 0.15s' }}>
        {Ic.chevron}
      </span>
    </Link>
  );
}

function Skeleton({ width, height }: { width: number; height: number }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius: 6,
        background: '#e2e8f0',
        opacity: 0.6,
      }}
    />
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  padding: '32px 36px',
  maxWidth: 1280,
  margin: '0 auto',
};

const headerWrap: React.CSSProperties = {
  marginBottom: 24,
};

const eyebrow: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 6,
};

const h1: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  margin: 0,
  color: '#0f172a',
  letterSpacing: '-0.02em',
};

const sub: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 14,
  color: '#64748b',
};

const emptyBanner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '14px 16px',
  background: '#f0f9ff',
  border: '1px solid #bae6fd',
  borderRadius: 12,
  marginBottom: 20,
};

const emptyIcon: React.CSSProperties = {
  color: '#0369a1',
  marginTop: 2,
  flexShrink: 0,
};

const emptyLink: React.CSSProperties = {
  color: '#0369a1',
  fontWeight: 600,
  textDecoration: 'underline',
};

const statGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 14,
};

const statCard: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: '16px 18px 18px',
};

const statRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  marginBottom: 12,
};

const statBadge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 10,
  flexShrink: 0,
};

const statLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const statValue: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 700,
  color: '#0f172a',
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.02em',
};

const statHint: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: '#94a3b8',
};

const sectionHead: React.CSSProperties = {
  marginBottom: 12,
};

const h2: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  color: '#0f172a',
  letterSpacing: '-0.01em',
};

const sectionSub: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 13,
  color: '#64748b',
};

const actionGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
};

const actionCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '16px 18px',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  textDecoration: 'none',
  color: '#0f172a',
  transition: 'all 0.15s ease',
};

const actionIcon: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: 10,
  flexShrink: 0,
};

const actionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#0f172a',
  marginBottom: 2,
};

const actionDesc: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  lineHeight: 1.5,
};

const footer: React.CSSProperties = {
  marginTop: 36,
  paddingTop: 20,
  borderTop: '1px solid #e5e7eb',
  fontSize: 12,
  color: '#94a3b8',
  textAlign: 'center',
};
