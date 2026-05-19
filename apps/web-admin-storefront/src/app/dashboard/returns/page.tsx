'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminReturnsService,
  ReturnListItem,
  ReturnStatus,
} from '@/services/admin-returns.service';

type PillTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const STATUS_OPTIONS: ReturnStatus[] = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PICKUP_SCHEDULED',
  'IN_TRANSIT',
  'RECEIVED',
  'QC_APPROVED',
  'QC_REJECTED',
  'PARTIALLY_APPROVED',
  'REFUND_PROCESSING',
  'REFUNDED',
  'COMPLETED',
  'CANCELLED',
];

function statusPill(status: string): { label: string; tone: PillTone } {
  switch (status) {
    case 'REQUESTED':
      return { label: 'Requested', tone: 'warning' };
    case 'APPROVED':
      return { label: 'Approved', tone: 'info' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'danger' };
    case 'PICKUP_SCHEDULED':
      return { label: 'Pickup scheduled', tone: 'info' };
    case 'IN_TRANSIT':
      return { label: 'In transit', tone: 'info' };
    case 'RECEIVED':
      return { label: 'Received', tone: 'info' };
    case 'QC_APPROVED':
      return { label: 'QC approved', tone: 'success' };
    case 'QC_REJECTED':
      return { label: 'QC rejected', tone: 'danger' };
    case 'PARTIALLY_APPROVED':
      return { label: 'Partially approved', tone: 'warning' };
    case 'REFUND_PROCESSING':
      return { label: 'Refund processing', tone: 'info' };
    case 'REFUNDED':
      return { label: 'Refunded', tone: 'success' };
    case 'COMPLETED':
      return { label: 'Completed', tone: 'success' };
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'neutral' };
    default:
      return { label: status.toLowerCase(), tone: 'neutral' };
  }
}

const statusLabel = (s: string) =>
  statusPill(s).label;

/* ── Formatting ─────────────────────────────────────────────── */

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

const inr = (v: string | number | null | undefined) => {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/* ── Page ───────────────────────────────────────────────────── */

export default function AdminReturnsListPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [returns, setReturns] = useState<ReturnListItem[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Bulk-action selection + transient banner state.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<null | 'approve' | 'close'>(null);
  const [bulkResult, setBulkResult] = useState<{
    succeeded: number;
    failed: number;
    failures: Array<{ id: string; error?: string }>;
  } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const fetchReturns = useCallback(
    async (page: number) => {
      setLoading(true);
      try {
        const res = await adminReturnsService.listReturns({
          page,
          limit: 20,
          status: statusFilter || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          search: search.trim() || undefined,
        });
        if (res.data) {
          setReturns(res.data.returns);
          setPagination(res.data.pagination);
        }
      } catch {
        setReturns([]);
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter, fromDate, toDate],
  );

  useEffect(() => {
    fetchReturns(1);
  }, [fetchReturns]);

  // Drop selections that aren't visible anymore so the count is honest.
  useEffect(() => {
    const visible = new Set(returns.map((r) => r.id));
    setSelectedIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
      });
      return next.size === prev.size ? prev : next;
    });
  }, [returns]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const allVisibleSelected = returns.every((r) => prev.has(r.id));
      if (allVisibleSelected) return new Set();
      const next = new Set(prev);
      returns.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const runBulk = async (action: 'approve' | 'close') => {
    if (selectedIds.size === 0 || bulkBusy) return;
    const ids = Array.from(selectedIds);
    // Confirm — bulk-approve / bulk-close are SUPER_ADMIN-only and irreversible
    // on the per-record path. The backend cap is 100; mirror it here so the
    // user gets a clear message instead of a 400.
    if (ids.length > 100) {
      setBulkResult({
        succeeded: 0,
        failed: ids.length,
        failures: [{ id: '*', error: 'Batch capped at 100 — refine selection.' }],
      });
      return;
    }
    if (
      !window.confirm(
        `${action === 'approve' ? 'Approve' : 'Close'} ${ids.length} return${ids.length === 1 ? '' : 's'}? This bypasses per-record review.`,
      )
    ) {
      return;
    }
    setBulkBusy(action);
    setBulkResult(null);
    try {
      const res =
        action === 'approve'
          ? await adminReturnsService.bulkApprove(ids)
          : await adminReturnsService.bulkClose(ids);
      const results = res.data?.results ?? [];
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.length - succeeded;
      setBulkResult({
        succeeded,
        failed,
        failures: results
          .filter((r) => !r.success)
          .map((r) => ({ id: r.id, error: r.error })),
      });
      setSelectedIds(new Set());
      // Refresh the list so the UI reflects new statuses.
      fetchReturns(pagination.page);
    } catch (err) {
      setBulkResult({
        succeeded: 0,
        failed: ids.length,
        failures: [
          { id: '*', error: err instanceof Error ? err.message : 'Bulk action failed' },
        ],
      });
    } finally {
      setBulkBusy(null);
    }
  };

  const runExport = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const blob = await adminReturnsService.exportCsv({
        status: statusFilter || undefined,
        dateFrom: fromDate || undefined,
        dateTo: toDate || undefined,
        search: search.trim() || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `returns-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportBusy(false);
    }
  };

  const hasFilters = !!(search || statusFilter || fromDate || toDate);
  const handleClear = () => {
    setSearch('');
    setStatusFilter('');
    setFromDate('');
    setToDate('');
  };

  const needsReview = useMemo(
    () => returns.filter((r) => r.status === 'REQUESTED').length,
    [returns],
  );

  return (
    <div style={styles.page}>
      {/* ── Header ─────────────────────────────────────────── */}
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Returns</h1>
          <p style={styles.headerSub}>
            Review, approve, and process customer returns.
          </p>
        </div>
        <button
          type="button"
          onClick={runExport}
          disabled={exportBusy}
          style={{
            height: 36,
            padding: '0 16px',
            border: '1px solid #D2D6DC',
            background: '#fff',
            color: '#0F1115',
            borderRadius: 9999,
            fontWeight: 600,
            fontSize: 13,
            cursor: exportBusy ? 'wait' : 'pointer',
            opacity: exportBusy ? 0.6 : 1,
          }}
        >
          {exportBusy ? 'Exporting…' : '⤓ Export CSV'}
        </button>
      </header>

      {exportError && (
        <div
          style={{
            margin: '12px 0',
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {exportError}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: 10,
            margin: '12px 0',
            fontSize: 13,
          }}
        >
          <strong style={{ color: '#9a3412' }}>
            {selectedIds.size} selected
          </strong>
          <span style={{ color: '#9a3412', fontSize: 12 }}>
            (SUPER_ADMIN only — cap 100)
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => runBulk('approve')}
              disabled={!!bulkBusy}
              style={{
                height: 32,
                padding: '0 14px',
                border: 'none',
                background: '#16a34a',
                color: '#fff',
                borderRadius: 9999,
                fontWeight: 600,
                fontSize: 12,
                cursor: bulkBusy ? 'wait' : 'pointer',
                opacity: bulkBusy ? 0.6 : 1,
              }}
            >
              {bulkBusy === 'approve' ? 'Approving…' : 'Bulk approve'}
            </button>
            <button
              type="button"
              onClick={() => runBulk('close')}
              disabled={!!bulkBusy}
              style={{
                height: 32,
                padding: '0 14px',
                border: 'none',
                background: '#0F1115',
                color: '#fff',
                borderRadius: 9999,
                fontWeight: 600,
                fontSize: 12,
                cursor: bulkBusy ? 'wait' : 'pointer',
                opacity: bulkBusy ? 0.6 : 1,
              }}
            >
              {bulkBusy === 'close' ? 'Closing…' : 'Bulk close'}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={!!bulkBusy}
              style={{
                height: 32,
                padding: '0 14px',
                border: '1px solid #fed7aa',
                background: '#fff',
                color: '#9a3412',
                borderRadius: 9999,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {bulkResult && (
        <div
          style={{
            margin: '12px 0',
            padding: '10px 14px',
            background: bulkResult.failed === 0 ? '#ecfdf5' : '#fef3c7',
            border: `1px solid ${bulkResult.failed === 0 ? '#6ee7b7' : '#fde68a'}`,
            color: bulkResult.failed === 0 ? '#065f46' : '#92400e',
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          <div>
            Bulk: <strong>{bulkResult.succeeded}</strong> succeeded,{' '}
            <strong>{bulkResult.failed}</strong> failed.{' '}
            <button
              type="button"
              onClick={() => setBulkResult(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
                fontSize: 13,
              }}
            >
              dismiss
            </button>
          </div>
          {bulkResult.failures.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {bulkResult.failures.slice(0, 5).map((f, i) => (
                <li key={i} style={{ fontSize: 12 }}>
                  <code style={{ fontFamily: 'ui-monospace, monospace' }}>
                    {f.id.slice(0, 8)}
                  </code>
                  {f.error ? ` — ${f.error}` : ''}
                </li>
              ))}
              {bulkResult.failures.length > 5 && (
                <li style={{ fontSize: 12 }}>
                  …and {bulkResult.failures.length - 5} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* ── Attention bar ──────────────────────────────────── */}
      {!loading && needsReview > 0 && !statusFilter && (
        <button
          type="button"
          onClick={() => setStatusFilter('REQUESTED')}
          style={styles.alert}
        >
          <div style={styles.alertLeft}>
            <span style={styles.alertDot} aria-hidden="true" />
            <div>
              <div style={styles.alertTitle}>
                {needsReview} return{needsReview === 1 ? '' : 's'} awaiting your
                review
              </div>
              <div style={styles.alertBody}>
                Requested returns need admin approval before pickup can be
                scheduled.
              </div>
            </div>
          </div>
          <span style={styles.alertAction}>
            Show requested only
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
        </button>
      )}

      {/* ── Toolbar ────────────────────────────────────────── */}
      <div style={styles.toolbar}>
        <div style={styles.searchWrap}>
          <svg
            style={styles.searchIcon}
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
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
            placeholder="Search by return # or order #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchReturns(1)}
            style={styles.searchInput}
            aria-label="Search returns"
          />
        </div>

        <label style={styles.fieldBlock}>
          <span style={styles.fieldLabel}>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={styles.select}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.fieldBlock}>
          <span style={styles.fieldLabel}>From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={styles.dateInput}
          />
        </label>

        <label style={styles.fieldBlock}>
          <span style={styles.fieldLabel}>To</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={styles.dateInput}
          />
        </label>

        <div style={styles.toolbarActions}>
          {hasFilters && (
            <button
              type="button"
              onClick={handleClear}
              style={styles.btnGhost}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => fetchReturns(1)}
            style={styles.btnPrimary}
          >
            Apply
          </button>
        </div>
      </div>

      {/* ── States ─────────────────────────────────────────── */}
      {loading ? (
        <SkeletonTable />
      ) : returns.length === 0 ? (
        <EmptyState hasFilters={hasFilters} />
      ) : (
        <>
          <div style={styles.card}>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, width: 36 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all visible"
                        checked={
                          returns.length > 0 &&
                          returns.every((r) => selectedIds.has(r.id))
                        }
                        ref={(el) => {
                          if (el) {
                            const some = returns.some((r) =>
                              selectedIds.has(r.id),
                            );
                            const all = returns.every((r) =>
                              selectedIds.has(r.id),
                            );
                            el.indeterminate = some && !all;
                          }
                        }}
                        onChange={toggleAllVisible}
                      />
                    </th>
                    <th style={styles.th}>Return</th>
                    <th style={styles.th}>Order</th>
                    <th style={styles.th}>Customer</th>
                    <th style={{ ...styles.th, textAlign: 'right' as const }}>
                      Items
                    </th>
                    <th style={{ ...styles.th, textAlign: 'right' as const }}>
                      Refund
                    </th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Created</th>
                    <th style={{ ...styles.th, width: 36 }} aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => (
                    <ReturnRow
                      key={r.id}
                      data={r}
                      selected={selectedIds.has(r.id)}
                      onToggle={() => toggleId(r.id)}
                      onOpen={() => router.push(`/dashboard/returns/${r.id}`)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {pagination.totalPages > 1 && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onChange={(p) => fetchReturns(p)}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── Row ────────────────────────────────────────────────────── */

function ReturnRow({
  data: r,
  onOpen,
  selected,
  onToggle,
}: {
  data: ReturnListItem;
  onOpen: () => void;
  selected: boolean;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const customerFullName =
    [r.customer?.firstName, r.customer?.lastName].filter(Boolean).join(' ') ||
    r.customer?.email ||
    'Unknown';
  const color = avatarColor(`${customerFullName}${r.customerId}`);
  const pill = statusPill(r.status);
  const orderNumber =
    r.masterOrder?.orderNumber ?? r.subOrder?.masterOrder?.orderNumber ?? null;

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
      <td
        style={{ ...styles.td, width: 36 }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          aria-label={`Select return ${r.returnNumber}`}
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <td style={styles.td}>
        <span style={styles.returnNumber}>{r.returnNumber}</span>
      </td>
      <td style={styles.td}>
        {orderNumber ? (
          <span style={styles.mono}>#{orderNumber}</span>
        ) : (
          <span style={styles.muted}>—</span>
        )}
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
            {initials(customerFullName)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={styles.customerName}>{customerFullName}</div>
            {r.customer?.email && (
              <div style={styles.customerEmail} title={r.customer.email}>
                {r.customer.email}
              </div>
            )}
          </div>
        </div>
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontVariantNumeric: 'tabular-nums',
          color: '#475569',
        }}
      >
        {r.items?.length ?? 0}
      </td>
      <td
        style={{
          ...styles.td,
          textAlign: 'right' as const,
          fontWeight: 600,
          color:
            r.refundAmount == null || r.refundAmount === ''
              ? '#94a3b8'
              : '#0f172a',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {inr(r.refundAmount)}
      </td>
      <td style={styles.td}>
        <Pill label={pill.label} tone={pill.tone} />
      </td>
      <td style={{ ...styles.td, color: '#475569', whiteSpace: 'nowrap' }}>
        {fmtDate(r.createdAt)}
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

/* ── Pagination ─────────────────────────────────────────────── */

function Pagination({
  page,
  totalPages,
  total,
  limit,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onChange: (p: number) => void;
}) {
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div style={styles.pagination}>
      <span style={styles.paginationLabel}>
        Showing <strong>{from}</strong>–<strong>{to}</strong> of{' '}
        <strong>{total.toLocaleString('en-IN')}</strong>
      </span>
      <div style={styles.paginationControls}>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          style={{
            ...styles.pageBtn,
            ...(page <= 1 ? styles.pageBtnDisabled : {}),
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
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          style={{
            ...styles.pageBtn,
            ...(page >= totalPages ? styles.pageBtnDisabled : {}),
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

/* ── Skeleton / Empty ───────────────────────────────────────── */

function SkeletonTable() {
  return (
    <div style={styles.card}>
      <div style={styles.tableScroll}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Return</th>
              <th style={styles.th}>Order</th>
              <th style={styles.th}>Customer</th>
              <th style={{ ...styles.th, textAlign: 'right' as const }}>
                Items
              </th>
              <th style={{ ...styles.th, textAlign: 'right' as const }}>
                Refund
              </th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} style={styles.tr}>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 120 }} />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 100 }} />
                </td>
                <td style={styles.td}>
                  <div style={styles.customerCell}>
                    <div style={{ ...styles.avatar, ...styles.shimmer }} />
                    <div>
                      <div style={{ ...styles.skelLine, width: 140 }} />
                      <div
                        style={{ ...styles.skelLine, width: 180, marginTop: 6 }}
                      />
                    </div>
                  </div>
                </td>
                <td style={{ ...styles.td, textAlign: 'right' as const }}>
                  <div
                    style={{
                      ...styles.skelLine,
                      width: 18,
                      marginLeft: 'auto',
                    }}
                  />
                </td>
                <td style={{ ...styles.td, textAlign: 'right' as const }}>
                  <div
                    style={{
                      ...styles.skelLine,
                      width: 72,
                      marginLeft: 'auto',
                    }}
                  />
                </td>
                <td style={styles.td}>
                  <div style={{ ...styles.skelLine, width: 96, height: 22 }} />
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

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div style={styles.empty}>
      <svg viewBox="0 0 48 48" style={styles.emptyIcon} aria-hidden="true">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6h24l4 8v24a2 2 0 01-2 2H10a2 2 0 01-2-2V14l4-8zM8 14h32M18 22l4 4 8-8"
        />
      </svg>
      <h3 style={styles.emptyTitle}>
        {hasFilters ? 'No returns match your filters' : 'No returns yet'}
      </h3>
      <p style={styles.emptyBody}>
        {hasFilters
          ? 'Try adjusting the search, status, or date range above.'
          : 'Returns requested by customers will appear here.'}
      </p>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────── */

const shimmerKeyframes = `
@keyframes returns-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '24px 32px',
    maxWidth: 1280,
    margin: '0 auto',
    color: '#0f172a',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },

  /* Header */
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

  /* Alert */
  alert: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    gap: 12,
    padding: '14px 18px',
    background: 'rgba(245, 158, 11, 0.08)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: 10,
    marginBottom: 16,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
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

  /* Toolbar */
  toolbar: {
    display: 'flex',
    gap: 12,
    marginBottom: 16,
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  searchWrap: {
    position: 'relative',
    flex: '1 1 260px',
    minWidth: 220,
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
    fontFamily: 'inherit',
  },

  fieldBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 150,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  select: {
    height: 38,
    padding: '0 12px',
    fontSize: 14,
    color: '#0f172a',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    appearance: 'auto',
  },
  dateInput: {
    height: 38,
    padding: '0 12px',
    fontSize: 14,
    color: '#0f172a',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },

  toolbarActions: {
    display: 'flex',
    gap: 8,
    alignSelf: 'stretch',
    alignItems: 'flex-end',
  },
  btnPrimary: {
    height: 38,
    padding: '0 18px',
    fontSize: 13,
    fontWeight: 600,
    color: '#ffffff',
    background: '#0f172a',
    border: '1px solid #0f172a',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  btnGhost: {
    height: 38,
    padding: '0 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    background: '#ffffff',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: '#e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },

  /* Card + Table */
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

  returnNumber: {
    fontWeight: 600,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  mono: {
    fontFamily: '"SF Mono", Menlo, Consolas, monospace',
    fontSize: 12,
    color: '#475569',
  },
  muted: {
    color: '#94a3b8',
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

  rowChevron: {
    width: 16,
    height: 16,
    display: 'inline-block',
    marginRight: 12,
    transition: 'opacity 0.12s, color 0.12s',
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
    animation: 'returns-shimmer 1.2s ease-in-out infinite',
  },
  shimmer: {
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'returns-shimmer 1.2s ease-in-out infinite',
  },
};
