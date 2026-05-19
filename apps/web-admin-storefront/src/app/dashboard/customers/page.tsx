'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  location: string | null;
  orderCount: number;
  amountSpent: number;
}

interface CustomersResponse {
  customers: Customer[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

type FilterKey = 'all' | 'verified' | 'unverified' | 'buyers';

const NEW_CUSTOMER_DAYS = 7;

/* ── Formatting helpers ─────────────────────────────────────── */

const inr = (n: number) =>
  `₹${Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (isNaN(diffMs) || diffMs < 0) return '';
  const s = diffMs / 1000;
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

function isNewCustomer(iso: string): boolean {
  const diffDays = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return !isNaN(diffDays) && diffDays <= NEW_CUSTOMER_DAYS;
}

/* ── Page ────────────────────────────────────────────────────── */

export default function CustomersPage() {
  const router = useRouter();
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  // Phase 4 / M59 — visible error state instead of silent catch.
  // Same pattern as the orders page (C14).
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchCustomers = useCallback(
    (p: number) => {
      setLoading(true);
      setFetchError(null);
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (search.trim()) params.set('search', search.trim());

      apiClient<CustomersResponse>(`/admin/customers?${params}`)
        .then((res) => {
          if (res.data) setData(res.data);
        })
        .catch((err) => {
          setFetchError(
            err?.message ||
              'Could not load customers. The API may be down — retry, or check the API logs.',
          );
        })
        .finally(() => setLoading(false));
    },
    [search],
  );

  useEffect(() => {
    fetchCustomers(page);
  }, [page, fetchCustomers]);

  const handleSearch = () => {
    setPage(1);
    fetchCustomers(1);
  };

  const filterCounts = useMemo(() => {
    const list = data?.customers ?? [];
    return {
      all: list.length,
      verified: list.filter((c) => c.emailVerified).length,
      unverified: list.filter((c) => !c.emailVerified).length,
      buyers: list.filter((c) => c.orderCount > 0).length,
    };
  }, [data]);

  const visible = useMemo(() => {
    const list = data?.customers ?? [];
    switch (filter) {
      case 'verified':
        return list.filter((c) => c.emailVerified);
      case 'unverified':
        return list.filter((c) => !c.emailVerified);
      case 'buyers':
        return list.filter((c) => c.orderCount > 0);
      default:
        return list;
    }
  }, [data, filter]);

  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div style={styles.page}>
      {/* ── Page header ─────────────────────────────────────── */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Customers</h1>
          <p style={styles.headerSub}>
            Shoppers who have created an account on your storefront.
          </p>
        </div>
      </header>

      {/* ── Toolbar: tabs + search ──────────────────────────── */}
      <div style={styles.toolbar}>
        <div style={styles.tabs} role="tablist" aria-label="Customer filter">
          <Tab
            label="All"
            count={filterCounts.all}
            active={filter === 'all'}
            onSelect={() => setFilter('all')}
          />
          <Tab
            label="Verified"
            count={filterCounts.verified}
            active={filter === 'verified'}
            onSelect={() => setFilter('verified')}
          />
          <Tab
            label="Not verified"
            count={filterCounts.unverified}
            active={filter === 'unverified'}
            onSelect={() => setFilter('unverified')}
          />
          <Tab
            label="With orders"
            count={filterCounts.buyers}
            active={filter === 'buyers'}
            onSelect={() => setFilter('buyers')}
          />
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
            placeholder="Search by name, email, or phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={styles.searchInput}
            aria-label="Search customers"
          />
        </div>
      </div>

      {/* ── States ──────────────────────────────────────────── */}
      {fetchError ? (
        <div
          role="alert"
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 12,
            padding: 24,
            color: '#991b1b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div>
            <strong style={{ display: 'block', marginBottom: 4 }}>
              Couldn&apos;t load customers
            </strong>
            <span style={{ fontSize: 13 }}>{fetchError}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchCustomers(page)}
            style={{
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 6,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <SkeletonTable />
      ) : !data || visible.length === 0 ? (
        <EmptyState search={search} filter={filter} />
      ) : (
        <>
          <div style={styles.card}>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <colgroup>
                  <col style={{ width: '38%' }} />
                  <col style={{ width: '15%' }} />
                  <col />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 36 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Email status</th>
                    <th style={styles.th}>Location</th>
                    <th style={{ ...styles.th, textAlign: 'right' as const }}>
                      Orders
                    </th>
                    <th style={{ ...styles.th, textAlign: 'right' as const }}>
                      Spent
                    </th>
                    <th style={{ ...styles.th, width: 36 }} aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <CustomerRow
                      key={c.id}
                      customer={c}
                      onOpen={() => router.push(`/dashboard/customers/${c.id}`)}
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

function CustomerRow({
  customer: c,
  onOpen,
}: {
  customer: Customer;
  onOpen: () => void;
}) {
  const [hover, setHover] = useState(false);
  const isNew = isNewCustomer(c.createdAt);
  const color = avatarColor(`${c.firstName}${c.lastName}${c.id}`);

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
          <div
            style={{
              ...styles.avatar,
              background: color.bg,
              color: color.fg,
            }}
            aria-hidden="true"
          >
            {initials(c.firstName, c.lastName)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.nameRow}>
              <span style={styles.nameText}>
                {c.firstName} {c.lastName}
              </span>
              {isNew && <span style={styles.newBadge}>New</span>}
            </div>
            <div style={styles.metaRow}>
              <span style={styles.emailText} title={c.email}>
                {c.email}
              </span>
              <span style={styles.metaDivider} aria-hidden="true">
                •
              </span>
              <span style={styles.joinedText}>
                Joined {relativeTime(c.createdAt)}
              </span>
            </div>
          </div>
        </div>
      </td>
      <td style={styles.td}>
        {c.emailVerified ? (
          <span style={{ ...styles.pill, ...styles.pillPositive }}>
            <span style={{ ...styles.pillDot, background: '#16a34a' }} />
            Verified
          </span>
        ) : (
          <span style={{ ...styles.pill, ...styles.pillNeutral }}>
            <span style={{ ...styles.pillDot, background: '#94a3b8' }} />
            Not verified
          </span>
        )}
      </td>
      <td style={{ ...styles.td, color: c.location ? '#0f172a' : '#94a3b8' }}>
        {c.location || '—'}
      </td>
      <td style={{ ...styles.td, textAlign: 'right' as const }}>
        {c.orderCount === 0 ? (
          <span style={{ color: '#94a3b8' }}>—</span>
        ) : (
          <span style={{ color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
            {c.orderCount}
          </span>
        )}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontWeight: 600,
          color: '#0f172a',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {inr(c.amountSpent)}
      </td>
      <td style={{ ...styles.td, padding: 0, textAlign: 'right' }}>
        <svg
          viewBox="0 0 20 20"
          style={{
            ...styles.rowChevron,
            opacity: hover ? 1 : 0,
            color: hover ? '#64748b' : 'transparent',
          }}
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
      </td>
    </tr>
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

/* ── Loading skeleton ───────────────────────────────────────── */

function SkeletonTable() {
  return (
    <div style={styles.card}>
      <div style={styles.tableScroll}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Customer</th>
              <th style={styles.th}>Email status</th>
              <th style={styles.th}>Location</th>
              <th style={{ ...styles.th, textAlign: 'right' as const }}>
                Orders
              </th>
              <th style={{ ...styles.th, textAlign: 'right' as const }}>
                Spent
              </th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} style={styles.tr}>
                <td style={styles.td}>
                  <div style={styles.nameCell}>
                    <div style={{ ...styles.avatar, ...styles.shimmer }} />
                    <div>
                      <div style={{ ...styles.skelLine, width: 160 }} />
                      <div
                        style={{ ...styles.skelLine, width: 220, marginTop: 6 }}
                      />
                    </div>
                  </div>
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 96, height: 22 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 160 }} />
                </td>
                <td style={{ ...styles.td, textAlign: 'right' as const }}>
                  <div
                    style={{ ...styles.skelLine, width: 36, marginLeft: 'auto' }}
                  />
                </td>
                <td style={{ ...styles.td, textAlign: 'right' as const }}>
                  <div
                    style={{ ...styles.skelLine, width: 80, marginLeft: 'auto' }}
                  />
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
    title = 'No customers match your search';
    body = 'Try a different name, email, or phone number.';
  } else if (filter !== 'all') {
    title = 'No customers match this filter';
    body = 'Switch to "All" to see every customer.';
  } else {
    title = 'No customers yet';
    body =
      'Customers will appear here once someone creates an account on your storefront.';
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
          d="M24 26a7 7 0 100-14 7 7 0 000 14zM10 40c1.4-6.6 7.3-11 14-11s12.6 4.4 14 11"
        />
      </svg>
      <h3 style={styles.emptyTitle}>{title}</h3>
      <p style={styles.emptyBody}>{body}</p>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const shimmerKeyframes = `
@keyframes customers-shimmer {
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

  /* Header */
  header: {
    marginBottom: 20,
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

  /* Toolbar */
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
    border: '1px solid #e2e8f0',
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
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.12s, box-shadow 0.12s',
  },

  /* Table */
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

  /* Customer cell */
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
  nameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  nameText: {
    fontWeight: 600,
    color: '#0f172a',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  newBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1px 7px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#00604a',
    background: 'rgba(0, 128, 96, 0.10)',
    border: '1px solid rgba(0, 128, 96, 0.2)',
    borderRadius: 4,
    flexShrink: 0,
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
    minWidth: 0,
  },
  emailText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  metaDivider: {
    color: '#cbd5e1',
    flexShrink: 0,
  },
  joinedText: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
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
  pillPositive: {
    background: 'rgba(22, 163, 74, 0.08)',
    color: '#15803d',
    borderColor: 'rgba(22, 163, 74, 0.2)',
  },
  pillNeutral: {
    background: '#f1f5f9',
    color: '#475569',
    borderColor: '#e2e8f0',
  },

  /* Row chevron */
  rowChevron: {
    width: 16,
    height: 16,
    display: 'inline-block',
    marginRight: 12,
    transition: 'opacity 0.12s, color 0.12s',
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
    border: '1px solid #e2e8f0',
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
    border: '1px solid #e2e8f0',
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
    animation: 'customers-shimmer 1.2s ease-in-out infinite',
  },
  shimmer: {
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'customers-shimmer 1.2s ease-in-out infinite',
  },
};
