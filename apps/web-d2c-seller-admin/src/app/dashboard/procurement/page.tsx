'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminProcurementService,
  ProcurementListItem,
  ListProcurementParams,
  getProcurementStatusLabel,
  getProcurementStatusColor,
  formatCurrency,
  formatProcurementDate,
} from '@/services/admin-procurement.service';
import { ApiError } from '@/lib/api-client';
import './procurement.css';

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

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

export default function ProcurementPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ProcurementListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [franchiseIdFilter, setFranchiseIdFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRequests = useCallback(async (params: ListProcurementParams = {}) => {
    setLoading(true);
    setError('');
    try {
      const res = await adminProcurementService.list({
        page: params.page || pagination.page,
        limit: 20,
        search: params.search !== undefined ? params.search : search,
        status: params.status !== undefined ? params.status : statusFilter,
        franchiseId: params.franchiseId !== undefined ? params.franchiseId : franchiseIdFilter,
      });
      if (res.data) {
        setRequests(res.data.requests);
        setPagination({
          page: res.data.page,
          limit: res.data.limit,
          total: res.data.total,
          totalPages: res.data.totalPages,
        });
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
  }, [pagination.page, search, statusFilter, franchiseIdFilter, router]);

  useEffect(() => {
    fetchRequests({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, franchiseIdFilter]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchRequests({ page: 1, search: value });
    }, 400);
  };

  const handleFranchiseIdChange = (value: string) => {
    setFranchiseIdFilter(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchRequests({ page: 1, franchiseId: value });
    }, 400);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const sortedRequests = [...requests].sort((a, b) => {
    const dir = sortOrder === 'asc' ? 1 : -1;
    let av: string | number = '';
    let bv: string | number = '';
    switch (sortBy) {
      case 'requestNumber':
        av = a.requestNumber; bv = b.requestNumber; break;
      case 'franchise':
        av = a.franchise?.businessName || ''; bv = b.franchise?.businessName || ''; break;
      case 'items':
        av = a._count?.items || 0; bv = b._count?.items || 0; break;
      case 'total':
        av = a.finalPayableAmount || a.totalRequestedAmount || 0;
        bv = b.finalPayableAmount || b.totalRequestedAmount || 0; break;
      case 'status':
        av = a.status; bv = b.status; break;
      case 'requestedAt':
        av = a.requestedAt ? new Date(a.requestedAt).getTime() : 0;
        bv = b.requestedAt ? new Date(b.requestedAt).getTime() : 0;
        break;
      default:
        av = new Date(a.createdAt).getTime();
        bv = new Date(b.createdAt).getTime();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const handlePageChange = (page: number) => {
    fetchRequests({ page });
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setFranchiseIdFilter('');
    setSortBy('createdAt');
    setSortOrder('desc');
    fetchRequests({ page: 1, search: '', status: '', franchiseId: '' });
  };

  const sortArrow = (field: string) => {
    if (sortBy !== field) return '';
    return sortOrder === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  const hasFilters = search || statusFilter || franchiseIdFilter;

  return (
    <div className="procurement-page">
      <div className="procurement-header">
        <h1>
          Procurement
          {!loading && (
            <span className="procurement-header-count">({pagination.total})</span>
          )}
        </h1>
      </div>

      {/* Filters */}
      <div className="procurement-filters">
        <div className="procurement-search">
          <span className="procurement-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search by request number..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{getProcurementStatusLabel(s)}</option>
          ))}
        </select>

        <input
          type="text"
          className="filter-input"
          placeholder="Franchise ID"
          value={franchiseIdFilter}
          onChange={(e) => handleFranchiseIdChange(e.target.value)}
        />

        {hasFilters && (
          <button className="filter-clear-btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="procurement-table-wrap">
        {loading ? (
          <div className="procurement-loading">Loading procurement requests...</div>
        ) : error ? (
          <div className="procurement-error">
            <p>{error}</p>
            <button onClick={() => fetchRequests({ page: pagination.page })}>Retry</button>
          </div>
        ) : sortedRequests.length === 0 ? (
          <div className="procurement-empty">
            <h3>{hasFilters ? 'No procurement requests match your filters' : 'No procurement requests yet'}</h3>
            <p>{hasFilters ? 'Try adjusting your search or filters.' : 'Requests will appear here once franchises submit them.'}</p>
          </div>
        ) : (
          <>
            <table className="procurement-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => handleSort('requestNumber')}>
                    Request #{sortArrow('requestNumber')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('franchise')}>
                    Franchise{sortArrow('franchise')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('items')}>
                    Items{sortArrow('items')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('total')}>
                    Total Amount{sortArrow('total')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('status')}>
                    Status{sortArrow('status')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('requestedAt')}>
                    Submitted{sortArrow('requestedAt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRequests.map(req => (
                  <tr
                    key={req.id}
                    onClick={() => router.push(`/dashboard/procurement/${req.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span className="procurement-request-number">{req.requestNumber}</span>
                    </td>
                    <td>
                      {req.franchise ? (
                        <div className="procurement-franchise-cell">
                          <span className="procurement-franchise-code">{req.franchise.franchiseCode}</span>
                          <span className="procurement-franchise-name">{req.franchise.businessName}</span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>—</span>
                      )}
                    </td>
                    <td>
                      <span className="procurement-items-count">
                        {req._count?.items ?? 0}
                      </span>
                    </td>
                    <td>
                      <div className="procurement-amount-cell">
                        <span className="procurement-amount-primary">
                          {formatCurrency(req.finalPayableAmount || req.totalRequestedAmount)}
                        </span>
                        {req.totalApprovedAmount > 0 && req.totalApprovedAmount !== req.totalRequestedAmount && (
                          <span className="procurement-amount-secondary">
                            approved: {formatCurrency(req.totalApprovedAmount)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span
                        className="procurement-status-badge"
                        style={{
                          background: `${getProcurementStatusColor(req.status)}15`,
                          color: getProcurementStatusColor(req.status),
                          border: `1px solid ${getProcurementStatusColor(req.status)}40`,
                        }}
                      >
                        {getProcurementStatusLabel(req.status)}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {formatProcurementDate(req.requestedAt || req.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="procurement-pagination">
                <div className="pagination-info">
                  Showing {(pagination.page - 1) * pagination.limit + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
                </div>
                <div className="pagination-buttons">
                  <button
                    className="pagination-btn"
                    disabled={pagination.page <= 1}
                    onClick={() => handlePageChange(pagination.page - 1)}
                  >
                    Prev
                  </button>
                  {generatePageNumbers(pagination.page, pagination.totalPages).map((p, idx) =>
                    typeof p === 'string' ? (
                      <span key={`${p}-${idx}`} style={{ padding: '6px 8px', fontSize: 13 }}>...</span>
                    ) : (
                      <button
                        key={p}
                        className={`pagination-btn${pagination.page === p ? ' active' : ''}`}
                        onClick={() => handlePageChange(p)}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    className="pagination-btn"
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

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (current > 3) pages.push('dots-start');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('dots-end');
  pages.push(total);
  return pages;
}
