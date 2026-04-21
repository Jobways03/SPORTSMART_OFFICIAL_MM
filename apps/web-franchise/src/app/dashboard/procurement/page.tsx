'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  franchiseProcurementService,
  ProcurementRequest,
  getProcurementStatusColor,
  getProcurementStatusLabel,
  formatProcurementCurrency,
  formatProcurementDate,
} from '@/services/procurement.service';
import { ApiError } from '@/lib/api-client';

const STATUS_OPTIONS = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'REJECTED',
  'SOURCING',
  'DISPATCHED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'SETTLED',
  'CANCELLED',
];

const IN_PROGRESS_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'DISPATCHED'];

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function ProcurementListPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ProcurementRequest[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // KPI counts (loaded with an unfiltered request — we count from all pages using list endpoint)
  const [kpi, setKpi] = useState({
    total: 0,
    inProgress: 0,
    awaitingReceipt: 0,
    settled: 0,
  });

  const fetchRequests = useCallback(
    async (page: number, status: string) => {
      setLoading(true);
      setError('');
      try {
        const res = await franchiseProcurementService.list({
          page,
          limit: 20,
          status: status || undefined,
        });
        if (res.data) {
          setRequests(res.data.requests);
          setPagination(res.data.pagination);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Failed to load procurement requests. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  const fetchKpi = useCallback(async () => {
    try {
      const res = await franchiseProcurementService.list({ page: 1, limit: 100 });
      if (res.data) {
        const all = res.data.requests;
        setKpi({
          total: res.data.pagination.total,
          inProgress: all.filter((r) => IN_PROGRESS_STATUSES.includes(r.status)).length,
          awaitingReceipt: all.filter((r) => r.status === 'DISPATCHED').length,
          settled: all.filter((r) => r.status === 'SETTLED').length,
        });
      }
    } catch {
      // KPIs are best-effort
    }
  }, []);

  useEffect(() => {
    fetchRequests(1, statusFilter);
  }, [fetchRequests, statusFilter]);

  useEffect(() => {
    fetchKpi();
  }, [fetchKpi]);

  const handlePageChange = (page: number) => {
    fetchRequests(page, statusFilter);
  };

  const renderStatusBadge = (status: string) => {
    const color = getProcurementStatusColor(status);
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '4px 10px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.4px',
          background: `${color}15`,
          color,
          border: `1px solid ${color}40`,
          whiteSpace: 'nowrap',
        }}
      >
        {getProcurementStatusLabel(status)}
      </span>
    );
  };

  const renderKpiCards = () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
        marginBottom: 24,
      }}
    >
      {[
        { label: 'Total Requests', value: kpi.total, color: '#2563eb', bg: '#eff6ff' },
        { label: 'In Progress', value: kpi.inProgress, color: '#7c3aed', bg: '#faf5ff' },
        { label: 'Awaiting Receipt', value: kpi.awaitingReceipt, color: '#d97706', bg: '#fffbeb' },
        { label: 'Settled', value: kpi.settled, color: '#16a34a', bg: '#f0fdf4' },
      ].map((card) => (
        <div
          key={card.label}
          style={{
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 6,
            }}
          >
            {card.label}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: card.color }}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Procurement Requests</h1>
          <p>Create and track requests to restock your inventory</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => router.push('/dashboard/procurement/new')}
        >
          + New Request
        </button>
      </div>

      {renderKpiCards()}

      {/* Filters */}
      <div
        className="card"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          padding: 16,
        }}
      >
        <label
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          Status
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '8px 12px',
            fontSize: 14,
            border: '1px solid #d1d5db',
            borderRadius: 8,
            background: '#fff',
            minWidth: 200,
          }}
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {getProcurementStatusLabel(s)}
            </option>
          ))}
        </select>
        {statusFilter && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ minHeight: 36, padding: '6px 12px' }}
            onClick={() => setStatusFilter('')}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
            Loading...
          </div>
        ) : error ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ color: '#dc2626', marginBottom: 12 }}>{error}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fetchRequests(pagination.page, statusFilter)}
            >
              Retry
            </button>
          </div>
        ) : requests.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#128230;</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
              No procurement requests yet
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Click &quot;New Request&quot; to start replenishing your stock.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => router.push('/dashboard/procurement/new')}
            >
              + New Request
            </button>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 14,
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: '#f9fafb',
                      borderBottom: '1px solid #e5e7eb',
                    }}
                  >
                    {[
                      'Request #',
                      'Items',
                      'Total Requested',
                      'Final Payable',
                      'Status',
                      'Created',
                      'Actions',
                    ].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: '12px 16px',
                          textAlign: 'left',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#6b7280',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr
                      key={req.id}
                      onClick={() => router.push(`/dashboard/procurement/${req.id}`)}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = '#f9fafb')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = 'transparent')
                      }
                    >
                      <td style={{ padding: '14px 16px', fontWeight: 600, color: '#111827' }}>
                        {req.requestNumber}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#374151' }}>
                        {req.items?.length ?? 0}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#374151' }}>
                        {formatProcurementCurrency(req.totalRequestedAmount)}
                      </td>
                      <td style={{ padding: '14px 16px', color: '#111827', fontWeight: 600 }}>
                        {req.finalPayableAmount > 0
                          ? formatProcurementCurrency(req.finalPayableAmount)
                          : '—'}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {renderStatusBadge(req.status)}
                        {/*
                         * Status subtitle — timestamp + tracking for the
                         * most-relevant milestone. Prior list view showed
                         * only the status chip for a DISPATCHED request,
                         * so the franchise had no dispatch date or carrier
                         * without drilling into the detail page.
                         */}
                        {(() => {
                          if (req.status === 'DISPATCHED' && req.dispatchedAt) {
                            const carrier = req.carrierName || req.trackingNumber;
                            return (
                              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                {formatProcurementDate(req.dispatchedAt)}
                                {carrier ? ` \u00B7 ${carrier}` : ''}
                              </div>
                            );
                          }
                          if (
                            (req.status === 'RECEIVED' || req.status === 'PARTIALLY_RECEIVED') &&
                            req.receivedAt
                          ) {
                            return (
                              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                Received {formatProcurementDate(req.receivedAt)}
                              </div>
                            );
                          }
                          if (req.status === 'APPROVED' && req.approvedAt) {
                            return (
                              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                Approved {formatProcurementDate(req.approvedAt)}
                              </div>
                            );
                          }
                          if (req.status === 'SETTLED' && req.settledAt) {
                            return (
                              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                Settled {formatProcurementDate(req.settledAt)}
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </td>
                      <td
                        style={{
                          padding: '14px 16px',
                          fontSize: 13,
                          color: '#6b7280',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {formatProcurementDate(req.createdAt)}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ minHeight: 32, padding: '6px 12px', fontSize: 13 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/dashboard/procurement/${req.id}`);
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderTop: '1px solid #e5e7eb',
                  background: '#fff',
                  flexWrap: 'wrap',
                  gap: 12,
                }}
              >
                <div style={{ fontSize: 13, color: '#6b7280' }}>
                  Showing {(pagination.page - 1) * pagination.limit + 1}-
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                  {pagination.total}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ minHeight: 32, padding: '6px 12px', fontSize: 13 }}
                    disabled={pagination.page <= 1}
                    onClick={() => handlePageChange(pagination.page - 1)}
                  >
                    Previous
                  </button>
                  <span
                    style={{
                      fontSize: 13,
                      color: '#374151',
                      alignSelf: 'center',
                      padding: '0 8px',
                    }}
                  >
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ minHeight: 32, padding: '6px 12px', fontSize: 13 }}
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => handlePageChange(pagination.page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
