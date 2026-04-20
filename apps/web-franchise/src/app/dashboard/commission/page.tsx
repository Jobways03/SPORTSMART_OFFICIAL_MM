'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  franchiseCommissionService,
  FranchiseCommissionRecord,
  CommissionListResponse,
} from '@/services/commission.service';
import { ApiError } from '@/lib/api-client';

const STATUS_OPTIONS = ['PENDING', 'ACCRUED', 'SETTLED', 'REVERSED'];

function formatINR(n: number): string {
  return '\u20B9' + Math.round(n).toLocaleString('en-IN');
}

function formatDate(iso: string): string {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function statusBadgeStyle(status: string): React.CSSProperties {
  const map: Record<string, { bg: string; color: string }> = {
    PENDING: { bg: '#fef3c7', color: '#92400e' },
    ACCRUED: { bg: '#dbeafe', color: '#1e40af' },
    SETTLED: { bg: '#dcfce7', color: '#15803d' },
    REVERSED: { bg: '#fee2e2', color: '#b91c1c' },
  };
  const c = map[status] ?? { bg: '#f3f4f6', color: '#6b7280' };
  return {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 999,
    letterSpacing: 0.3,
    background: c.bg,
    color: c.color,
  };
}

export default function FranchiseCommissionPage() {
  const [data, setData] = useState<CommissionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchData = useCallback(
    async (p: number) => {
      setLoading(true);
      setError('');
      try {
        const res = await franchiseCommissionService.list({
          page: p,
          limit: 20,
          status: statusFilter || undefined,
          search: search.trim() || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        });
        if (res.data) setData(res.data);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.body.message || 'Failed to load commission records');
        } else {
          setError('Failed to load commission records');
        }
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter, fromDate, toDate],
  );

  useEffect(() => {
    fetchData(page);
  }, [fetchData, page]);

  // Derived summary across the current page (not total — total is global
  // which requires a separate aggregate query; keeps this page lightweight).
  const pageTotals = data?.records.reduce(
    (acc, r) => {
      acc.base += r.baseAmount;
      acc.earned += r.franchiseEarning;
      acc.platform += r.platformEarning;
      return acc;
    },
    { base: 0, earned: 0, platform: 0 },
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Commission</h1>
          <p>Per-order commission records for your online fulfillment</p>
        </div>
      </div>

      {/* KPI strip — summary of the current page */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <KpiCard
          label="Total records"
          value={data ? String(data.pagination.total) : '\u2014'}
          hint="All commission records on file"
          color="#6366f1"
        />
        <KpiCard
          label="Orders on this page"
          value={data ? String(data.records.length) : '\u2014'}
          hint={data ? `Showing page ${data.pagination.page} of ${data.pagination.totalPages}` : ''}
          color="#f59e0b"
        />
        <KpiCard
          label="Your earning (this page)"
          value={pageTotals ? formatINR(pageTotals.earned) : '\u2014'}
          hint={
            pageTotals && pageTotals.platform
              ? `Platform took ${formatINR(pageTotals.platform)}`
              : ''
          }
          color="#16a34a"
        />
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <div className="field">
            <label htmlFor="search">Search order #</label>
            <input
              id="search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. SM-ORD-000123"
            />
          </div>
          <div className="field">
            <label htmlFor="status">Status</label>
            <select
              id="status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="fromDate">From</label>
            <input
              id="fromDate"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="toDate">To</label>
            <input
              id="toDate"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setPage(1);
                fetchData(1);
              }}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Apply'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setFromDate('');
                setToDate('');
                setPage(1);
              }}
              disabled={loading}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Records table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && !data ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#6b7280' }}>
            Loading commission records…
          </div>
        ) : data && data.records.length === 0 ? (
          <div
            style={{
              padding: '56px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 999,
                background: '#eef2ff',
                color: '#4f46e5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
              }}
            >
              &#128202;
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: '#111827',
              }}
            >
              No commission records yet
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#6b7280',
                maxWidth: 460,
                lineHeight: 1.5,
              }}
            >
              Delivered online orders past the 7-day return window will appear
              here once commission is processed. POS sales are tracked
              separately on the Earnings page.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                  <Th>Order #</Th>
                  <Th>Date</Th>
                  <Th>Product</Th>
                  <Th alignRight>Qty</Th>
                  <Th alignRight>Base</Th>
                  <Th alignRight>Rate</Th>
                  <Th alignRight>Commission</Th>
                  <Th alignRight>Your earning</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data?.records.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.pagination.totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 14,
              borderTop: '1px solid #e5e7eb',
              fontSize: 13,
              color: '#6b7280',
            }}
          >
            <span>
              Page {data.pagination.page} of {data.pagination.totalPages} &middot;{' '}
              {data.pagination.total} total
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={data.pagination.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={
                  data.pagination.page >= data.pagination.totalPages || loading
                }
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ r }: { r: FranchiseCommissionRecord }) {
  const productLabel =
    r.itemCount > 1
      ? `${r.productTitle} + ${r.itemCount - 1} more`
      : r.productTitle;
  return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      <td style={tdStyle}>
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {r.orderNumber}
        </span>
      </td>
      <td style={tdStyle}>{formatDate(r.createdAt)}</td>
      <td style={tdStyle}>
        <div style={{ fontWeight: 500 }}>{productLabel}</div>
        {r.variantTitle && (
          <div style={{ fontSize: 12, color: '#6b7280' }}>{r.variantTitle}</div>
        )}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>{r.totalQuantity}</td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
        {formatINR(r.baseAmount)}
      </td>
      <td style={{ ...tdStyle, textAlign: 'right' }}>{r.rate}%</td>
      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
        {formatINR(r.computedAmount)}
      </td>
      <td
        style={{
          ...tdStyle,
          textAlign: 'right',
          fontFamily: 'monospace',
          fontWeight: 600,
          color: '#15803d',
        }}
      >
        {formatINR(r.franchiseEarning)}
      </td>
      <td style={tdStyle}>
        <span style={statusBadgeStyle(r.status)}>{r.status}</span>
      </td>
    </tr>
  );
}

function Th({
  children,
  alignRight,
}: {
  children: React.ReactNode;
  alignRight?: boolean;
}) {
  return (
    <th
      style={{
        textAlign: alignRight ? 'right' : 'left',
        padding: '12px 14px',
        fontSize: 11,
        fontWeight: 600,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {children}
    </th>
  );
}

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  verticalAlign: 'middle',
  color: '#111827',
};

function KpiCard({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderLeft: `4px solid ${color}`,
        borderRadius: 12,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#6b7280',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: '#111827',
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
