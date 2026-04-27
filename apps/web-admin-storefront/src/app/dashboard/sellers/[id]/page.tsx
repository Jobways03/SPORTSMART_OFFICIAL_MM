'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

/* ── Types ──────────────────────────────────────────────────── */

interface Seller {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string | null;
  sellerContactCountryCode: string | null;
  sellerContactNumber: string | null;
  storeAddress: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  sellerZipCode: string | null;
  shortStoreDescription: string | null;
  sellerProfileImageUrl: string | null;
  sellerShopLogoUrl: string | null;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface CommissionRecord {
  id: string;
  orderItemId: string;
  orderNumber: string;
  sellerName: string;
  productTitle: string;
  unitPrice: number | string;
  quantity: number;
  totalPrice: number | string;
  commissionType: string;
  commissionRate: string;
  unitCommission: number | string;
  totalCommission: number | string;
  adminEarning: number | string;
  productEarning: number | string;
  refundedAdminEarning: number | string;
  createdAt: string;
}

interface CommissionResponse {
  records: CommissionRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/* ── Formatting ─────────────────────────────────────────────── */

const toNum = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const inr = (v: number | string | null | undefined) =>
  `₹${toNum(v).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const inrCompact = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(toNum(v));

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const fmtDateTime = (d: string) =>
  `${fmtDate(d)} at ${new Date(d).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })}`;

const initials = (str: string) =>
  str
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase() || '?';

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

function sellerStatusPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'ACTIVE':
      return { label: 'Active', tone: 'success' };
    case 'PENDING_APPROVAL':
      return { label: 'Pending approval', tone: 'warning' };
    case 'SUSPENDED':
      return { label: 'Suspended', tone: 'danger' };
    case 'DEACTIVATED':
      return { label: 'Deactivated', tone: 'neutral' };
    default:
      return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

function verificationPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'APPROVED':
    case 'VERIFIED':
      return { label: 'Verified', tone: 'success' };
    case 'PENDING':
    case 'IN_REVIEW':
      return { label: 'In review', tone: 'warning' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'danger' };
    case 'NOT_VERIFIED':
    default:
      return { label: 'Not verified', tone: 'neutral' };
  }
}

/* ── Page ───────────────────────────────────────────────────── */

export default function SellerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [commission, setCommission] = useState<CommissionResponse | null>(null);
  const [loadingSeller, setLoadingSeller] = useState(true);
  const [loadingCommission, setLoadingCommission] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    apiClient<Seller>(`/admin/sellers/${id}`)
      .then((res) => {
        if (res.data) setSeller(res.data);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoadingSeller(false));

    apiClient<CommissionResponse>(
      `/admin/commission?sellerId=${encodeURIComponent(id)}&limit=100`,
    )
      .then((res) => {
        if (res.data) setCommission(res.data);
      })
      .catch(() => {})
      .finally(() => setLoadingCommission(false));
  }, [id]);

  const stats = useMemo(() => {
    const records = commission?.records ?? [];
    const uniqueOrders = new Set(records.map((r) => r.orderNumber));
    return {
      orderCount: uniqueOrders.size,
      itemsSold: records.reduce((a, r) => a + (r.quantity || 0), 0),
      revenue: records.reduce((a, r) => a + toNum(r.totalPrice), 0),
      sellerEarning: records.reduce((a, r) => a + toNum(r.productEarning), 0),
      platformMargin: records.reduce((a, r) => a + toNum(r.adminEarning), 0),
    };
  }, [commission]);

  if (loadingSeller) {
    return <LoadingState />;
  }

  if (notFound || !seller) {
    return (
      <div style={styles.notFound}>
        <h3 style={styles.notFoundTitle}>Seller not found</h3>
        <p style={styles.notFoundBody}>
          This seller may have been removed or the link is invalid.
        </p>
        <Link href="/dashboard/sellers" style={styles.notFoundLink}>
          ← Back to Sellers
        </Link>
      </div>
    );
  }

  const color = avatarColor(`${seller.sellerName}${seller.sellerId}`);
  const status = sellerStatusPill(seller.status);
  const verify = verificationPill(seller.verificationStatus);
  const locationBits = [seller.city, seller.state, seller.country].filter(
    Boolean,
  );

  return (
    <div style={styles.page}>
      {/* ── Breadcrumb ─────────────────────────────────────── */}
      <div style={styles.breadcrumb}>
        <Link href="/dashboard/sellers" style={styles.breadcrumbLink}>
          Sellers
        </Link>
        <span style={styles.breadcrumbSep} aria-hidden="true">
          /
        </span>
        <span style={styles.breadcrumbCurrent}>{seller.sellerName}</span>
      </div>

      {/* ── Identity header ────────────────────────────────── */}
      <header style={styles.identityRow}>
        {seller.sellerProfileImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={seller.sellerProfileImageUrl}
            alt=""
            style={styles.identityAvatarImg}
          />
        ) : (
          <div
            style={{
              ...styles.identityAvatar,
              background: color.bg,
              color: color.fg,
            }}
            aria-hidden="true"
          >
            {initials(seller.sellerName)}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={styles.identityTitleRow}>
            <h1 style={styles.h1}>{seller.sellerName}</h1>
            <Pill label={status.label} tone={status.tone} />
            <Pill label={verify.label} tone={verify.tone} />
          </div>
          <div style={styles.identityMeta}>
            <span style={styles.identityShop}>{seller.sellerShopName}</span>
            <span style={styles.metaDot} aria-hidden="true">
              •
            </span>
            <span>{seller.email}</span>
            {seller.phoneNumber && (
              <>
                <span style={styles.metaDot} aria-hidden="true">
                  •
                </span>
                <span>{seller.phoneNumber}</span>
              </>
            )}
            {locationBits.length > 0 && (
              <>
                <span style={styles.metaDot} aria-hidden="true">
                  •
                </span>
                <span>{locationBits.join(', ')}</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Stats ──────────────────────────────────────────── */}
      <div style={styles.statsRow}>
        <StatCard
          label="Orders"
          value={loadingCommission ? '—' : String(stats.orderCount)}
        />
        <StatCard
          label="Items sold"
          value={loadingCommission ? '—' : String(stats.itemsSold)}
        />
        <StatCard
          label="Revenue"
          value={loadingCommission ? '—' : inrCompact(stats.revenue)}
          emphasis
        />
        <StatCard
          label="Seller earnings"
          value={loadingCommission ? '—' : inrCompact(stats.sellerEarning)}
          emphasis
        />
        <StatCard
          label="Platform margin"
          value={loadingCommission ? '—' : inrCompact(stats.platformMargin)}
        />
      </div>

      {/* ── Commission / orders table ──────────────────────── */}
      <Section
        title="Orders & commission"
        subtitle={
          loadingCommission
            ? 'Loading…'
            : commission && commission.records.length > 0
              ? `Showing ${commission.records.length} line item${
                  commission.records.length === 1 ? '' : 's'
                } across ${stats.orderCount} order${
                  stats.orderCount === 1 ? '' : 's'
                }`
              : undefined
        }
        action={
          <Link
            href={`/dashboard/commission`}
            style={styles.sectionAction}
          >
            All commission →
          </Link>
        }
      >
        {loadingCommission ? (
          <TableSkeleton />
        ) : !commission || commission.records.length === 0 ? (
          <EmptyTable />
        ) : (
          <div style={styles.tableScroll}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Order</th>
                  <th style={styles.th}>Product</th>
                  <th style={{ ...styles.th, textAlign: 'right' as const }}>
                    Qty
                  </th>
                  <th style={{ ...styles.th, textAlign: 'right' as const }}>
                    Unit price
                  </th>
                  <th style={{ ...styles.th, textAlign: 'right' as const }}>
                    Revenue
                  </th>
                  <th style={{ ...styles.th, textAlign: 'right' as const }}>
                    Rate
                  </th>
                  <th style={{ ...styles.th, textAlign: 'right' as const }}>
                    Seller earns
                  </th>
                  <th style={{ ...styles.th, textAlign: 'right' as const }}>
                    Platform
                  </th>
                  <th style={styles.th}>Date</th>
                </tr>
              </thead>
              <tbody>
                {commission.records.map((r) => (
                  <CommissionRow key={r.id} record={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/* ── Row ────────────────────────────────────────────────────── */

function CommissionRow({ record: r }: { record: CommissionRecord }) {
  const [hover, setHover] = useState(false);
  return (
    <tr
      style={{
        ...styles.tr,
        background: hover ? '#f8fafc' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td style={styles.td}>
        <Link
          href={`/dashboard/orders?search=${encodeURIComponent(r.orderNumber)}`}
          style={styles.orderLink}
        >
          #{r.orderNumber}
        </Link>
      </td>
      <td style={{ ...styles.td, minWidth: 220 }}>
        <span style={styles.productTitle} title={r.productTitle}>
          {r.productTitle}
        </span>
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontVariantNumeric: 'tabular-nums',
          color: '#475569',
        }}
      >
        {r.quantity}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          color: '#475569',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {inr(r.unitPrice)}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {inr(r.totalPrice)}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          color: '#475569',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {r.commissionRate}%
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          color: '#15803d',
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {inr(r.productEarning)}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          color: '#475569',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {inr(r.adminEarning)}
      </td>
      <td style={{ ...styles.td, color: '#64748b', whiteSpace: 'nowrap' }}>
        {fmtDate(r.createdAt)}
      </td>
    </tr>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

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

function StatCard({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div
        style={{
          ...styles.statValue,
          ...(emphasis ? styles.statValueXL : {}),
        }}
      >
        {value}
      </div>
    </div>
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

function TableSkeleton() {
  return (
    <div style={styles.tableScroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Order</th>
            <th style={styles.th}>Product</th>
            <th style={{ ...styles.th, textAlign: 'right' as const }}>Qty</th>
            <th style={{ ...styles.th, textAlign: 'right' as const }}>
              Unit price
            </th>
            <th style={{ ...styles.th, textAlign: 'right' as const }}>
              Revenue
            </th>
            <th style={{ ...styles.th, textAlign: 'right' as const }}>Rate</th>
            <th style={{ ...styles.th, textAlign: 'right' as const }}>
              Seller earns
            </th>
            <th style={{ ...styles.th, textAlign: 'right' as const }}>
              Platform
            </th>
            <th style={styles.th}>Date</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 4 }).map((_, i) => (
            <tr key={i} style={styles.tr}>
              {Array.from({ length: 9 }).map((__, j) => (
                <td key={j} style={styles.td}>
                  <div
                    style={{
                      ...styles.skel,
                      width: j === 1 ? 220 : 60,
                      height: 12,
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <style>{skelKeyframes}</style>
    </div>
  );
}

function EmptyTable() {
  return (
    <div style={styles.empty}>
      <svg viewBox="0 0 48 48" style={styles.emptyIcon} aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 12h32v28a2 2 0 01-2 2H10a2 2 0 01-2-2V12zM8 12l4-6h24l4 6M18 22h12"
        />
      </svg>
      <h3 style={styles.emptyTitle}>No orders yet</h3>
      <p style={styles.emptyBody}>
        Orders and commission records will appear here as customers buy from
        this seller.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={styles.loading}>
      <div style={styles.spinner} aria-hidden="true" />
      <div style={styles.loadingText}>Loading seller…</div>
      <style>{spinKeyframes}</style>
    </div>
  );
}

/* ── Tones ──────────────────────────────────────────────────── */

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

/* ── Styles ─────────────────────────────────────────────────── */

const spinKeyframes = `
@keyframes seller-spin {
  to { transform: rotate(360deg); }
}
`;

const skelKeyframes = `
@keyframes seller-shimmer {
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

  /* Breadcrumb */
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  breadcrumbLink: {
    color: '#64748b',
    textDecoration: 'none',
    fontWeight: 500,
  },
  breadcrumbSep: { color: '#cbd5e1' },
  breadcrumbCurrent: { color: '#0f172a', fontWeight: 500 },

  /* Identity */
  identityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  identityAvatar: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    fontSize: 18,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  identityAvatarImg: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
  },
  identityTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    color: '#0f172a',
  },
  identityMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  identityShop: {
    color: '#0f172a',
    fontWeight: 500,
  },
  metaDot: { color: '#cbd5e1' },

  /* Stats */
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: '16px 18px',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 6,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.01em',
    fontVariantNumeric: 'tabular-nums',
  },
  statValueXL: {
    fontSize: 22,
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

  /* Card / Table */
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
    fontSize: 13,
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

  orderLink: {
    color: '#0f172a',
    fontWeight: 600,
    textDecoration: 'none',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  productTitle: {
    display: 'inline-block',
    maxWidth: 320,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
  },

  /* Pill */
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

  /* Empty / Loading */
  empty: {
    padding: '56px 24px',
    textAlign: 'center',
  },
  emptyIcon: {
    width: 40,
    height: 40,
    color: '#94a3b8',
    marginBottom: 12,
  },
  emptyTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
  },
  emptyBody: {
    margin: '6px auto 0',
    fontSize: 13,
    color: '#64748b',
    maxWidth: 360,
  },

  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '80px 20px',
  },
  spinner: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderTopColor: '#0f172a',
    borderRadius: '50%',
    animation: 'seller-spin 0.8s linear infinite',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
  },

  skel: {
    display: 'inline-block',
    borderRadius: 4,
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'seller-shimmer 1.2s ease-in-out infinite',
  },

  /* Not found */
  notFound: {
    maxWidth: 420,
    margin: '60px auto 0',
    textAlign: 'center',
    padding: '40px 24px',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 12,
  },
  notFoundTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#0f172a',
  },
  notFoundBody: {
    margin: '6px 0 20px',
    fontSize: 13,
    color: '#64748b',
  },
  notFoundLink: {
    fontSize: 13,
    fontWeight: 500,
    color: '#00805f',
    textDecoration: 'none',
  },
};
