'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  adminProcurementService,
  AdminProcurementListResponse,
  PROCUREMENT_STATUSES,
  statusPalette,
} from '@/services/admin-procurement.service';
import { ApiError } from '@/lib/api-client';

function formatINR(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return '\u20B9' + Math.round(v).toLocaleString('en-IN');
}

function formatDate(iso: string | null): string {
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

export default function AdminProcurementListPage() {
  const [data, setData] = useState<AdminProcurementListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminProcurementService.list({
        page,
        limit: 20,
        status: status || undefined,
        search: search.trim() || undefined,
      });
      if (res.data) setData(res.data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.body.message || 'Failed to load' : 'Failed to load',
      );
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pendingApproval =
    data?.requests.filter((r) => r.status === 'SUBMITTED').length ?? 0;
  const inTransit =
    data?.requests.filter((r) => r.status === 'DISPATCHED').length ?? 0;
  const awaitingSettle =
    data?.requests.filter(
      (r) => r.status === 'RECEIVED' || r.status === 'PARTIALLY_RECEIVED',
    ).length ?? 0;

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
          Procurement
        </h1>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          Review, approve, dispatch and settle franchise procurement requests
        </p>
      </div>

      {/* KPI strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <KpiCard
          label="Pending approval"
          value={String(pendingApproval)}
          hint="SUBMITTED requests"
          color="#f59e0b"
        />
        <KpiCard
          label="In transit"
          value={String(inTransit)}
          hint="Awaiting franchise receipt"
          color="#0ea5e9"
        />
        <KpiCard
          label="Awaiting settlement"
          value={String(awaitingSettle)}
          hint="RECEIVED / PARTIAL"
          color="#16a34a"
        />
        <KpiCard
          label="Total records"
          value={data ? String(data.pagination.total) : '\u2014'}
          hint="Matching current filters"
          color="#6366f1"
        />
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="Search request # or franchise"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setPage(1);
              fetchData();
            }
          }}
          style={{
            padding: '9px 12px',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            minWidth: 280,
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          style={{
            padding: '9px 12px',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            minWidth: 180,
          }}
        >
          <option value="">All statuses</option>
          {PROCUREMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setPage(1);
            fetchData();
          }}
          disabled={loading}
        >
          {loading ? 'Loading\u2026' : 'Apply'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setSearch('');
            setStatus('');
            setPage(1);
          }}
        >
          Reset
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#fef2f2',
            color: '#b91c1c',
            border: '1px solid #fecaca',
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Table */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {loading && !data ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>
            Loading\u2026
          </div>
        ) : data && data.requests.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>
            No procurement requests match the current filters
          </div>
        ) : (
          <table
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                <Th>Request #</Th>
                <Th>Franchise</Th>
                <Th>Status</Th>
                <Th alignRight>Items</Th>
                <Th alignRight>Payable</Th>
                <Th>Created</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data?.requests.map((r) => {
                const palette = statusPalette(r.status);
                const itemCount = r.items?.length ?? 0;
                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                    }}
                  >
                    <Td>
                      <Link
                        href={`/dashboard/procurement/${r.id}`}
                        style={{
                          fontFamily: 'monospace',
                          fontSize: 12,
                          color: '#2563eb',
                          textDecoration: 'none',
                        }}
                      >
                        {r.requestNumber}
                      </Link>
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 500 }}>
                        {r.franchise?.businessName ?? r.franchiseCode ?? '\u2014'}
                      </div>
                      {r.franchise?.ownerName && (
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                          {r.franchise.ownerName}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 999,
                          background: palette.bg,
                          color: palette.color,
                        }}
                      >
                        {r.status}
                      </span>
                    </Td>
                    <Td alignRight>{itemCount}</Td>
                    <Td alignRight>
                      <span style={{ fontFamily: 'monospace' }}>
                        {formatINR(r.finalPayableAmount)}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: '#6b7280' }}>
                        {formatDate(r.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      <Link
                        href={`/dashboard/procurement/${r.id}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Open
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

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

function Th({
  children,
  alignRight,
}: {
  children?: React.ReactNode;
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

function Td({
  children,
  alignRight,
}: {
  children?: React.ReactNode;
  alignRight?: boolean;
}) {
  return (
    <td
      style={{
        padding: '12px 14px',
        verticalAlign: 'middle',
        textAlign: alignRight ? 'right' : 'left',
      }}
    >
      {children}
    </td>
  );
}

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
      <div style={{ fontSize: 24, fontWeight: 700, color: '#111827', lineHeight: 1.2 }}>
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}
