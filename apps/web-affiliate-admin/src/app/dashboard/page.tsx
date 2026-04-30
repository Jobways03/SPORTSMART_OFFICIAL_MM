'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch, formatDate, formatINR } from '../../lib/api';

interface Affiliate {
  id: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string;
  status: string;
  kycStatus: string;
  websiteUrl?: string | null;
  socialHandle?: string | null;
  joinReason?: string | null;
  commissionPercentage?: string | null;
  createdAt?: string;
  approvedAt?: string | null;
}

interface CouponConfig {
  id: string;
  code: string;
  isPrimary: boolean;
  isActive: boolean;
  expiresAt?: string | null;
  maxUses?: number | null;
  usedCount: number;
  perUserLimit: number;
  minOrderValue?: string | null;
  customerDiscountType?: 'PERCENT' | 'FIXED' | null;
  customerDiscountValue?: string | null;
}

interface AffiliateDetail extends Affiliate {
  couponCodes: CouponConfig[];
}

interface PageData {
  affiliates: Affiliate[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const FILTERS = ['ALL', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'REJECTED', 'SUSPENDED'] as const;
type Filter = (typeof FILTERS)[number];

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A → Z' },
] as const;
type Sort = (typeof SORTS)[number]['value'];

export default function ApplicationsPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<Sort>('newest');
  const [search, setSearch] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    | { kind: 'approve'; affiliateId: string; name: string }
    | { kind: 'reject'; affiliateId: string; name: string }
    | null
  >(null);
  const [actionError, setActionError] = useState('');
  const [manageId, setManageId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filter !== 'ALL') params.set('status', filter);
      if (search.trim()) params.set('search', search.trim());
      const d = await apiFetch<PageData>(`/admin/affiliates?${params}`);
      setData(d);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load applications.');
    } finally {
      setLoading(false);
    }
  };

  const loadCounts = async () => {
    try {
      const statuses: Filter[] = ['PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'REJECTED', 'SUSPENDED'];
      const results = await Promise.all(
        statuses.map((s) =>
          apiFetch<PageData>(`/admin/affiliates?status=${s}&limit=1`).then(
            (r) => [s, r.pagination.total] as const,
          ),
        ),
      );
      const map: Record<string, number> = {};
      let total = 0;
      for (const [s, n] of results) {
        map[s] = n;
        total += n;
      }
      map.ALL = total;
      setCounts(map);
    } catch {
      // silent — KPIs are nice-to-have
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    loadCounts();
  }, []);

  // Refresh both list + counts. Used by the manual button in the hero
  // and by the tab-focus listener so admins returning to a parked tab
  // see live data without a hard reload.
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([load(), loadCounts()]);
    } finally {
      setRefreshing(false);
    }
  };

  // Bind the listener once but always call the latest closure — otherwise
  // a tab-focus refetch after the admin changes the filter would re-run
  // the previous filter's query.
  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshAllRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const handleApprove = async (affiliateId: string) => {
    setActionError('');
    setActionId(affiliateId);
    try {
      await apiFetch(`/admin/affiliates/${affiliateId}/approve`, { method: 'PATCH' });
      setConfirmAction(null);
      await load();
      await loadCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'Approval failed.');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (affiliateId: string, reason: string) => {
    setActionError('');
    setActionId(affiliateId);
    try {
      await apiFetch(`/admin/affiliates/${affiliateId}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
      setConfirmAction(null);
      await load();
      await loadCounts();
    } catch (e: any) {
      setActionError(e?.message ?? 'Rejection failed.');
    } finally {
      setActionId(null);
    }
  };

  const sortedAffiliates = (() => {
    if (!data) return [];
    const arr = [...data.affiliates];
    if (sort === 'oldest') {
      arr.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    } else if (sort === 'name') {
      arr.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
    } else {
      arr.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    }
    return arr;
  })();

  const pendingCount = counts.PENDING_APPROVAL ?? 0;

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Hero band */}
      <header
        style={{
          position: 'relative',
          padding: '22px 24px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #312e81 100%)',
          color: '#fff',
          borderRadius: 14,
          marginBottom: 20,
          overflow: 'hidden',
        }}
      >
        <div style={{
          position: 'absolute',
          right: -40,
          top: -40,
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.35) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', position: 'relative' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 4 }}>
              Affiliate program
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Affiliates
            </h1>
            <p style={{ fontSize: 13, color: '#cbd5e1', margin: '6px 0 0', maxWidth: 560, lineHeight: 1.55 }}>
              Review applications, approve or reject, and configure commission rates &amp; coupon discounts per affiliate.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing}
              title="Refresh"
              aria-label="Refresh"
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.18)',
                color: '#e2e8f0',
                cursor: refreshing ? 'wait' : 'pointer',
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: refreshing ? 0.6 : 1,
                transition: 'background 0.15s, transform 0.4s',
                transform: refreshing ? 'rotate(360deg)' : 'rotate(0deg)',
              }}
            >
              ↻
            </button>
            {pendingCount > 0 ? (
              <button
                onClick={() => setFilter('PENDING_APPROVAL')}
                style={{
                  padding: '12px 20px',
                  background: '#fbbf24',
                  color: '#451a03',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 6px 16px rgba(251, 191, 36, 0.35)',
                }}
              >
                <span style={{ fontSize: 16 }}>⚡</span>
                Review {pendingCount} pending
                <span aria-hidden style={{ marginLeft: 4 }}>→</span>
              </button>
            ) : (
              <div style={{ fontSize: 12, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                All caught up
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Click-to-filter KPI tiles */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
        <KpiTile icon="👥" label="Total" value={counts.ALL ?? 0} tone="neutral" active={filter === 'ALL'} onClick={() => setFilter('ALL')} />
        <KpiTile icon="⏳" label="Pending" value={counts.PENDING_APPROVAL ?? 0} tone="warning" active={filter === 'PENDING_APPROVAL'} onClick={() => setFilter('PENDING_APPROVAL')} pulse={pendingCount > 0} />
        <KpiTile icon="✅" label="Active" value={counts.ACTIVE ?? 0} tone="success" active={filter === 'ACTIVE'} onClick={() => setFilter('ACTIVE')} />
        <KpiTile icon="⏸️" label="Suspended" value={counts.SUSPENDED ?? 0} tone="danger" active={filter === 'SUSPENDED'} onClick={() => setFilter('SUSPENDED')} />
        <KpiTile icon="🚫" label="Rejected" value={counts.REJECTED ?? 0} tone="muted" active={filter === 'REJECTED'} onClick={() => setFilter('REJECTED')} />
      </section>

      {/* Toolbar — filter pills + sort + search, all in one row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          marginBottom: 16,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 999,
                border: '1px solid ' + (filter === s ? '#2563eb' : '#e2e8f0'),
                background: filter === s ? '#2563eb' : '#f8fafc',
                color: filter === s ? '#fff' : '#475569',
                cursor: 'pointer',
              }}
            >
              {s === 'ALL' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            style={{
              padding: '7px 28px 7px 12px',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'inherit',
              fontWeight: 600,
              color: '#475569',
              background: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>\") no-repeat right 10px center #fff",
              appearance: 'none',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              load();
            }}
            style={{ display: 'flex', gap: 0, position: 'relative' }}
          >
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
                fontSize: 13,
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone"
              style={{
                padding: '7px 12px 7px 32px',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                minWidth: 220,
              }}
            />
          </form>
        </div>
      </div>

      {error && <div style={errBox}>{error}</div>}

      {loading ? (
        <ListSkeleton />
      ) : sortedAffiliates.length === 0 ? (
        <EmptyState filter={filter} onClear={() => setFilter('ALL')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sortedAffiliates.map((a) => (
            <AffiliateCard
              key={a.id}
              affiliate={a}
              actionLoading={actionId === a.id}
              onApprove={() =>
                setConfirmAction({ kind: 'approve', affiliateId: a.id, name: `${a.firstName} ${a.lastName}` })
              }
              onReject={() =>
                setConfirmAction({ kind: 'reject', affiliateId: a.id, name: `${a.firstName} ${a.lastName}` })
              }
              onManage={() => setManageId(a.id)}
            />
          ))}
        </div>
      )}

      {data && data.pagination.total > 0 && (
        <p style={{ marginTop: 14, fontSize: 12, color: '#94a3b8' }}>
          Showing {data.affiliates.length} of {data.pagination.total} affiliate{data.pagination.total === 1 ? '' : 's'}.
        </p>
      )}

      {confirmAction?.kind === 'approve' && (
        <ConfirmModal
          tone="success"
          title={`Approve ${confirmAction.name}?`}
          body="A primary coupon code will be auto-generated and the affiliate's status moves to ACTIVE. They'll be able to log in immediately."
          confirmLabel="Approve"
          loading={actionId === confirmAction.affiliateId}
          error={actionError}
          onCancel={() => {
            setConfirmAction(null);
            setActionError('');
          }}
          onConfirm={() => handleApprove(confirmAction.affiliateId)}
        />
      )}
      {confirmAction?.kind === 'reject' && (
        <RejectModal
          name={confirmAction.name}
          loading={actionId === confirmAction.affiliateId}
          error={actionError}
          onCancel={() => {
            setConfirmAction(null);
            setActionError('');
          }}
          onConfirm={(reason) => handleReject(confirmAction.affiliateId, reason)}
        />
      )}

      {manageId && (
        <ManageAffiliateModal
          affiliateId={manageId}
          onClose={() => setManageId(null)}
          onChanged={() => {
            load();
            loadCounts();
          }}
        />
      )}
    </div>
  );
}

function KpiTile({
  icon,
  label,
  value,
  tone,
  active,
  onClick,
  pulse,
}: {
  icon: string;
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'muted';
  active?: boolean;
  onClick?: () => void;
  pulse?: boolean;
}) {
  const palette = {
    success: { fg: '#16a34a', bg: '#f0fdf4', ring: '#bbf7d0' },
    warning: { fg: '#b45309', bg: '#fffbeb', ring: '#fde68a' },
    danger: { fg: '#b91c1c', bg: '#fef2f2', ring: '#fecaca' },
    neutral: { fg: '#0f172a', bg: '#f8fafc', ring: '#cbd5e1' },
    muted: { fg: '#64748b', bg: '#f8fafc', ring: '#e2e8f0' },
  }[tone];
  return (
    <button
      onClick={onClick}
      type="button"
      style={{
        position: 'relative',
        padding: 14,
        background: '#fff',
        border: '1px solid ' + (active ? palette.fg : '#e2e8f0'),
        borderRadius: 12,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'transform 0.15s, box-shadow 0.15s',
        boxShadow: active ? `0 0 0 3px ${palette.ring}` : 'none',
        fontFamily: 'inherit',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = active
          ? `0 6px 14px rgba(15, 23, 42, 0.08), 0 0 0 3px ${palette.ring}`
          : '0 6px 14px rgba(15, 23, 42, 0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = active ? `0 0 0 3px ${palette.ring}` : 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: palette.bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
          }}
        >
          {icon}
        </div>
        {pulse && value > 0 && (
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: palette.fg,
            boxShadow: `0 0 0 4px ${palette.fg}22`,
          }} />
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: palette.fg, marginTop: 2, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
        {value}
      </div>
    </button>
  );
}

function AffiliateCard({
  affiliate: a,
  actionLoading,
  onApprove,
  onReject,
  onManage,
}: {
  affiliate: Affiliate;
  actionLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
  onManage: () => void;
}) {
  const initials = `${a.firstName?.[0] ?? ''}${a.lastName?.[0] ?? ''}`.toUpperCase();
  const hoursOld = a.createdAt ? Math.floor((Date.now() - new Date(a.createdAt).getTime()) / (1000 * 60 * 60)) : null;
  const isNew = hoursOld !== null && hoursOld < 24 && a.status === 'PENDING_APPROVAL';
  const ageLabel = a.createdAt ? relativeTime(a.createdAt) : null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: 16,
        background: '#fff',
        border: '1px solid ' + (isNew ? '#fde68a' : '#e2e8f0'),
        borderRadius: 12,
        alignItems: 'flex-start',
        position: 'relative',
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 8px 20px rgba(15, 23, 42, 0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {isNew && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: -8,
            left: 14,
            padding: '2px 9px',
            fontSize: 9,
            fontWeight: 700,
            borderRadius: 999,
            background: '#fbbf24',
            color: '#451a03',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            boxShadow: '0 4px 10px rgba(251, 191, 36, 0.4)',
          }}
        >
          New · {hoursOld === 0 ? 'just now' : `${hoursOld}h ago`}
        </span>
      )}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #dbeafe 0%, #c7d2fe 100%)',
          color: '#1d4ed8',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          flexShrink: 0,
        }}
      >
        {initials || '?'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{a.firstName} {a.lastName}</div>
          <StatusPill status={a.status} />
          {a.kycStatus !== 'NOT_STARTED' && <KycPill status={a.kycStatus} />}
          {a.commissionPercentage != null && (
            <span style={{ padding: '2px 7px', fontSize: 10, fontWeight: 700, borderRadius: 4, background: '#f0fdf4', color: '#15803d' }}>
              {Number(a.commissionPercentage).toFixed(2)}% rate
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
          {a.email}
          {a.phone && <> · {a.phone}</>}
          {a.websiteUrl && (
            <> · <a href={a.websiteUrl} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{a.websiteUrl}</a></>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          {ageLabel && <>Applied {ageLabel}</>}
          {a.approvedAt && <> · Approved {formatDate(a.approvedAt)}</>}
        </div>
        {a.joinReason && (
          <div style={{ fontSize: 12, color: '#475569', marginTop: 8, lineHeight: 1.5, padding: '8px 10px', background: '#f8fafc', borderRadius: 6, borderLeft: '3px solid #cbd5e1' }}>
            {a.joinReason}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {a.status === 'PENDING_APPROVAL' ? (
          <>
            <button onClick={onApprove} disabled={actionLoading} style={btnSuccess}>
              {actionLoading ? '…' : 'Approve'}
            </button>
            <button onClick={onReject} disabled={actionLoading} style={btnDanger}>
              Reject
            </button>
          </>
        ) : a.status !== 'REJECTED' ? (
          <button onClick={onManage} style={btnPrimary}>
            Manage
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ filter, onClear }: { filter: Filter; onClear: () => void }) {
  const messages: Record<Filter, { emoji: string; title: string; sub: string }> = {
    ALL: { emoji: '👥', title: 'No affiliates yet', sub: 'When someone signs up via the affiliate portal, they’ll appear here.' },
    PENDING_APPROVAL: { emoji: '✨', title: 'Inbox zero', sub: 'No affiliate applications are waiting for review right now.' },
    ACTIVE: { emoji: '📈', title: 'No active affiliates', sub: 'Approve a pending application to see them here.' },
    INACTIVE: { emoji: '💤', title: 'Nothing inactive', sub: 'Affiliates only land here when manually deactivated.' },
    REJECTED: { emoji: '🚫', title: 'No rejections', sub: 'Affiliates rejected during review will appear here.' },
    SUSPENDED: { emoji: '⏸️', title: 'No suspensions', sub: 'Suspended affiliates will appear here.' },
  };
  const m = messages[filter];
  const showClearAction = filter !== 'ALL';
  return (
    <div
      style={{
        padding: '64px 24px',
        textAlign: 'center',
        background: '#fff',
        border: '1px dashed #cbd5e1',
        borderRadius: 14,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          margin: '0 auto 14px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #f1f5f9 0%, #e0e7ff 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 36,
        }}
      >
        {m.emoji}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{m.title}</div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 6, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>
        {m.sub}
      </div>
      {showClearAction && (
        <button
          onClick={onClear}
          style={{
            marginTop: 18,
            padding: '8px 18px',
            background: '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color: '#475569',
            cursor: 'pointer',
          }}
        >
          ← Show all affiliates
        </button>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 88,
            background: 'linear-gradient(90deg, #f8fafc, #f1f5f9, #f8fafc)',
            backgroundSize: '200% 100%',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
          }}
        />
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    PENDING_APPROVAL: { bg: '#fef3c7', fg: '#92400e' },
    ACTIVE: { bg: '#dcfce7', fg: '#15803d' },
    REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
    SUSPENDED: { bg: '#fef2f2', fg: '#b91c1c' },
    INACTIVE: { bg: '#e2e8f0', fg: '#475569' },
  };
  const p = palette[status] ?? { bg: '#f1f5f9', fg: '#475569' };
  return (
    <span style={{ padding: '3px 9px', fontSize: 10, fontWeight: 700, borderRadius: 999, background: p.bg, color: p.fg, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function KycPill({ status }: { status: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    PENDING: { bg: '#fef3c7', fg: '#92400e' },
    VERIFIED: { bg: '#dcfce7', fg: '#15803d' },
    REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
  };
  const p = palette[status] ?? { bg: '#f1f5f9', fg: '#475569' };
  return (
    <span style={{ padding: '2px 7px', fontSize: 9, fontWeight: 700, borderRadius: 4, background: p.bg, color: p.fg, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
      KYC: {status}
    </span>
  );
}

/* ── Modals (unchanged from previous version) ─────────────── */

function ConfirmModal({
  tone,
  title,
  body,
  confirmLabel,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  tone: 'success' | 'danger';
  title: string;
  body: string;
  confirmLabel: string;
  loading: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmStyle = tone === 'success' ? btnSuccess : btnDanger;
  return (
    <Modal onClose={loading ? () => {} : onCancel} zIndex={60} width={460}>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>{title}</h2>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 18px', lineHeight: 1.55 }}>{body}</p>
      {error && (
        <div style={{ padding: '8px 12px', marginBottom: 14, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} disabled={loading} style={btnGhost}>Cancel</button>
        <button onClick={onConfirm} disabled={loading} style={confirmStyle}>
          {loading ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function RejectModal({
  name,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  loading: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <Modal onClose={loading ? () => {} : onCancel} zIndex={60} width={520}>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>Reject {name}?</h2>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 16px', lineHeight: 1.55 }}>
        The applicant will see this reason and can re-apply later if appropriate.
      </p>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        Reason (visible to applicant) <span style={{ color: '#dc2626' }}>*</span>
      </label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={4}
        autoFocus
        placeholder="e.g. Profile didn't match our partner criteria for this category."
        style={{
          width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 6,
          fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
        }}
      />
      {error && (
        <div style={{ padding: '8px 12px', marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onCancel} disabled={loading} style={btnGhost}>Cancel</button>
        <button onClick={() => onConfirm(trimmed)} disabled={loading || !trimmed} style={{ ...btnDanger, opacity: !trimmed ? 0.5 : 1, cursor: !trimmed ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Rejecting…' : 'Reject application'}
        </button>
      </div>
    </Modal>
  );
}

function ManageAffiliateModal({
  affiliateId,
  onClose,
  onChanged,
}: {
  affiliateId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<AffiliateDetail | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = async () => {
    setLoadError('');
    try {
      const d = await apiFetch<AffiliateDetail>(`/admin/affiliates/${affiliateId}`);
      setDetail(d);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load affiliate.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affiliateId]);

  return (
    <Modal onClose={onClose} width={720}>
      {loadError ? (
        <p style={{ color: '#b91c1c', fontSize: 13 }}>{loadError}</p>
      ) : !detail ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
                Manage {detail.firstName} {detail.lastName}
              </h2>
              <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
                {detail.email} · Status: {detail.status.replace(/_/g, ' ')} · KYC: {detail.kycStatus.replace(/_/g, ' ')}
              </p>
            </div>
            <button onClick={onClose} style={btnGhost}>Close</button>
          </div>

          <CommissionSection
            initial={detail.commissionPercentage}
            affiliateId={detail.id}
            onSaved={async (next) => {
              setDetail((d) => (d ? { ...d, commissionPercentage: next } : d));
              onChanged();
            }}
          />

          <div style={{ marginTop: 22 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>Coupon codes</h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
              Configure customer-facing discount, expiry, and usage limits per coupon.
              Affiliate earns commission on every order regardless of the customer discount.
            </p>
            {detail.couponCodes.length === 0 ? (
              <div style={{ padding: 18, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                No coupon codes — issue one by approving the affiliate.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {detail.couponCodes.map((c) => (
                  <CouponEditor
                    key={c.id}
                    affiliateId={detail.id}
                    coupon={c}
                    onSaved={async (next) => {
                      setDetail((d) =>
                        d
                          ? { ...d, couponCodes: d.couponCodes.map((x) => (x.id === next.id ? { ...x, ...next } : x)) }
                          : d,
                      );
                      onChanged();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function CommissionSection({
  initial,
  affiliateId,
  onSaved,
}: {
  initial?: string | null;
  affiliateId: string;
  onSaved: (next: string | null) => void;
}) {
  const [pct, setPct] = useState<string>(initial != null ? Number(initial).toString() : '');
  const [useDefault, setUseDefault] = useState(initial == null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  const save = async () => {
    setErr('');
    setSaving(true);
    try {
      let body: { percentage: number | null };
      if (useDefault) {
        body = { percentage: null };
      } else {
        const n = Number(pct);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          setErr('Enter a percentage between 0 and 100.');
          setSaving(false);
          return;
        }
        body = { percentage: n };
      }
      const result = await apiFetch<{ commissionPercentage: string | null }>(
        `/admin/affiliates/${affiliateId}/commission`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      onSaved(result.commissionPercentage);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (e: any) {
      setErr(e?.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      style={{
        marginTop: 18,
        padding: 16,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>Commission rate</h3>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
        Per-affiliate override. Leave on default to use the platform-wide rate.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#475569', marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={useDefault}
          onChange={(e) => setUseDefault(e.target.checked)}
        />
        Use platform default rate
      </label>
      {!useDefault && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="number"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            min={0}
            max={100}
            step={0.5}
            placeholder="e.g. 8"
            style={{ ...inputStyle, width: 120 }}
          />
          <span style={{ fontSize: 13, color: '#475569' }}>% of post-discount subtotal</span>
        </div>
      )}
      {err && <div style={errBox}>{err}</div>}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : 'Save commission rate'}
        </button>
        {savedFlash && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </section>
  );
}

function CouponEditor({
  affiliateId,
  coupon,
  onSaved,
}: {
  affiliateId: string;
  coupon: CouponConfig;
  onSaved: (next: CouponConfig) => void;
}) {
  const [discountKind, setDiscountKind] = useState<'NONE' | 'PERCENT' | 'FIXED'>(
    coupon.customerDiscountType ?? 'NONE',
  );
  const [discountValue, setDiscountValue] = useState<string>(
    coupon.customerDiscountValue != null ? Number(coupon.customerDiscountValue).toString() : '',
  );
  const [expiresAt, setExpiresAt] = useState<string>(
    coupon.expiresAt ? coupon.expiresAt.slice(0, 10) : '',
  );
  const [maxUses, setMaxUses] = useState<string>(
    coupon.maxUses != null ? String(coupon.maxUses) : '',
  );
  const [minOrderValue, setMinOrderValue] = useState<string>(
    coupon.minOrderValue != null ? Number(coupon.minOrderValue).toString() : '',
  );
  const [isActive, setIsActive] = useState(coupon.isActive);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  const save = async () => {
    setErr('');
    setSaving(true);
    try {
      const body: any = { isActive };
      if (discountKind === 'NONE') {
        body.customerDiscountType = null;
        body.customerDiscountValue = null;
      } else {
        const n = Number(discountValue);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error('Discount value must be ≥ 0.');
        }
        if (discountKind === 'PERCENT' && n > 100) {
          throw new Error('Percentage discount cannot exceed 100.');
        }
        body.customerDiscountType = discountKind;
        body.customerDiscountValue = n;
      }
      body.expiresAt = expiresAt ? new Date(expiresAt).toISOString() : null;
      body.maxUses = maxUses === '' ? null : Number(maxUses);
      body.minOrderValue = minOrderValue === '' ? null : Number(minOrderValue);

      const result = await apiFetch<CouponConfig>(
        `/admin/affiliates/${affiliateId}/coupons/${coupon.id}`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      onSaved(result);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (e: any) {
      setErr(e?.message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: '0.5px' }}>
            {coupon.code}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {coupon.isPrimary && 'Primary · '}
            {coupon.usedCount} use{coupon.usedCount === 1 ? '' : 's'}
            {coupon.maxUses != null && ` / ${coupon.maxUses} max`}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569' }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Customer discount">
          <select
            value={discountKind}
            onChange={(e) => setDiscountKind(e.target.value as any)}
            style={inputStyle}
          >
            <option value="NONE">No customer discount</option>
            <option value="PERCENT">Percent off</option>
            <option value="FIXED">Fixed ₹ off</option>
          </select>
        </Field>
        {discountKind !== 'NONE' && (
          <Field label={discountKind === 'PERCENT' ? 'Percent (%)' : 'Amount (₹)'}>
            <input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              min={0}
              max={discountKind === 'PERCENT' ? 100 : undefined}
              step={discountKind === 'PERCENT' ? 0.5 : 1}
              style={inputStyle}
            />
          </Field>
        )}
        <Field label="Expires on">
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Max total uses">
          <input
            type="number"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            min={0}
            placeholder="No limit"
            style={inputStyle}
          />
        </Field>
        <Field label="Minimum order value (₹)">
          <input
            type="number"
            value={minOrderValue}
            onChange={(e) => setMinOrderValue(e.target.value)}
            min={0}
            placeholder="No minimum"
            style={inputStyle}
          />
        </Field>
        <div style={{ alignSelf: 'end', fontSize: 11, color: '#94a3b8' }}>
          {coupon.minOrderValue != null && `Currently ${formatINR(coupon.minOrderValue)}`}
        </div>
      </div>

      {err && <div style={errBox}>{err}</div>}

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : 'Save coupon'}
        </button>
        {savedFlash && <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Saved</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Modal({ children, onClose, zIndex = 50, width = 640 }: { children: React.ReactNode; onClose: () => void; zIndex?: number; width?: number }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 28,
          maxWidth: width,
          width: 'calc(100% - 32px)',
          maxHeight: 'calc(100vh - 80px)',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnSuccess: React.CSSProperties = {
  padding: '6px 14px',
  background: '#16a34a',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  padding: '6px 14px',
  background: '#fff',
  color: '#b91c1c',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

function relativeTime(value: string): string {
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 0) return formatDate(value);
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatDate(value);
}

const errBox: React.CSSProperties = {
  padding: '8px 12px',
  marginTop: 10,
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: 6,
  fontSize: 12,
  color: '#991b1b',
};
