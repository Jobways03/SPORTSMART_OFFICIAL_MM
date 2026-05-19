'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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

type Tab = 'ALL' | 'VERIFIED' | 'UNVERIFIED' | 'BUYERS' | 'NEW';

const NEW_CUSTOMER_DAYS = 7;

// ── Formatting helpers ────────────────────────────────────────────

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

// ── Page ──────────────────────────────────────────────────────────

export default function CustomersPage() {
  const router = useRouter();
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('ALL');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 4 / M59 — visible error state instead of silent catch.
  // Same pattern as the orders page (C14).
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchCustomers = useCallback(
    (p: number, q: string) => {
      setLoading(true);
      setFetchError(null);
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (q.trim()) params.set('search', q.trim());

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
    [],
  );

  // Initial + page-change fetch.
  useEffect(() => {
    fetchCustomers(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Debounced live search — reset to page 1 when the query changes.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      fetchCustomers(1, search);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Counts derived from currently loaded page.
  const counts = useMemo(() => {
    const list = data?.customers ?? [];
    return {
      all: list.length,
      verified: list.filter((c) => c.emailVerified).length,
      unverified: list.filter((c) => !c.emailVerified).length,
      buyers: list.filter((c) => c.orderCount > 0).length,
      newSignups: list.filter((c) => isNewCustomer(c.createdAt)).length,
      totalSpentPage: list.reduce((acc, c) => acc + (c.amountSpent || 0), 0),
    };
  }, [data]);

  const visible = useMemo(() => {
    const list = data?.customers ?? [];
    if (tab === 'VERIFIED')   return list.filter((c) => c.emailVerified);
    if (tab === 'UNVERIFIED') return list.filter((c) => !c.emailVerified);
    if (tab === 'BUYERS')     return list.filter((c) => c.orderCount > 0);
    if (tab === 'NEW')        return list.filter((c) => isNewCustomer(c.createdAt));
    return list;
  }, [data, tab]);

  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#0F1115' }}>
          Customers
        </h1>
        <p style={{ marginTop: 6, fontSize: 13, color: '#525A65', maxWidth: 680, lineHeight: 1.5 }}>
          Shoppers who have created an account on your storefront. Tap a row to see contact, address, and order history.
        </p>
      </div>

      <KpiStrip
        loading={loading && !data}
        total={data?.pagination.total ?? 0}
        pageSize={data?.customers.length ?? 0}
        counts={counts}
      />

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div style={{
        borderBottom: '1px solid #E5E7EB',
        display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 12,
      }}>
        <Tabs current={tab} counts={counts} onChange={setTab} />
      </div>

      {/* ── Search + refresh ──────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <input
            type="search"
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...input, width: '100%', paddingLeft: 36 }}
            aria-label="Search customers"
          />
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: '#7A828F', display: 'inline-flex',
          }}>
            <SearchIcon />
          </span>
        </div>
        <button
          onClick={() => fetchCustomers(page, search)}
          style={btnGhost}
          disabled={loading}
        >
          <RefreshIcon /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* ── Table / states ──────────────────────────────── */}
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
            onClick={() => fetchCustomers(page, search)}
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
        <EmptyState search={search} tab={tab} />
      ) : (
        <>
          <div style={{
            background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <colgroup>
                  <col style={{ width: '36%' }} />
                  <col style={{ width: 140 }} />
                  <col />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 40 }} />
                </colgroup>
                <thead>
                  <tr style={{ background: '#FAFAFA', borderBottom: '1px solid #E5E7EB' }}>
                    <th style={th}>Customer</th>
                    <th style={th}>Email status</th>
                    <th style={th}>Location</th>
                    <th style={{ ...th, textAlign: 'right' }}>Orders</th>
                    <th style={{ ...th, textAlign: 'right' }}>Spent</th>
                    <th style={{ ...th, width: 40 }} aria-hidden="true" />
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
            filtered={tab !== 'ALL'}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({
  loading, total, pageSize, counts,
}: {
  loading: boolean;
  total: number;
  pageSize: number;
  counts: {
    verified: number; unverified: number; buyers: number;
    newSignups: number; totalSpentPage: number;
  };
}) {
  const verifiedPct = pageSize > 0 ? Math.round((counts.verified / pageSize) * 100) : 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 12, marginBottom: 16,
    }}>
      <Kpi label="Total customers"
        value={total.toLocaleString('en-IN')}
        tone="neutral" loading={loading}
        hint="Across all pages of this storefront." />
      <Kpi label="Verified (this page)"
        value={`${counts.verified.toLocaleString('en-IN')}`}
        tone={pageSize > 0 && verifiedPct >= 80 ? 'success' : 'neutral'}
        loading={loading}
        hint={pageSize > 0 ? `${verifiedPct}% of the loaded ${pageSize}` : '—'} />
      <Kpi label="With orders"
        value={counts.buyers.toLocaleString('en-IN')}
        tone={counts.buyers > 0 ? 'success' : 'muted'} loading={loading}
        hint="Loaded customers with at least one order." />
      <Kpi label={`New (≤ ${NEW_CUSTOMER_DAYS}d)`}
        value={counts.newSignups.toLocaleString('en-IN')}
        tone={counts.newSignups > 0 ? 'success' : 'muted'} loading={loading}
        hint="Signed up in the last week." />
      <Kpi label="Spend (this page)"
        value={inr(counts.totalSpentPage)}
        tone="neutral" loading={loading}
        hint="Sum across loaded customers." />
    </div>
  );
}

type KpiTone = 'success' | 'warning' | 'danger' | 'neutral' | 'muted';
const KPI_TONE: Record<KpiTone, string> = {
  success: '#15803d', warning: '#b45309', danger: '#b91c1c',
  neutral: '#0F1115', muted: '#525A65',
};
function Kpi({
  label, value, tone, hint, loading,
}: {
  label: string; value: string; tone: KpiTone; hint?: string; loading?: boolean;
}) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
    }}>
      <div style={kpiLabel}>{label}</div>
      {loading ? (
        <div style={{ height: 28, width: '60%', background: '#F3F4F6', borderRadius: 6 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 22, fontWeight: 700, color: KPI_TONE[tone],
            fontVariantNumeric: 'tabular-nums',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {value}
          </span>
          {(tone === 'warning' || tone === 'danger' || tone === 'success') && (
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: KPI_TONE[tone] }} />
          )}
        </div>
      )}
      {hint && <div style={{ fontSize: 12, color: '#525A65', lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────

function Tabs({
  current, counts, onChange,
}: {
  current: Tab;
  counts: {
    all: number; verified: number; unverified: number; buyers: number; newSignups: number;
  };
  onChange: (t: Tab) => void;
}) {
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'ALL',        label: 'All',          count: counts.all },
    { key: 'VERIFIED',   label: 'Verified',     count: counts.verified },
    { key: 'UNVERIFIED', label: 'Not verified', count: counts.unverified },
    { key: 'BUYERS',     label: 'With orders',  count: counts.buyers },
    { key: 'NEW',        label: 'New',          count: counts.newSignups },
  ];
  return (
    <>
      {tabs.map((t) => {
        const active = current === t.key;
        return (
          <button
            key={t.key} type="button" onClick={() => onChange(t.key)}
            style={active ? tabActive : tabIdle}
          >
            {t.label}
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 600,
              padding: '1px 7px', borderRadius: 9999,
              background: active ? '#0F1115' : '#F3F4F6',
              color: active ? '#fff' : '#525A65',
              fontVariantNumeric: 'tabular-nums',
            }}>{t.count}</span>
          </button>
        );
      })}
    </>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function CustomerRow({
  customer: c, onOpen,
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
        borderTop: '1px solid #F3F4F6',
        cursor: 'pointer',
        outline: 'none',
        background: hover ? '#FAFAFA' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td style={td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 36, height: 36, borderRadius: '50%',
              fontSize: 12, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, letterSpacing: '0.02em',
              background: color.bg, color: color.fg,
            }}
            aria-hidden="true"
          >
            {initials(c.firstName, c.lastName)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{
                fontWeight: 600, color: '#0F1115',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {c.firstName} {c.lastName}
              </span>
              {isNew && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center',
                  height: 18, padding: '0 7px', borderRadius: 9999,
                  background: '#dcfce7', color: '#15803d',
                  fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  flexShrink: 0,
                }}>New</span>
              )}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 2, fontSize: 12, color: '#525A65', minWidth: 0,
            }}>
              <span title={c.email} style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
              }}>{c.email}</span>
              <span aria-hidden="true" style={{ color: '#CBD5E1', flexShrink: 0 }}>•</span>
              <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                Joined {relativeTime(c.createdAt)}
              </span>
            </div>
          </div>
        </div>
      </td>
      <td style={td}>
        {c.emailVerified ? (
          <span style={pillSuccess}>
            <span style={{ width: 6, height: 6, borderRadius: 9999, background: '#15803d' }} />
            Verified
          </span>
        ) : (
          <span style={pillMuted}>
            <span style={{ width: 6, height: 6, borderRadius: 9999, background: '#94A3B8' }} />
            Not verified
          </span>
        )}
      </td>
      <td style={{ ...td, color: c.location ? '#0F1115' : '#7A828F' }}>
        {c.location || '—'}
      </td>
      <td style={{ ...td, textAlign: 'right' }}>
        {c.orderCount === 0 ? (
          <span style={{ color: '#7A828F' }}>—</span>
        ) : (
          <span style={{ color: '#0F1115', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            {c.orderCount}
          </span>
        )}
      </td>
      <td style={{
        ...td, textAlign: 'right',
        fontWeight: 600, color: '#0F1115', fontVariantNumeric: 'tabular-nums',
      }}>
        {inr(c.amountSpent)}
      </td>
      <td style={{ ...td, padding: '14px 12px 14px 0', textAlign: 'right' }}>
        <ChevronRight
          style={{
            opacity: hover ? 1 : 0.3,
            color: hover ? '#525A65' : '#CBD5E1',
            transition: 'opacity 0.12s, color 0.12s',
          }}
        />
      </td>
    </tr>
  );
}

// ── Pagination ────────────────────────────────────────────────────

function Pagination({
  page, totalPages, total, limit, visibleCount, filtered, onChange,
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
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 12, padding: '0 4px', flexWrap: 'wrap', gap: 12,
    }}>
      <span style={{ fontSize: 12, color: '#525A65' }}>
        {filtered ? (
          <>
            Showing <strong style={{ color: '#0F1115' }}>{visibleCount}</strong> filtered of{' '}
            <strong style={{ color: '#0F1115' }}>{total.toLocaleString('en-IN')}</strong>
          </>
        ) : (
          <>
            Showing <strong style={{ color: '#0F1115' }}>{from}</strong>–
            <strong style={{ color: '#0F1115' }}>{to}</strong> of{' '}
            <strong style={{ color: '#0F1115' }}>{total.toLocaleString('en-IN')}</strong>
          </>
        )}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          disabled={prevDisabled}
          onClick={() => onChange(page - 1)}
          style={prevDisabled ? { ...pageBtn, ...pageBtnDisabled } : pageBtn}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </button>
        <span style={{
          padding: '0 10px', fontSize: 13, color: '#525A65',
          fontVariantNumeric: 'tabular-nums',
        }}>
          Page {page} of {totalPages}
        </span>
        <button
          disabled={nextDisabled}
          onClick={() => onChange(page + 1)}
          style={nextDisabled ? { ...pageBtn, ...pageBtnDisabled } : pageBtn}
          aria-label="Next page"
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}

// ── Empty / skeleton ──────────────────────────────────────────────

function EmptyState({ search, tab }: { search: string; tab: Tab }) {
  let title: string;
  let body: string;
  if (search) {
    title = 'No customers match your search';
    body = 'Try a different name, email, or phone number.';
  } else if (tab !== 'ALL') {
    title = 'No customers match this filter';
    body = 'Switch to "All" to see every customer on this page.';
  } else {
    title = 'No customers yet';
    body = 'Customers will appear here once someone creates an account on your storefront.';
  }
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14,
      padding: 48, textAlign: 'center',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 9999, background: '#F3F4F6',
        margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#7A828F',
      }}>
        <UserIcon size={20} />
      </div>
      <div style={{ fontSize: 14, color: '#0F1115', fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13, color: '#525A65', marginTop: 4, maxWidth: 360, margin: '4px auto 0' }}>
        {body}
      </div>
    </div>
  );
}

function SkeletonTable() {
  return (
    <div style={{
      background: '#fff', border: '1px solid #E5E7EB', borderRadius: 14, overflow: 'hidden',
    }}>
      <div style={{ padding: 16 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0',
            borderBottom: '1px solid #F3F4F6',
          }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#F3F4F6' }} />
            <div style={{ flex: 1 }}>
              <div style={{ width: '40%', height: 14, background: '#F3F4F6', borderRadius: 4 }} />
              <div style={{ width: '60%', height: 12, background: '#F3F4F6', borderRadius: 4, marginTop: 6 }} />
            </div>
            <div style={{ width: 90, height: 22, background: '#F3F4F6', borderRadius: 9999 }} />
            <div style={{ width: 100, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
            <div style={{ width: 40, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
            <div style={{ width: 90, height: 16, background: '#F3F4F6', borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function RefreshIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 0 0-15-6.7L3 8" /><path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" /><path d="M21 21v-5h-5" />
    </svg>
  );
}
function ChevronLeft({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}
function ChevronRight({ size = 14, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={style}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
function UserIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="9" r="4" />
      <path d="M5 21c1.4-4.5 4-6.5 7-6.5s5.6 2 7 6.5" />
    </svg>
  );
}

// ── Shared styles ─────────────────────────────────────────────────

const kpiLabel: React.CSSProperties = {
  fontSize: 11, color: '#7A828F', textTransform: 'uppercase',
  letterSpacing: '0.06em', fontWeight: 600,
};
const tabIdle: React.CSSProperties = {
  background: 'transparent', border: 'none',
  padding: '10px 14px', marginBottom: -1,
  fontSize: 13, fontWeight: 600, color: '#525A65',
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  display: 'inline-flex', alignItems: 'center',
  fontFamily: 'inherit',
};
const tabActive: React.CSSProperties = {
  ...tabIdle, color: '#0F1115', borderBottom: '2px solid #0F1115',
};
const input: React.CSSProperties = {
  height: 36, padding: '0 12px',
  border: '1px solid #D2D6DC', borderRadius: 9,
  fontSize: 13, color: '#0F1115',
  outline: 'none', background: '#fff', boxSizing: 'border-box',
};
const btnGhost: React.CSSProperties = {
  height: 36, padding: '0 14px',
  background: 'transparent', color: '#525A65',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 6,
};
const th: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: '#525A65',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '14px 16px', fontSize: 14, color: '#0F1115',
  verticalAlign: 'middle',
};
const pillBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  height: 22, padding: '0 10px', borderRadius: 9999,
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
};
const pillSuccess: React.CSSProperties = {
  ...pillBase, background: '#dcfce7', color: '#15803d',
};
const pillMuted: React.CSSProperties = {
  ...pillBase, background: '#F3F4F6', color: '#525A65',
};
const pageBtn: React.CSSProperties = {
  width: 32, height: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid #E5E7EB', borderRadius: 9999,
  background: '#fff', cursor: 'pointer', color: '#525A65',
};
const pageBtnDisabled: React.CSSProperties = {
  color: '#CBD5E1', cursor: 'not-allowed', background: '#FAFAFA',
};
