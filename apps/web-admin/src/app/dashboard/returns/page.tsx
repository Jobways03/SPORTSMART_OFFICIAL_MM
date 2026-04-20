'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminReturnsService,
  ReturnListItem,
  ListReturnsParams,
  ReturnStatus,
  ReturnsAnalyticsSummary,
} from '@/services/admin-returns.service';
import { ApiError } from '@/lib/api-client';
import { getStatusBadgeClass, formatStatus, formatCurrency } from './utils';
import './returns.css';

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

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

export default function ReturnsPage() {
  const router = useRouter();
  const [returns, setReturns] = useState<ReturnListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [nodeTypeFilter, setNodeTypeFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Analytics summary
  const [analytics, setAnalytics] = useState<ReturnsAnalyticsSummary | null>(
    null,
  );

  const fetchReturns = useCallback(
    async (params: ListReturnsParams = {}, pageOverride?: number) => {
      setLoading(true);
      setError('');
      try {
        const res = await adminReturnsService.listReturns({
          page: pageOverride ?? params.page ?? pagination.page,
          limit: 20,
          search: params.search !== undefined ? params.search : search,
          status: params.status !== undefined ? params.status : statusFilter,
          fulfillmentNodeType:
            params.fulfillmentNodeType !== undefined
              ? params.fulfillmentNodeType
              : nodeTypeFilter,
          fromDate: params.fromDate !== undefined ? params.fromDate : fromDate,
          toDate: params.toDate !== undefined ? params.toDate : toDate,
        });
        if (res.data) {
          setReturns(res.data.returns);
          setPagination(res.data.pagination);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Failed to load returns. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [
      pagination.page,
      search,
      statusFilter,
      nodeTypeFilter,
      fromDate,
      toDate,
      router,
    ],
  );

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await adminReturnsService.getAnalyticsSummary();
      if (res.data) setAnalytics(res.data);
    } catch {
      // Analytics are best-effort
    }
  }, []);

  useEffect(() => {
    fetchReturns({ page: 1 }, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, nodeTypeFilter, fromDate, toDate]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchReturns({ page: 1, search: value }, 1);
    }, 400);
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const handlePageChange = (page: number) => {
    fetchReturns({}, page);
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setNodeTypeFilter('');
    setFromDate('');
    setToDate('');
    fetchReturns(
      {
        page: 1,
        search: '',
        status: '',
        fulfillmentNodeType: '',
        fromDate: '',
        toDate: '',
      },
      1,
    );
  };

  const sortArrow = (field: string) => {
    if (sortBy !== field) return '';
    return sortOrder === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  // Client-side sort (server already filters/paginates)
  const sortedReturns = [...returns].sort((a, b) => {
    const getVal = (r: ReturnListItem): string | number => {
      switch (sortBy) {
        case 'returnNumber':
          return r.returnNumber;
        case 'orderNumber':
          return r.masterOrder?.orderNumber || '';
        case 'status':
          return r.status;
        case 'refundAmount':
          return Number(r.refundAmount || 0);
        case 'createdAt':
        default:
          return new Date(r.createdAt).getTime();
      }
    };
    const av = getVal(a);
    const bv = getVal(b);
    if (av === bv) return 0;
    const cmp = av > bv ? 1 : -1;
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  const hasFilters =
    search || statusFilter || nodeTypeFilter || fromDate || toDate;

  const totalItems = (r: ReturnListItem) =>
    (r.items || []).reduce((sum, it) => sum + (it.quantity || 0), 0);

  const customerDisplay = (r: ReturnListItem) => {
    if (r.customer) {
      const name = [r.customer.firstName, r.customer.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return {
        name: name || r.customer.email || r.customerId,
        email: r.customer.email || '',
      };
    }
    return { name: r.customerId, email: '' };
  };

  return (
    <div className="returns-page">
      <div className="returns-header">
        <h1>
          Returns
          {!loading && (
            <span className="returns-header-count">({pagination.total})</span>
          )}
        </h1>
      </div>

      {/* Analytics cards */}
      {analytics && (
        <div className="returns-analytics">
          <div className="analytics-card">
            <div className="analytics-card-label">Total Returns</div>
            <div className="analytics-card-value">{analytics.totalReturns}</div>
          </div>
          <div className="analytics-card">
            <div className="analytics-card-label">Pending</div>
            <div className="analytics-card-value warning">
              {analytics.pendingCount}
            </div>
          </div>
          <div className="analytics-card">
            <div className="analytics-card-label">Refunded</div>
            <div className="analytics-card-value success">
              {analytics.refundedCount}
            </div>
          </div>
          <div className="analytics-card">
            <div className="analytics-card-label">Refund Total</div>
            <div className="analytics-card-value primary">
              {formatCurrency(analytics.totalRefundAmount)}
            </div>
          </div>
          <div className="analytics-card">
            <div className="analytics-card-label">Success Rate</div>
            <div className="analytics-card-value">
              {analytics.refundSuccessRate.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="returns-filters">
        <div className="returns-search">
          <span className="returns-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search by return # or order #..."
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
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {formatStatus(s)}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={nodeTypeFilter}
          onChange={(e) => setNodeTypeFilter(e.target.value)}
        >
          <option value="">All Fulfillment</option>
          <option value="SELLER">Seller</option>
          <option value="FRANCHISE">Franchise</option>
        </select>

        <input
          type="date"
          className="returns-date-input"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          placeholder="From"
        />

        <input
          type="date"
          className="returns-date-input"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          placeholder="To"
        />

        {hasFilters && (
          <button className="filter-clear-btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="returns-table-wrap">
        {loading ? (
          <div className="returns-loading">Loading returns...</div>
        ) : error ? (
          <div className="returns-error">
            <p>{error}</p>
            <button onClick={() => fetchReturns({}, pagination.page)}>
              Retry
            </button>
          </div>
        ) : sortedReturns.length === 0 ? (
          <div className="returns-empty">
            <h3>
              {hasFilters ? 'No returns match your filters' : 'No returns yet'}
            </h3>
            <p>
              {hasFilters
                ? 'Try adjusting your search or filters.'
                : 'Returns will appear here once customers submit them.'}
            </p>
          </div>
        ) : (
          <>
            <table className="returns-table">
              <thead>
                <tr>
                  <th
                    className="sortable"
                    onClick={() => handleSort('returnNumber')}
                  >
                    Return #{sortArrow('returnNumber')}
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort('orderNumber')}
                  >
                    Order #{sortArrow('orderNumber')}
                  </th>
                  <th>Customer</th>
                  <th>Items</th>
                  <th className="sortable" onClick={() => handleSort('status')}>
                    Status{sortArrow('status')}
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort('refundAmount')}
                  >
                    Refund{sortArrow('refundAmount')}
                  </th>
                  <th
                    className="sortable"
                    onClick={() => handleSort('createdAt')}
                  >
                    Created{sortArrow('createdAt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedReturns.map((ret) => {
                  const customer = customerDisplay(ret);
                  return (
                    <tr
                      key={ret.id}
                      onClick={() =>
                        router.push(`/dashboard/returns/${ret.id}`)
                      }
                    >
                      <td>
                        <div className="return-number-cell">
                          <span className="return-number-primary">
                            {ret.returnNumber}
                          </span>
                          {ret.subOrder?.fulfillmentNodeType && (
                            <span className="return-number-sub">
                              {ret.subOrder.fulfillmentNodeType}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: 13 }}>
                          {ret.masterOrder?.orderNumber ||
                            ret.subOrder?.masterOrder?.orderNumber ||
                            '—'}
                        </span>
                      </td>
                      <td>
                        <div className="return-customer-cell">
                          <span className="return-customer-name">
                            {customer.name}
                          </span>
                          {customer.email && (
                            <span className="return-customer-email">
                              {customer.email}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="return-pill">
                          {totalItems(ret)} item{totalItems(ret) === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td>
                        <span className={getStatusBadgeClass(ret.status)}>
                          {formatStatus(ret.status)}
                        </span>
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        {ret.refundAmount != null
                          ? formatCurrency(Number(ret.refundAmount))
                          : '—'}
                      </td>
                      <td
                        style={{
                          fontSize: 13,
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        {new Date(ret.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="returns-pagination">
                <div className="pagination-info">
                  Showing {(pagination.page - 1) * pagination.limit + 1}-
                  {Math.min(
                    pagination.page * pagination.limit,
                    pagination.total,
                  )}{' '}
                  of {pagination.total}
                </div>
                <div className="pagination-buttons">
                  <button
                    className="pagination-btn"
                    disabled={pagination.page <= 1}
                    onClick={() => handlePageChange(pagination.page - 1)}
                  >
                    Prev
                  </button>
                  {generatePageNumbers(
                    pagination.page,
                    pagination.totalPages,
                  ).map((p) =>
                    typeof p === 'string' ? (
                      <span
                        key={p}
                        style={{ padding: '6px 8px', fontSize: 13 }}
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={p}
                        className={`pagination-btn${
                          pagination.page === p ? ' active' : ''
                        }`}
                        onClick={() => handlePageChange(p)}
                      >
                        {p}
                      </button>
                    ),
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

function generatePageNumbers(
  current: number,
  total: number,
): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | string)[] = [1];
  if (current > 3) pages.push('dots-start');
  for (
    let i = Math.max(2, current - 1);
    i <= Math.min(total - 1, current + 1);
    i++
  ) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('dots-end');
  pages.push(total);
  return pages;
}
