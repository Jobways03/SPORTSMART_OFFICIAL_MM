'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  sellerReturnsService,
  SellerReturn,
} from '@/services/returns.service';

// Mirrors the ReturnStatus enum in the backend. Labels here drive the
// dropdown filter and the colored pill in the list view.
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'REQUESTED', label: 'Requested' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SHIPPED', label: 'Shipped back' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'QC_IN_PROGRESS', label: 'QC in progress' },
  { value: 'QC_APPROVED', label: 'QC approved' },
  { value: 'QC_REJECTED', label: 'QC rejected' },
  { value: 'PARTIALLY_APPROVED', label: 'Partially approved' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  REQUESTED: { bg: '#e0e7ff', fg: '#3730a3' },
  APPROVED: { bg: '#dbeafe', fg: '#1d4ed8' },
  SHIPPED: { bg: '#fef3c7', fg: '#92400e' },
  RECEIVED: { bg: '#fed7aa', fg: '#9a3412' },
  QC_IN_PROGRESS: { bg: '#fef3c7', fg: '#92400e' },
  QC_APPROVED: { bg: '#dcfce7', fg: '#15803d' },
  QC_REJECTED: { bg: '#fee2e2', fg: '#991b1b' },
  PARTIALLY_APPROVED: { bg: '#fde68a', fg: '#78350f' },
  COMPLETED: { bg: '#dcfce7', fg: '#15803d' },
  CANCELLED: { bg: '#e5e7eb', fg: '#374151' },
};

const labelFor = (status: string) =>
  STATUS_OPTIONS.find((o) => o.value === status)?.label ??
  status.replace(/_/g, ' ');

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '\u2014';
  }
};

const fmtInr = (v: number | string | null | undefined) =>
  v == null ? '\u2014' : `\u20B9${Number(v).toLocaleString('en-IN')}`;

export default function SellerReturnsListPage() {
  const [returns, setReturns] = useState<SellerReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await sellerReturnsService.list({
        page,
        limit: 20,
        status: status || undefined,
      });
      setReturns(res.data?.returns ?? []);
      setTotalPages(res.data?.pagination?.totalPages ?? 1);
    } catch (err) {
      setError(
        (err as any)?.body?.message ||
          (err as Error)?.message ||
          'Failed to load returns',
      );
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Returns</h1>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          Track customer returns, receive packages, and submit QC decisions.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          style={{
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 13,
            background: '#fff',
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            color: '#991b1b',
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{error}</span>
          <button
            onClick={load}
            style={{
              background: 'transparent',
              color: '#991b1b',
              border: '1px solid #991b1b',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading...</div>
        ) : returns.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>
            {status ? `No returns with status "${labelFor(status)}"` : 'No returns yet'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['Return #', 'Order', 'Items', 'Refund', 'Status', 'Requested'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 14px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => {
                const color = STATUS_COLORS[r.status] ?? { bg: '#e5e7eb', fg: '#374151' };
                const itemCount = r.items?.length ?? 0;
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                    }}
                    onClick={() =>
                      (window.location.href = `/dashboard/returns/${r.id}`)
                    }
                  >
                    <td style={{ padding: '10px 14px', fontWeight: 500 }}>
                      <Link
                        href={`/dashboard/returns/${r.id}`}
                        style={{ color: '#2563eb', textDecoration: 'none' }}
                      >
                        {r.returnNumber}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#374151' }}>
                      {r.masterOrder?.orderNumber ?? '\u2014'}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#374151' }}>{itemCount}</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>
                      {fmtInr(r.refundAmount)}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: color.bg,
                          color: color.fg,
                        }}
                      >
                        {labelFor(r.status)}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: '#6b7280', fontSize: 12 }}>
                      {fmtDate(r.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              cursor: page <= 1 ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            Prev
          </button>
          <span style={{ padding: '8px 12px', fontSize: 13 }}>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              cursor: page >= totalPages ? 'default' : 'pointer',
              fontSize: 13,
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
