'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  sellerDisputesService,
  Dispute,
  DisputeStatus,
  STATUS_COLOR,
  STATUS_LABEL,
  KIND_LABEL,
} from '@/services/disputes.service';
import { ApiError } from '@/lib/api-client';
import { useSseStream } from '@sportsmart/ui';

const STATUS_OPTIONS: Array<{ value: DisputeStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'OPEN', label: 'Open' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'AWAITING_INFO', label: 'Awaiting info' },
  { value: 'RESOLVED_BUYER', label: 'Resolved (buyer)' },
  { value: 'RESOLVED_SELLER', label: 'Resolved (seller)' },
  { value: 'RESOLVED_SPLIT', label: 'Resolved (split)' },
  { value: 'CLOSED', label: 'Closed' },
];

const PAGE_SIZE = 20;

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

const truncate = (s: string, n: number) =>
  s.length > n ? s.slice(0, n - 1) + '…' : s;

export default function SellerDisputesListPage() {
  const router = useRouter();
  const [items, setItems] = useState<Dispute[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<DisputeStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Stable across renders so the strict-mode double-invoke doesn't fire two requests.
  const reqId = useRef(0);

  const fetchData = useCallback(
    async (override?: { page?: number; status?: DisputeStatus | '' }) => {
      const id = ++reqId.current;
      setLoading(true);
      setError('');
      try {
        const res = await sellerDisputesService.list({
          page: override?.page ?? page,
          limit: PAGE_SIZE,
          status: override?.status ?? statusFilter,
        });
        if (id !== reqId.current) return; // stale response — drop it
        if (res.data) {
          setItems(res.data.items);
          setTotal(res.data.total);
        }
      } catch (err) {
        if (id !== reqId.current) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.body?.message || 'Failed to load disputes'
            : 'Failed to load disputes',
        );
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [page, statusFilter, router],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Live updates over the seller dispute SSE stream — refetch the list on
  // any dispute change instead of polling.
  useSseStream('/portal/streams/seller-disputes', {
    onMessage: () => {
      fetchData();
    },
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          Disputes
        </h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
          Customer disputes against your orders, and disputes you have filed.
          Respond within 72 hours to keep your seller score healthy.
        </p>
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 16,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280' }}>
          Status
        </label>
        <select
          value={statusFilter}
          onChange={(e) => {
            const next = e.target.value as DisputeStatus | '';
            setStatusFilter(next);
            setPage(1);
            fetchData({ status: next, page: 1 });
          }}
          style={{
            padding: '8px 10px',
            fontSize: 13,
            border: '1px solid #d1d5db',
            borderRadius: 6,
            background: '#fff',
            minWidth: 200,
          }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
          {total > 0
            ? `Showing ${showingFrom}–${showingTo} of ${total}`
            : null}
        </div>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          {error}
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
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  background: '#f9fafb',
                  borderBottom: '2px solid #e5e7eb',
                }}
              >
                <th style={th}>Dispute</th>
                <th style={th}>Kind</th>
                <th style={th}>Filed by</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Severity</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      ...td,
                      textAlign: 'center',
                      color: '#6b7280',
                      padding: 40,
                    }}
                  >
                    Loading disputes…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      ...td,
                      textAlign: 'center',
                      color: '#6b7280',
                      padding: 60,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                      No disputes {statusFilter ? 'match this filter' : 'yet'}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      {statusFilter
                        ? 'Try clearing the status filter.'
                        : 'Disputes raised against your orders will appear here.'}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((d) => {
                  const color = STATUS_COLOR[d.status];
                  const filedByYou = d.filedByType === 'SELLER';
                  return (
                    <tr
                      key={d.id}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer',
                      }}
                      onClick={() => router.push(`/dashboard/disputes/${d.id}`)}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = '#f9fafb')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = '#fff')
                      }
                    >
                      <td style={td}>
                        <div
                          style={{
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 11,
                            color: '#6b7280',
                            marginBottom: 2,
                          }}
                        >
                          {d.disputeNumber}
                        </div>
                        <Link
                          href={`/dashboard/disputes/${d.id}`}
                          style={{
                            color: '#111827',
                            fontWeight: 600,
                            textDecoration: 'none',
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {truncate(d.summary, 70)}
                        </Link>
                      </td>
                      <td style={td}>{KIND_LABEL[d.kind]}</td>
                      <td style={td}>
                        <div>{d.filedByName}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>
                          {filedByYou ? 'You' : d.filedByType.toLowerCase()}
                        </div>
                      </td>
                      <td style={td}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '3px 9px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            background: color.bg,
                            color: color.fg,
                          }}
                        >
                          {STATUS_LABEL[d.status]}
                        </span>
                      </td>
                      <td
                        style={{
                          ...td,
                          textAlign: 'right',
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: 12,
                        }}
                      >
                        {d.severity}
                      </td>
                      <td style={{ ...td, color: '#6b7280', fontSize: 12 }}>
                        {fmtDate(d.createdAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            marginTop: 20,
          }}
        >
          <button
            disabled={page <= 1 || loading}
            onClick={() => {
              const next = page - 1;
              setPage(next);
              fetchData({ page: next });
            }}
            style={pageBtn}
          >
            Previous
          </button>
          <span
            style={{
              padding: '8px 12px',
              fontSize: 13,
              color: '#374151',
            }}
          >
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              fetchData({ page: next });
            }}
            style={pageBtn}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 14px',
  fontWeight: 600,
  fontSize: 10,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '14px',
  verticalAlign: 'middle',
};

const pageBtn: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
  color: '#374151',
};
