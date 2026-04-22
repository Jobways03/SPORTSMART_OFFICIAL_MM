'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminReturnsService,
  ReturnListItem,
  ReturnStatus,
} from '@/services/admin-returns.service';

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

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  REQUESTED: { bg: '#fef3c7', color: '#92400e' },
  APPROVED: { bg: '#dbeafe', color: '#1e40af' },
  REJECTED: { bg: '#fee2e2', color: '#991b1b' },
  PICKUP_SCHEDULED: { bg: '#e0e7ff', color: '#3730a3' },
  IN_TRANSIT: { bg: '#e0e7ff', color: '#3730a3' },
  RECEIVED: { bg: '#ccfbf1', color: '#115e59' },
  QC_APPROVED: { bg: '#d1fae5', color: '#065f46' },
  QC_REJECTED: { bg: '#fee2e2', color: '#991b1b' },
  PARTIALLY_APPROVED: { bg: '#fef3c7', color: '#92400e' },
  REFUND_PROCESSING: { bg: '#e0e7ff', color: '#3730a3' },
  REFUNDED: { bg: '#d1fae5', color: '#065f46' },
  COMPLETED: { bg: '#d1fae5', color: '#065f46' },
  CANCELLED: { bg: '#f3f4f6', color: '#374151' },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] || { bg: '#f3f4f6', color: '#374151' };
  const label = status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

export default function AdminReturnsListPage() {
  const [loading, setLoading] = useState(true);
  const [returns, setReturns] = useState<ReturnListItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchReturns = useCallback(async (page: number) => {
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
  }, [search, statusFilter, fromDate, toDate]);

  useEffect(() => {
    fetchReturns(1);
  }, [fetchReturns]);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const fmtCurrency = (v: string | number | null | undefined) => {
    if (v == null || v === '') return '--';
    return `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const customerName = (r: ReturnListItem) => {
    const c = r.customer;
    if (!c) return 'Unknown';
    return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown';
  };

  const hasFilters = !!(search || statusFilter || fromDate || toDate);
  const handleClear = () => {
    setSearch('');
    setStatusFilter('');
    setFromDate('');
    setToDate('');
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Returns</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
          Review, approve, and process customer returns.
        </p>
      </div>

      {/* Filters */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: '16px 20px',
          marginBottom: 20,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div style={{ flex: '1 1 220px' }}>
          <label style={labelStyle}>Search</label>
          <input
            type="text"
            placeholder="Return #, order #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchReturns(1)}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: '0 1 180px' }}>
          <label style={labelStyle}>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={inputStyle}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s
                  .toLowerCase()
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, (ch) => ch.toUpperCase())}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '0 1 160px' }}>
          <label style={labelStyle}>From Date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: '0 1 160px' }}>
          <label style={labelStyle}>To Date</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, paddingBottom: 1 }}>
          <button onClick={() => fetchReturns(1)} style={primaryBtn}>
            Apply
          </button>
          {hasFilters && (
            <button
              onClick={handleClear}
              style={{
                ...primaryBtn,
                background: '#fff',
                color: '#374151',
                border: '1px solid #d1d5db',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <Th>Return #</Th>
                <Th>Order #</Th>
                <Th>Customer</Th>
                <Th>Items</Th>
                <Th>Refund</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
                    Loading returns...
                  </td>
                </tr>
              ) : returns.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 60, textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>
                      No returns {hasFilters ? 'match your filters' : 'yet'}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>
                      {hasFilters
                        ? 'Try adjusting the filters above.'
                        : 'Returns submitted by customers will appear here.'}
                    </div>
                  </td>
                </tr>
              ) : (
                returns.map((r, i) => (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      background: i % 2 === 0 ? '#fff' : '#fafbfc',
                    }}
                  >
                    <td style={tdStyle}>
                      <strong>{r.returnNumber}</strong>
                    </td>
                    <td style={tdStyle}>
                      {r.masterOrder?.orderNumber ?? r.subOrder?.masterOrder?.orderNumber ?? '--'}
                    </td>
                    <td style={tdStyle}>
                      <div>{customerName(r)}</div>
                      {r.customer?.email && (
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>{r.customer.email}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{r.items?.length ?? 0}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                      {fmtCurrency(r.refundAmount)}
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={tdStyle}>{fmtDate(r.createdAt)}</td>
                    <td style={tdStyle}>
                      <Link
                        href={`/dashboard/returns/${r.id}`}
                        style={{
                          color: '#2563eb',
                          textDecoration: 'none',
                          fontWeight: 600,
                        }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button
            disabled={pagination.page <= 1}
            onClick={() => fetchReturns(pagination.page - 1)}
            style={pageBtn}
          >
            Previous
          </button>
          <span style={{ padding: '8px 12px', fontSize: 14 }}>
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => fetchReturns(pagination.page + 1)}
            style={pageBtn}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '12px 14px',
        fontSize: 11,
        fontWeight: 600,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  outline: 'none',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  verticalAlign: 'middle',
};

const pageBtn: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};
