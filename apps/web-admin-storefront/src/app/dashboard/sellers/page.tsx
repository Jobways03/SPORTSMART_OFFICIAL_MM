'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Seller {
  sellerId: string;
  sellerName: string;
  sellerShopName: string;
  email: string;
  phoneNumber: string | null;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
  profileImageUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SellersResponse {
  sellers: Seller[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

type FilterKey =
  | 'all'
  | 'active'
  | 'pending'
  | 'suspended'
  | 'deactivated';

type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/* ── Formatting ─────────────────────────────────────────────── */

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

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

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff) || diff < 0) return '';
  const s = diff / 1000;
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)}d ago`;
  const w = d / 7;
  if (w < 5) return `${Math.round(w)}w ago`;
  const mo = d / 30;
  if (mo < 12) return `${Math.round(mo)}mo ago`;
  const y = d / 365;
  return `${Math.round(y)}y ago`;
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

export default function SellersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get('filter') as FilterKey) || 'all';
  const initialSearch = searchParams.get('search') || '';

  const [data, setData] = useState<SellersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<FilterKey>(
    ['all', 'active', 'pending', 'suspended', 'deactivated'].includes(
      initialFilter,
    )
      ? initialFilter
      : 'all',
  );

  const fetchSellers = useCallback(
    (p: number) => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (search.trim()) params.set('search', search.trim());

      apiClient<SellersResponse>(`/admin/sellers?${params}`)
        .then((res) => {
          if (res.data) setData(res.data);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [search],
  );

  useEffect(() => {
    fetchSellers(page);
  }, [page, fetchSellers]);

  const handleSearch = () => {
    setPage(1);
    fetchSellers(1);
  };

  const filterCounts = useMemo(() => {
    const list = data?.sellers ?? [];
    return {
      all: list.length,
      active: list.filter((s) => s.status === 'ACTIVE').length,
      pending: list.filter((s) => s.status === 'PENDING_APPROVAL').length,
      suspended: list.filter((s) => s.status === 'SUSPENDED').length,
      deactivated: list.filter((s) => s.status === 'DEACTIVATED').length,
    };
  }, [data]);

  const visible = useMemo(() => {
    const list = data?.sellers ?? [];
    switch (filter) {
      case 'active':
        return list.filter((s) => s.status === 'ACTIVE');
      case 'pending':
        return list.filter((s) => s.status === 'PENDING_APPROVAL');
      case 'suspended':
        return list.filter((s) => s.status === 'SUSPENDED');
      case 'deactivated':
        return list.filter((s) => s.status === 'DEACTIVATED');
      default:
        return list;
    }
  }, [data, filter]);

  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div style={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Sellers</h1>
          <p style={styles.headerSub}>
            Marketplace sellers and their shop accounts.
          </p>
        </div>
      </header>

      {/* ── Toolbar ────────────────────────────────────────── */}
      <div style={styles.toolbar}>
        <div style={styles.tabs} role="tablist" aria-label="Seller filter">
          <Tab
            label="All"
            count={filterCounts.all}
            active={filter === 'all'}
            onSelect={() => setFilter('all')}
          />
          <Tab
            label="Active"
            count={filterCounts.active}
            active={filter === 'active'}
            onSelect={() => setFilter('active')}
          />
          <Tab
            label="Pending"
            count={filterCounts.pending}
            active={filter === 'pending'}
            onSelect={() => setFilter('pending')}
          />
          <Tab
            label="Suspended"
            count={filterCounts.suspended}
            active={filter === 'suspended'}
            onSelect={() => setFilter('suspended')}
          />
          {filterCounts.deactivated > 0 && (
            <Tab
              label="Deactivated"
              count={filterCounts.deactivated}
              active={filter === 'deactivated'}
              onSelect={() => setFilter('deactivated')}
            />
          )}
        </div>

        <div style={styles.searchWrap}>
          <svg style={styles.searchIcon} viewBox="0 0 20 20" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              d="M9 3a6 6 0 104.472 10.03L17 17M9 15A6 6 0 109 3a6 6 0 000 12z"
            />
          </svg>
          <input
            type="search"
            placeholder="Search by name, shop, email, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={styles.searchInput}
            aria-label="Search sellers"
          />
        </div>
      </div>

      {/* ── States ─────────────────────────────────────────── */}
      {loading && !data ? (
        <SkeletonTable />
      ) : !data || visible.length === 0 ? (
        <EmptyState search={search} filter={filter} />
      ) : (
        <>
          <div style={styles.card}>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Seller</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Verification</th>
                    <th style={styles.th}>Profile</th>
                    <th style={styles.th}>Last login</th>
                    <th style={styles.th}>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <SellerRow
                      key={s.sellerId}
                      seller={s}
                      onOpen={() =>
                        router.push(`/dashboard/sellers/${s.sellerId}`)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={data.pagination.total}
            limit={data.pagination.limit}
            visibleCount={visible.length}
            filtered={filter !== 'all'}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

/* ── Tab ────────────────────────────────────────────────────── */

function Tab({
  label,
  count,
  active,
  onSelect,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...styles.tab,
        ...(active
          ? styles.tabActive
          : hover
            ? styles.tabHover
            : {}),
      }}
    >
      <span>{label}</span>
      <span
        style={{
          ...styles.tabCount,
          ...(active ? styles.tabCountActive : {}),
        }}
      >
        {count}
      </span>
    </button>
  );
}

/* ── Row ────────────────────────────────────────────────────── */

function SellerRow({
  seller: s,
  onOpen,
}: {
  seller: Seller;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const color = avatarColor(`${s.sellerName}${s.sellerId}`);
  const status = sellerStatusPill(s.status);
  const verify = verificationPill(s.verificationStatus);

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
        <div style={styles.nameCell}>
          {s.profileImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.profileImageUrl}
              alt=""
              style={styles.avatarImg}
            />
          ) : (
            <div
              style={{
                ...styles.avatar,
                background: color.bg,
                color: color.fg,
              }}
              aria-hidden="true"
            >
              {initials(s.sellerName)}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={styles.nameText}>{s.sellerName}</div>
            <div style={styles.metaText} title={s.sellerShopName}>
              {s.sellerShopName}
            </div>
          </div>
        </div>
      </td>
      <td style={styles.td}>
        <Pill label={status.label} tone={status.tone} />
      </td>
      <td style={styles.td}>
        <Pill label={verify.label} tone={verify.tone} />
      </td>
      <td style={styles.td}>
        <ProfileBar percent={s.profileCompletionPercentage} />
      </td>
      <td style={{ ...styles.td, color: '#475569' }}>
        {relativeTime(s.lastLoginAt)}
      </td>
      <td style={{ ...styles.td, color: '#475569' }}>
        {fmtDate(s.createdAt)}
      </td>
    </tr>
  );
}

/* ── Profile bar ────────────────────────────────────────────── */

function ProfileBar({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  const color = p >= 90 ? '#16a34a' : p >= 50 ? '#f59e0b' : '#dc2626';
  return (
    <div style={styles.profileBarWrap}>
      <div style={styles.profileBarTrack}>
        <div
          style={{
            ...styles.profileBarFill,
            width: `${p}%`,
            background: color,
          }}
        />
      </div>
      <span
        style={{ ...styles.profileBarLabel, color }}
      >
        {p}%
      </span>
    </div>
  );
}

/* ── Pagination ─────────────────────────────────────────────── */

function Pagination({
  page,
  totalPages,
  total,
  limit,
  visibleCount,
  filtered,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  visibleCount: number;
  filtered: boolean;
  onChange: (p: number) => void;
}) {
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <div style={styles.pagination}>
      <span style={styles.paginationLabel}>
        {filtered ? (
          <>
            Showing <strong>{visibleCount}</strong> filtered of{' '}
            <strong>{total.toLocaleString('en-IN')}</strong>
          </>
        ) : (
          <>
            Showing <strong>{from}</strong>–<strong>{to}</strong> of{' '}
            <strong>{total.toLocaleString('en-IN')}</strong>
          </>
        )}
      </span>
      <div style={styles.paginationControls}>
        <button
          disabled={prevDisabled}
          onClick={() => onChange(page - 1)}
          style={{
            ...styles.pageBtn,
            ...(prevDisabled ? styles.pageBtnDisabled : {}),
          }}
          aria-label="Previous page"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4l-6 6 6 6"
            />
          </svg>
        </button>
        <span style={styles.pageIndicator}>
          Page {page} of {totalPages}
        </span>
        <button
          disabled={nextDisabled}
          onClick={() => onChange(page + 1)}
          style={{
            ...styles.pageBtn,
            ...(nextDisabled ? styles.pageBtnDisabled : {}),
          }}
          aria-label="Next page"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 4l6 6-6 6"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ── Pill ───────────────────────────────────────────────────── */

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

/* ── Loading skeleton ───────────────────────────────────────── */

function SkeletonTable() {
  return (
    <div style={styles.card}>
      <div style={styles.tableScroll}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Seller</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Verification</th>
              <th style={styles.th}>Profile</th>
              <th style={styles.th}>Last login</th>
              <th style={styles.th}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} style={styles.tr}>
                <td style={styles.td}>
                  <div style={styles.nameCell}>
                    <div style={{ ...styles.avatar, ...styles.shimmer }} />
                    <div>
                      <div style={{ ...styles.skelLine, width: 140 }} />
                      <div
                        style={{ ...styles.skelLine, width: 180, marginTop: 6 }}
                      />
                    </div>
                  </div>
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 80, height: 22 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 92, height: 22 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 96, height: 10 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 60 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 80 }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style>{shimmerKeyframes}</style>
    </div>
  );
}

/* ── Empty state ────────────────────────────────────────────── */

function EmptyState({
  search,
  filter,
}: {
  search: string;
  filter: FilterKey;
}) {
  let title: string;
  let body: string;
  if (search) {
    title = 'No sellers match your search';
    body = 'Try a different name, shop, email, or phone number.';
  } else if (filter !== 'all') {
    title = 'No sellers match this filter';
    body = 'Switch to "All" to see every seller.';
  } else {
    title = 'No sellers yet';
    body =
      'Sellers will appear here once someone registers and applies to your marketplace.';
  }

  return (
    <div style={styles.empty}>
      <svg viewBox="0 0 48 48" style={styles.emptyIcon} aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 20h24v18a2 2 0 01-2 2H14a2 2 0 01-2-2V20zM8 20l4-8h24l4 8M18 28h12"
        />
      </svg>
      <h3 style={styles.emptyTitle}>{title}</h3>
      <p style={styles.emptyBody}>{body}</p>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const shimmerKeyframes = `
@keyframes sellers-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    color: '#0f172a',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },

  header: { marginBottom: 20 },
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

  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  tabs: {
    display: 'inline-flex',
    gap: 4,
    padding: 4,
    background: '#f1f5f9',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    padding: '0 12px',
    fontSize: 13,
    fontWeight: 500,
    color: '#475569',
    background: 'transparent',
    border: 'none',
    borderRadius: 7,
    cursor: 'pointer',
    transition: 'background-color 0.12s, color 0.12s, box-shadow 0.12s',
    fontFamily: 'inherit',
  },
  tabHover: {
    background: 'rgba(255, 255, 255, 0.6)',
    color: '#0f172a',
  },
  tabActive: {
    background: '#ffffff',
    color: '#0f172a',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
    fontWeight: 600,
  },
  tabCount: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    padding: '0 6px',
    height: 18,
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    background: '#e2e8f0',
    borderRadius: 999,
    fontVariantNumeric: 'tabular-nums',
  },
  tabCountActive: {
    color: '#ffffff',
    background: '#0f172a',
  },

  searchWrap: {
    position: 'relative',
    flex: '1 1 260px',
    maxWidth: 360,
  },
  searchIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 16,
    height: 16,
    color: '#94a3b8',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    height: 38,
    padding: '0 12px 0 36px',
    fontSize: 14,
    color: '#0f172a',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.12s, box-shadow 0.12s',
  },

  card: {
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
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
    cursor: 'pointer',
    outline: 'none',
    transition: 'background-color 0.08s',
  },
  td: {
    padding: '14px 16px',
    verticalAlign: 'middle',
    fontSize: 14,
    color: '#0f172a',
  },

  nameCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    letterSpacing: '0.02em',
  },
  avatarImg: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
  },
  nameText: {
    fontWeight: 600,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  metaText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  profileBarWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 110,
  },
  profileBarTrack: {
    flex: 1,
    height: 6,
    background: '#f1f5f9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  profileBarFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.2s ease',
  },
  profileBarLabel: {
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    minWidth: 36,
    textAlign: 'right',
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

  /* Pagination */
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    padding: '0 4px',
    flexWrap: 'wrap',
    gap: 12,
  },
  paginationLabel: {
    fontSize: 13,
    color: '#475569',
  },
  paginationControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  pageBtn: {
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    background: '#ffffff',
    cursor: 'pointer',
    color: '#334155',
    transition: 'background-color 0.12s, border-color 0.12s, color 0.12s',
  },
  pageBtnDisabled: {
    color: '#cbd5e1',
    cursor: 'not-allowed',
    background: '#f8fafc',
  },
  pageIndicator: {
    padding: '0 10px',
    fontSize: 13,
    color: '#475569',
    fontVariantNumeric: 'tabular-nums',
  },

  /* Empty */
  empty: {
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 10,
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

  /* Shimmer */
  skelLine: {
    display: 'block',
    height: 12,
    borderRadius: 4,
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'sellers-shimmer 1.2s ease-in-out infinite',
  },
  shimmer: {
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'sellers-shimmer 1.2s ease-in-out infinite',
  },
};
