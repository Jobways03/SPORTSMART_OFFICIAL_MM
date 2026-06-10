'use client';

// Phase 13 — admin browser for the three liability-ledger tables
// (SellerDebit, LogisticsClaim, PlatformExpense). Redesigned so the
// finance operator can answer the three questions they actually
// have: how much is at risk, which sellers are responsible, and
// what's still pending recovery.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminLiabilityLedgerService,
  LedgerType,
  LedgerRow,
  SellerDebitRow,
  LogisticsClaimRow,
  PlatformExpenseRow,
} from '@/services/admin-liability-ledger.service';

/* ── Tab map ────────────────────────────────────────────────── */

const TABS: { key: LedgerType; label: string }[] = [
  { key: 'seller_debit', label: 'Seller debits' },
  { key: 'logistics_claim', label: 'Logistics claims' },
  { key: 'platform_expense', label: 'Platform expenses' },
];

interface TabData {
  rows: LedgerRow[];
  total: number;
  loading: boolean;
  error: string;
}

const EMPTY_TAB: TabData = { rows: [], total: 0, loading: true, error: '' };

/* ── Page ───────────────────────────────────────────────────── */

export default function LiabilityLedgerPage() {
  const [tab, setTab] = useState<LedgerType>('seller_debit');
  const [tabData, setTabData] = useState<Record<LedgerType, TabData>>({
    seller_debit: { ...EMPTY_TAB },
    logistics_claim: { ...EMPTY_TAB },
    platform_expense: { ...EMPTY_TAB },
  });

  /* Filters */
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('');
  const [sourceIdFilter, setSourceIdFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const loadTab = useCallback(
    async (which: LedgerType) => {
      setTabData((prev) => ({
        ...prev,
        [which]: { ...prev[which], loading: true, error: '' },
      }));
      try {
        const res = await adminLiabilityLedgerService.list(which, {
          sourceType: sourceTypeFilter || undefined,
          sourceId: sourceIdFilter.trim() || undefined,
          page: 1,
          limit: 50,
        });
        if (res.data) {
          setTabData((prev) => ({
            ...prev,
            [which]: {
              rows: res.data!.items,
              total: res.data!.total,
              loading: false,
              error: '',
            },
          }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load';
        setTabData((prev) => ({
          ...prev,
          [which]: { ...prev[which], loading: false, error: message },
        }));
      }
    },
    [sourceTypeFilter, sourceIdFilter],
  );

  /* Fetch all 3 in parallel on mount + whenever filters change so
     the KPI strip + tab counts stay accurate. */
  useEffect(() => {
    loadTab('seller_debit');
    loadTab('logistics_claim');
    loadTab('platform_expense');
  }, [loadTab]);

  const active = tabData[tab];

  /* ── Derived numbers ──────────────────────────────────────── */

  const sumPaise = (rows: LedgerRow[]) =>
    rows.reduce((s, r) => s + Number(r.amountInPaise), 0);
  const sumPending = (rows: LedgerRow[]) =>
    rows
      .filter((r) => 'status' in r && (r as any).status === 'PENDING')
      .reduce((s, r) => s + Number(r.amountInPaise), 0);

  const kpis = useMemo(() => {
    const sd = tabData.seller_debit.rows;
    const lc = tabData.logistics_claim.rows;
    const px = tabData.platform_expense.rows;
    return {
      totalAtRisk: sumPaise(sd) + sumPaise(lc) + sumPaise(px),
      sellerDebitPending: sumPending(sd),
      logisticsClaimPending: sumPending(lc),
      platformExpense: sumPaise(px),
    };
  }, [tabData]);

  /* ── Search filter (client-side) ──────────────────────────── */

  const visibleRows = useMemo(() => {
    if (!search.trim()) return active.rows;
    const q = search.trim().toLowerCase();
    return active.rows.filter((r) => {
      if (r.reason.toLowerCase().includes(q)) return true;
      if ((r.sourceId ?? '').toLowerCase().includes(q)) return true;
      if ('sellerId' in r && (r as any).sellerId?.toLowerCase().includes(q)) return true;
      if ('courierName' in r && (r as any).courierName?.toLowerCase().includes(q)) return true;
      if ('awbNumber' in r && (r as any).awbNumber?.toLowerCase().includes(q)) return true;
      if ('expenseType' in r && (r as any).expenseType?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [active.rows, search]);

  /* ── CSV export ───────────────────────────────────────────── */

  const exportCsv = () => {
    if (visibleRows.length === 0) return;
    let headers: string[] = [];
    let lines: string[] = [];

    if (tab === 'seller_debit') {
      headers = ['Source Type', 'Source ID', 'Seller ID', 'Amount (INR)', 'Status', 'Reason', 'Created'];
      lines = (visibleRows as SellerDebitRow[]).map((r) =>
        [r.sourceType, r.sourceId, r.sellerId ?? '', (Number(r.amountInPaise) / 100).toFixed(2),
         r.status, csvQuote(r.reason), r.createdAt].join(','),
      );
    } else if (tab === 'logistics_claim') {
      headers = ['Source Type', 'Source ID', 'Courier', 'AWB', 'Amount (INR)', 'Status', 'Reason', 'Created'];
      lines = (visibleRows as LogisticsClaimRow[]).map((r) =>
        [r.sourceType, r.sourceId, csvQuote(r.courierName ?? ''), r.awbNumber ?? '',
         (Number(r.amountInPaise) / 100).toFixed(2), r.status,
         csvQuote(r.reason), r.createdAt].join(','),
      );
    } else {
      headers = ['Source Type', 'Source ID', 'Expense Type', 'Amount (INR)', 'Reason', 'Created'];
      lines = (visibleRows as PlatformExpenseRow[]).map((r) =>
        [r.sourceType, r.sourceId, r.expenseType, (Number(r.amountInPaise) / 100).toFixed(2),
         csvQuote(r.reason), r.createdAt].join(','),
      );
    }

    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `liability-ledger-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setSourceTypeFilter('');
    setSourceIdFilter('');
    setSearch('');
  };

  const hasFilters = !!(sourceTypeFilter || sourceIdFilter || search);

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={{ minWidth: 0 }}>
          <h1 style={styles.h1}>Liability ledger</h1>
          <p style={styles.headerSub}>
            Every cost that came from a dispute, return, or write-off. Track who owes what and what&apos;s still pending recovery.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={visibleRows.length === 0}
          style={{ ...styles.btnGhost, ...(visibleRows.length === 0 ? styles.disabled : {}) }}
          title="Export the currently visible tab to CSV"
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 3v10m0 0l-4-4m4 4l4-4M4 17h12"
            />
          </svg>
          Export CSV
        </button>
      </header>

      {/* KPI strip */}
      <div style={styles.kpiStrip}>
        <KpiCard
          label="Total recorded"
          value={fmtPaiseShort(kpis.totalAtRisk)}
          tone="neutral"
          hint="Sum across all three categories"
        />
        <KpiCard
          label="Seller debits pending"
          value={fmtPaiseShort(kpis.sellerDebitPending)}
          tone="warning"
          hint="Recoverable via settlement adjustments"
        />
        <KpiCard
          label="Logistics claims pending"
          value={fmtPaiseShort(kpis.logisticsClaimPending)}
          tone="info"
          hint="Awaiting courier reimbursement"
        />
        <KpiCard
          label="Platform expense"
          value={fmtPaiseShort(kpis.platformExpense)}
          tone="danger"
          hint="Absorbed by the platform — not recoverable"
        />
      </div>

      {/* Tabs */}
      <div style={styles.tabs} role="tablist" aria-label="Ledger category">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : {}) }}
          >
            {t.label} {tabData[t.key].total > 0 && (
              <span style={tab === t.key ? styles.tabCountActive : styles.tabCount}>
                {tabData[t.key].total}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div style={styles.filterBar}>
        <div style={styles.searchWrap}>
          <svg viewBox="0 0 20 20" style={styles.searchIcon} aria-hidden="true">
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
            placeholder="Search reason, source ID, seller, courier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
            aria-label="Search ledger"
          />
        </div>
        <select
          value={sourceTypeFilter}
          onChange={(e) => setSourceTypeFilter(e.target.value)}
          style={styles.select}
          aria-label="Filter by source type"
        >
          <option value="">All sources</option>
          <option value="DISPUTE">Disputes</option>
          <option value="RETURN">Returns</option>
          <option value="GOODWILL">Goodwill</option>
        </select>
        <input
          type="text"
          value={sourceIdFilter}
          onChange={(e) => setSourceIdFilter(e.target.value)}
          placeholder="Source ID (exact)"
          style={{ ...styles.select, minWidth: 220 }}
        />
        {hasFilters && (
          <button type="button" onClick={clearFilters} style={styles.btnGhost}>
            Clear
          </button>
        )}
      </div>

      {active.error && <div style={styles.errorBox}>{active.error}</div>}

      {/* Body */}
      <div style={styles.card}>
        {active.loading && active.rows.length === 0 ? (
          <SkeletonRows />
        ) : visibleRows.length === 0 ? (
          <div style={styles.empty}>
            {active.total === 0 ? (
              <>
                <div style={styles.emptyTitle}>Nothing here yet</div>
                <div style={styles.emptyBody}>
                  No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} have been
                  recorded. Records appear here automatically when disputes or returns
                  resolve.
                </div>
              </>
            ) : (
              <>
                <div style={styles.emptyTitle}>No rows match your filters</div>
                <div style={styles.emptyBody}>
                  Try clearing the search or source filter.
                </div>
              </>
            )}
          </div>
        ) : tab === 'seller_debit' ? (
          <SellerDebitTable rows={visibleRows as SellerDebitRow[]} />
        ) : tab === 'logistics_claim' ? (
          <LogisticsClaimTable rows={visibleRows as LogisticsClaimRow[]} />
        ) : (
          <PlatformExpenseTable rows={visibleRows as PlatformExpenseRow[]} />
        )}
      </div>

      <div style={styles.footer}>
        Showing <strong>{visibleRows.length}</strong>
        {visibleRows.length !== active.total && (
          <> of <strong>{active.total}</strong></>
        )}
        {active.total >= 50 && (
          <span style={{ color: '#94a3b8' }}> · capped at 50 per tab</span>
        )}
      </div>
    </div>
  );
}

/* ── KPI card ───────────────────────────────────────────────── */

function KpiCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: 'neutral' | 'warning' | 'info' | 'danger';
  hint: string;
}) {
  const colors = {
    neutral: '#0f172a',
    warning: '#b45309',
    info: '#1d4ed8',
    danger: '#b91c1c',
  };
  return (
    <div style={styles.kpiCard} title={hint}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color: colors[tone] }}>{value}</div>
      <div style={styles.kpiHint}>{hint}</div>
    </div>
  );
}

/* ── Tables ─────────────────────────────────────────────────── */

function SellerDebitTable({ rows }: { rows: SellerDebitRow[] }) {
  return (
    <div style={styles.tableScroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Source</th>
            <th style={styles.th}>Seller</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Reason</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={styles.tr}>
              <td style={styles.td}>
                <SourceCell sourceType={r.sourceType} sourceId={r.sourceId} orderId={r.orderId} />
              </td>
              <td style={styles.td}>
                <IdChip id={r.sellerId} />
              </td>
              <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {fmtPaise(r.amountInPaise)}
              </td>
              <td style={styles.td}>
                <StatusPill status={r.status} />
              </td>
              <td style={{ ...styles.td, color: '#475569', maxWidth: 360 }}>{r.reason}</td>
              <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <RelativeTime iso={r.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogisticsClaimTable({ rows }: { rows: LogisticsClaimRow[] }) {
  return (
    <div style={styles.tableScroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Source</th>
            <th style={styles.th}>Courier</th>
            <th style={styles.th}>AWB</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
            <th style={styles.th}>Status</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={styles.tr}>
              <td style={styles.td}>
                <SourceCell sourceType={r.sourceType} sourceId={r.sourceId} />
              </td>
              <td style={styles.td}>{r.courierName ?? <span style={styles.muted}>—</span>}</td>
              <td style={{ ...styles.td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>
                {r.awbNumber ?? <span style={styles.muted}>—</span>}
              </td>
              <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {fmtPaise(r.amountInPaise)}
              </td>
              <td style={styles.td}>
                <StatusPill status={r.status} />
              </td>
              <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <RelativeTime iso={r.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlatformExpenseTable({ rows }: { rows: PlatformExpenseRow[] }) {
  return (
    <div style={styles.tableScroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Source</th>
            <th style={styles.th}>Type</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
            <th style={styles.th}>Reason</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={styles.tr}>
              <td style={styles.td}>
                <SourceCell sourceType={r.sourceType} sourceId={r.sourceId} />
              </td>
              <td style={styles.td}>
                <span style={styles.typeChip}>{r.expenseType}</span>
              </td>
              <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                {fmtPaise(r.amountInPaise)}
              </td>
              <td style={{ ...styles.td, color: '#475569', maxWidth: 360 }}>{r.reason}</td>
              <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <RelativeTime iso={r.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Reusable cells ─────────────────────────────────────────── */

/**
 * Resolve the detail page a ledger row's source points at, using only the
 * IDs actually present on the row.
 *   DISPUTE         → sourceId IS the dispute id     → /dashboard/disputes/:id
 *   RETURN          → sourceId IS the return id      → /dashboard/returns/:id
 *   RTO / SELLER_REVERSAL / MANUAL → no dedicated route; the most useful
 *     existing view is the master order, which only seller-debit rows carry
 *     (orderId). Logistics/platform rows lack orderId → no link.
 *   GOODWILL / unknown → no reliable single target → no link (copy the id).
 */
function sourceHref(
  sourceType: string,
  sourceId: string,
  orderId?: string | null,
): string | null {
  switch (sourceType) {
    case 'DISPUTE':
      return `/dashboard/disputes/${sourceId}`;
    case 'RETURN':
      return `/dashboard/returns/${sourceId}`;
    case 'RTO':
    case 'SELLER_REVERSAL':
    case 'MANUAL':
      return orderId ? `/dashboard/orders/${orderId}` : null;
    default:
      return null;
  }
}

function SourceCell({
  sourceType,
  sourceId,
  orderId,
}: {
  sourceType: string;
  sourceId: string;
  orderId?: string | null;
}) {
  const [hover, setHover] = useState(false);
  const toneByType: Record<string, { bg: string; fg: string }> = {
    DISPUTE: { bg: '#fef2f2', fg: '#b91c1c' },
    RETURN: { bg: '#eff6ff', fg: '#1d4ed8' },
    GOODWILL: { bg: '#f0fdf4', fg: '#15803d' },
  };
  const t = toneByType[sourceType] ?? { bg: '#f1f5f9', fg: '#475569' };
  const href = sourceHref(sourceType, sourceId, orderId);
  const badge = (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        padding: '2px 6px',
        background: t.bg,
        color: t.fg,
        borderRadius: 4,
        letterSpacing: '0.04em',
      }}
    >
      {sourceType}
    </span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {href ? (
        <Link
          href={href}
          title={`View ${sourceType.replace(/_/g, ' ').toLowerCase()} details`}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: t.fg,
            textDecoration: hover ? 'underline' : 'none',
            textUnderlineOffset: 2,
          }}
        >
          {badge}
          <span aria-hidden style={{ fontSize: 11, fontWeight: 700 }}>↗</span>
        </Link>
      ) : (
        badge
      )}
      <IdChip id={sourceId} />
    </div>
  );
}

function IdChip({ id }: { id: string | null | undefined }) {
  if (!id) return <span style={styles.muted}>—</span>;
  const short = id.length > 10 ? id.slice(0, 8) + '…' : id;
  return (
    <button
      type="button"
      title={`Copy ${id}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(id);
      }}
      style={{
        fontSize: 11.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        background: 'transparent',
        border: 'none',
        padding: 0,
        color: '#475569',
        cursor: 'pointer',
      }}
    >
      {short}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  // Normalize to a known tone. Defaults to "neutral" for unknown values
  // so we don't crash if the backend adds a new status.
  const map: Record<string, { dot: string; bg: string; fg: string }> = {
    PENDING:   { dot: '#d97706', bg: '#fffbeb', fg: '#b45309' },
    SETTLED:   { dot: '#16a34a', bg: '#f0fdf4', fg: '#15803d' },
    RESOLVED:  { dot: '#16a34a', bg: '#f0fdf4', fg: '#15803d' },
    APPROVED:  { dot: '#16a34a', bg: '#f0fdf4', fg: '#15803d' },
    REJECTED:  { dot: '#dc2626', bg: '#fef2f2', fg: '#b91c1c' },
    DENIED:    { dot: '#dc2626', bg: '#fef2f2', fg: '#b91c1c' },
    CANCELLED: { dot: '#94a3b8', bg: '#f1f5f9', fg: '#475569' },
  };
  const p = map[status] ?? { dot: '#94a3b8', bg: '#f1f5f9', fg: '#475569' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px 3px 8px',
        fontSize: 11.5,
        fontWeight: 600,
        borderRadius: 999,
        background: p.bg,
        color: p.fg,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }} />
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) return <span style={styles.muted}>—</span>;
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  let rel: string;
  if (mins < 1) rel = 'just now';
  else if (mins < 60) rel = `${mins}m ago`;
  else if (hrs < 24) rel = `${hrs}h ago`;
  else if (days < 7) rel = `${days}d ago`;
  else if (weeks < 5) rel = `${weeks}w ago`;
  else rel = `${months}mo ago`;
  const absolute = d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <span title={absolute} style={{ fontSize: 12, color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
      {rel}
    </span>
  );
}

/* ── Skeleton ──────────────────────────────────────────────── */

function SkeletonRows() {
  return (
    <div style={{ padding: 14 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 0',
            borderBottom: i === 4 ? 'none' : '1px solid #f1f5f9',
          }}
        >
          <div style={{ ...styles.skel, width: 120, height: 14 }} />
          <div style={{ ...styles.skel, width: 100, height: 14 }} />
          <div style={{ ...styles.skel, width: 80, height: 14 }} />
          <div style={{ ...styles.skel, width: 60, height: 20, borderRadius: 999 }} />
          <div style={{ ...styles.skel, flex: 1, height: 14 }} />
          <div style={{ ...styles.skel, width: 60, height: 14 }} />
        </div>
      ))}
      <style>{`@keyframes liab-shimmer { 0%{background-position:-400px 0} 100%{background-position:400px 0} }`}</style>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────── */

function fmtPaise(amountInPaise: string | number): string {
  const rupees = Number(amountInPaise) / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPaiseShort(amountInPaise: number): string {
  const rupees = amountInPaise / 100;
  // For KPIs: show whole-rupee values without decimals to keep the tile clean.
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function csvQuote(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/* ── Styles ─────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: '24px 32px',
    maxWidth: 1280,
    margin: '0 auto',
    color: '#0f172a',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },

  /* Header */
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  h1: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  headerSub: {
    margin: '4px 0 0',
    fontSize: 13,
    color: '#64748b',
    maxWidth: 640,
    lineHeight: 1.5,
  },
  btnGhost: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 38,
    padding: '0 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  disabled: { opacity: 0.6, cursor: 'not-allowed' },

  /* KPI strip */
  kpiStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
    marginBottom: 20,
  },
  kpiCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '14px 16px',
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em',
    lineHeight: 1.1,
    marginTop: 6,
  },
  kpiHint: {
    fontSize: 11.5,
    color: '#94a3b8',
    marginTop: 6,
    lineHeight: 1.4,
  },

  /* Tabs */
  tabs: {
    display: 'flex',
    gap: 4,
    borderBottom: '1px solid #e2e8f0',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 38,
    padding: '0 14px',
    fontSize: 13,
    fontWeight: 500,
    color: '#64748b',
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    marginBottom: -1,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tabActive: {
    color: '#0f172a',
    borderBottom: '2px solid #0f172a',
    fontWeight: 600,
  },
  tabCount: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 18,
    padding: '0 6px',
    fontSize: 10.5,
    fontWeight: 700,
    background: '#f1f5f9',
    color: '#64748b',
    borderRadius: 999,
  },
  tabCountActive: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 18,
    padding: '0 6px',
    fontSize: 10.5,
    fontWeight: 700,
    background: '#0f172a',
    color: '#fff',
    borderRadius: 999,
  },

  /* Filter bar */
  filterBar: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  searchWrap: {
    position: 'relative',
    flex: '1 1 280px',
    minWidth: 240,
    maxWidth: 420,
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
    fontSize: 13.5,
    color: '#0f172a',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  select: {
    height: 38,
    padding: '0 12px',
    fontSize: 13.5,
    color: '#0f172a',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minWidth: 150,
  },

  /* Body */
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    overflow: 'hidden',
  },
  errorBox: {
    padding: '10px 14px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 13,
  },

  /* Table */
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    background: '#f8fafc',
    borderBottom: '1px solid #e2e8f0',
    whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '14px 16px', verticalAlign: 'middle', color: '#0f172a' },
  muted: { color: '#94a3b8' },
  typeChip: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    background: '#f1f5f9',
    color: '#475569',
    borderRadius: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },

  /* Empty */
  empty: { padding: '56px 24px', textAlign: 'center' },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: '#0f172a' },
  emptyBody: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 6,
    maxWidth: 420,
    margin: '6px auto 0',
    lineHeight: 1.5,
  },

  footer: {
    marginTop: 14,
    fontSize: 12.5,
    color: '#475569',
    fontVariantNumeric: 'tabular-nums',
  },

  /* Skeleton */
  skel: {
    display: 'block',
    borderRadius: 4,
    background:
      'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 37%, #f1f5f9 63%) 0 0 / 800px 100%',
    animation: 'liab-shimmer 1.2s ease-in-out infinite',
  },
};
