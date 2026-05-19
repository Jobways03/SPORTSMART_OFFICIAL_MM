'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { franchiseProfileService, FranchiseProfile } from '@/services/profile.service';
import { franchiseEarningsService } from '@/services/earnings.service';
import { franchiseInventoryService } from '@/services/inventory.service';
import { franchiseOrdersService } from '@/services/orders.service';
import { franchiseProcurementService } from '@/services/procurement.service';

interface FranchiseSessionInfo {
  franchiseId: string;
  franchiseCode: string;
  ownerName: string;
  businessName: string;
  email: string;
  phoneNumber: string;
  status?: string;
}

type DashboardStats = {
  inventorySkus: number | null;
  openOrders: number | null;
  activeProcurement: number | null;
  totalEarnings: number | null;
};

const EMPTY_STATS: DashboardStats = {
  inventorySkus: null,
  openOrders: null,
  activeProcurement: null,
  totalEarnings: null,
};

function formatINR(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// ── Status palette ─────────────────────────────────────────────────
const STATUS_STYLE: Record<string, { bg: string; fg: string; ring: string }> = {
  ACTIVE: { bg: '#dcfce7', fg: '#166534', ring: '#bbf7d0' },
  PENDING: { bg: '#fef3c7', fg: '#92400e', ring: '#fde68a' },
  SUSPENDED: { bg: '#fee2e2', fg: '#991b1b', ring: '#fecaca' },
  INACTIVE: { bg: '#f1f5f9', fg: '#475569', ring: '#e2e8f0' },
};

function statusStyleFor(status?: string) {
  if (!status) return STATUS_STYLE.INACTIVE;
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return STATUS_STYLE.ACTIVE;
  if (s.includes('PENDING')) return STATUS_STYLE.PENDING;
  if (s === 'SUSPENDED') return STATUS_STYLE.SUSPENDED;
  return STATUS_STYLE.INACTIVE;
}

function formatStatus(status?: string): string {
  if (!status) return 'Unknown';
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Tint palette ───────────────────────────────────────────────────
type Tint = 'blue' | 'emerald' | 'amber' | 'violet' | 'sky' | 'rose';
const TINTS: Record<Tint, { bg: string; fg: string }> = {
  blue:    { bg: '#eff6ff', fg: '#1d4ed8' },
  emerald: { bg: '#ecfdf5', fg: '#047857' },
  amber:   { bg: '#fffbeb', fg: '#b45309' },
  violet:  { bg: '#f5f3ff', fg: '#6d28d9' },
  sky:     { bg: '#f0f9ff', fg: '#0369a1' },
  rose:    { bg: '#fff1f2', fg: '#be123c' },
};

// ── Inline SVG icons (no dep) ──────────────────────────────────────
const Ic = {
  package: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  ),
  truck: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
      <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  ),
  wallet: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  catalog: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  ),
  pos: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
    </svg>
  ),
  staff: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  ),
};

export default function DashboardHomePage() {
  const [franchise, setFranchise] = useState<FranchiseSessionInfo | null>(null);
  const [profile, setProfile] = useState<FranchiseProfile | null>(null);
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);

  useEffect(() => {
    try {
      const data = sessionStorage.getItem('franchise');
      if (data) setFranchise(JSON.parse(data));
    } catch {
      // handled by layout
    }

    franchiseProfileService
      .getProfile()
      .then((res) => {
        if (res.data) setProfile(res.data);
      })
      .catch(() => {});

    const settle = <T,>(p: Promise<T>) => p.catch(() => null as T | null);
    (async () => {
      const [inv, orders, proc, earn] = await Promise.all([
        settle(franchiseInventoryService.listStock({ page: 1, limit: 1 })),
        settle(franchiseOrdersService.list({ page: 1, limit: 1, acceptStatus: 'OPEN' })),
        settle(franchiseProcurementService.list({ page: 1, limit: 1, status: 'SUBMITTED' })),
        settle(franchiseEarningsService.getSummary()),
      ]);

      setStats({
        inventorySkus: (inv?.data as any)?.total ?? null,
        openOrders: (orders?.data as any)?.pagination?.total ?? null,
        activeProcurement: (proc?.data as any)?.pagination?.total ?? null,
        totalEarnings: (earn?.data as any)?.totalEarnings ?? null,
      });
    })();
  }, []);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

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

  if (!franchise) return null;

  const displayStatus = profile?.status ?? franchise.status;
  const completionPct = profile?.profileCompletionPercentage ?? 0;
  const ownerFirst = franchise.ownerName.split(' ')[0] || franchise.ownerName;
  const sty = statusStyleFor(displayStatus);
  const isPending = (displayStatus || '').toUpperCase().includes('PENDING');

  return (
    <div style={page}>
      {/* ── Header ───────────────────────────────────────────── */}
      <header style={{ marginBottom: 22 }}>
        <div style={eyebrow}>{today}</div>
        <h1 style={h1}>
          {greeting}, {ownerFirst}.
        </h1>
        <p style={sub}>Here&apos;s the snapshot for <strong>{franchise.businessName}</strong>.</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              padding: '4px 12px',
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              background: sty.bg,
              color: sty.fg,
              border: `1px solid ${sty.ring}`,
            }}
          >
            {formatStatus(displayStatus)}
          </span>
          {franchise.franchiseCode && (
            <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {franchise.franchiseCode}
            </span>
          )}
        </div>
      </header>

      {/* ── PENDING banner ───────────────────────────────────── */}
      {isPending && (
        <div style={pendingBanner}>
          <span style={{ color: '#92400e', marginTop: 2, flexShrink: 0 }}>{Ic.info}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#7c2d12', fontSize: 14 }}>
              Your franchise is awaiting approval
            </div>
            <div style={{ fontSize: 13, color: '#9a3412', marginTop: 4, lineHeight: 1.5 }}>
              Complete your profile and submit it for review. The HQ team
              will verify your details (PAN, GSTIN, address) and activate
              your franchise — usually within 1–2 business days.
            </div>
          </div>
          <Link href="/dashboard/profile" style={pendingCta}>
            Complete profile →
          </Link>
        </div>
      )}

      {/* ── Profile completion ───────────────────────────────── */}
      <section style={progressCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={progressLabel}>Profile completion</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Required to unlock orders, payouts, and POS.
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
            {completionPct}%
          </div>
        </div>
        <div style={progressBarTrack}>
          <div
            style={{
              ...progressBarFill,
              width: `${Math.min(100, completionPct)}%`,
              background:
                completionPct === 100
                  ? '#10b981'
                  : completionPct >= 60
                    ? '#3b82f6'
                    : '#f59e0b',
            }}
          />
        </div>
      </section>

      {/* ── KPI strip ────────────────────────────────────────── */}
      <section style={statGrid}>
        <Stat
          label="Inventory"
          value={stats.inventorySkus ?? '—'}
          icon={Ic.package}
          tint="blue"
          hint="SKUs mapped to your catalog"
        />
        <Stat
          label="Open orders"
          value={stats.openOrders ?? '—'}
          icon={Ic.cart}
          tint="emerald"
          hint="Awaiting your acceptance"
          actionable={(stats.openOrders ?? 0) > 0}
        />
        <Stat
          label="Procurement"
          value={stats.activeProcurement ?? '—'}
          icon={Ic.truck}
          tint="amber"
          hint="Pending requests"
        />
        <Stat
          label="Earnings"
          value={stats.totalEarnings != null ? formatINR(stats.totalEarnings) : '—'}
          icon={Ic.wallet}
          tint="violet"
          hint="Total to date"
        />
      </section>

      {/* ── Quick actions ────────────────────────────────────── */}
      <section style={{ marginTop: 28 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={h2}>Quick actions</h2>
          <p style={sectionSub}>Jump straight to the workflows you use most.</p>
        </div>
        <div style={actionGrid}>
          <ActionCard
            href="/dashboard/profile"
            title="Complete profile"
            desc="Business, address, PAN & GSTIN"
            icon={Ic.user}
            tint="blue"
          />
          <ActionCard
            href="/dashboard/catalog"
            title="Browse catalog"
            desc="Map products HQ approved for you"
            icon={Ic.catalog}
            tint="emerald"
          />
          <ActionCard
            href="/dashboard/inventory"
            title="Manage inventory"
            desc="Stock levels per SKU per warehouse"
            icon={Ic.package}
            tint="amber"
          />
          <ActionCard
            href="/dashboard/orders"
            title="Orders"
            desc="Accept, pack, and dispatch routed orders"
            icon={Ic.cart}
            tint="sky"
          />
          <ActionCard
            href="/dashboard/procurement"
            title="Procurement"
            desc="Request stock from HQ"
            icon={Ic.truck}
            tint="violet"
          />
          <ActionCard
            href="/dashboard/pos"
            title="POS"
            desc="In-store cash + UPI sales"
            icon={Ic.pos}
            tint="rose"
          />
          <ActionCard
            href="/dashboard/staff"
            title="Staff"
            desc="Add cashiers and managers"
            icon={Ic.staff}
            tint="emerald"
          />
          <ActionCard
            href="/dashboard/earnings"
            title="Earnings"
            desc="Settlement history and balance"
            icon={Ic.wallet}
            tint="blue"
          />
        </div>
      </section>

      <footer style={footer}>
        Need help? Reach SportsMart support from{' '}
        <Link href="/dashboard/support" style={{ color: '#1d4ed8', fontWeight: 600 }}>
          the Support page
        </Link>
        . KPIs reflect live data — refresh to see the latest.
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
  hint,
  actionable,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tint: Tint;
  hint?: string;
  actionable?: boolean;
}) {
  const t = TINTS[tint];
  return (
    <div
      style={{
        ...statCard,
        boxShadow: actionable
          ? `0 0 0 3px ${t.bg}, 0 1px 2px rgba(15,23,42,0.04)`
          : '0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ ...statBadge, background: t.bg, color: t.fg }}>{icon}</span>
        <span style={statLabel}>{label}</span>
      </div>
      <div style={statValue}>{value}</div>
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

// ── Styles ───────────────────────────────────────────────────────────

const page: React.CSSProperties = {
  padding: '32px 36px',
  maxWidth: 1280,
  margin: '0 auto',
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

const pendingBanner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  padding: '14px 16px',
  background: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: 12,
  marginBottom: 18,
};

const pendingCta: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 36,
  padding: '0 16px',
  background: '#d97706',
  color: '#fff',
  borderRadius: 9999,
  fontSize: 13,
  fontWeight: 700,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  // The banner uses align-items: flex-start so the info icon stays anchored
  // next to the heading. Without this, the CTA stuck to the top edge as
  // the description wrapped to 2-3 lines, leaving it visually "floating".
  // Center it against the entire flex container so it sits at the
  // banner's vertical midpoint regardless of how the description wraps.
  alignSelf: 'center',
};

const progressCard: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  padding: '18px 20px',
  marginBottom: 18,
};

const progressLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const progressBarTrack: React.CSSProperties = {
  height: 8,
  background: '#f1f5f9',
  borderRadius: 9999,
  overflow: 'hidden',
};

const progressBarFill: React.CSSProperties = {
  height: '100%',
  borderRadius: 9999,
  transition: 'width 0.4s ease, background 0.15s',
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
  fontSize: 30,
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
