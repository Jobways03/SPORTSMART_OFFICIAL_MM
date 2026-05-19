'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminAccountsService,
  PayableEntry,
} from '@/services/admin-accounts.service';
import { ApiError } from '@/lib/api-client';
import '../accounts.css';

type NodeTypeFilter = 'ALL' | 'SELLER' | 'FRANCHISE';

const PAGE_LIMIT = 20;

function formatCurrency(amount: number): string {
  const safe = Number(amount) || 0;
  return `\u20B9${safe.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value: number): string {
  return (Number(value) || 0).toLocaleString('en-IN');
}

export default function PayablesListPage() {
  const router = useRouter();
  const [payables, setPayables] = useState<PayableEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [nodeType, setNodeType] = useState<NodeTypeFilter>('ALL');
  const [status, setStatus] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPayables = useCallback(
    async (opts: { page?: number; search?: string; nodeType?: NodeTypeFilter; status?: string } = {}) => {
      setLoading(true);
      setError('');
      try {
        const res = await adminAccountsService.listPayables({
          page: opts.page ?? page,
          limit: PAGE_LIMIT,
          nodeType: opts.nodeType ?? nodeType,
          status: opts.status !== undefined ? opts.status : status,
          search: opts.search !== undefined ? opts.search : search,
        });
        if (res.data) {
          setPayables(res.data.payables || []);
          setTotal(res.data.total || 0);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Failed to load payables. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [page, search, nodeType, status, router],
  );

  useEffect(() => {
    fetchPayables({ page: 1 });
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeType, status]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      fetchPayables({ page: 1, search: value });
    }, 400);
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    fetchPayables({ page: nextPage });
  };

  const handleRowClick = (entry: PayableEntry) => {
    if (entry.nodeType === 'SELLER') {
      router.push(`/dashboard/sellers/${entry.nodeId}`);
    } else {
      router.push(`/dashboard/franchises/${entry.nodeId}`);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
  const hasFilters = search || nodeType !== 'ALL' || status;

  const clearFilters = () => {
    setSearch('');
    setNodeType('ALL');
    setStatus('');
    setPage(1);
    fetchPayables({ page: 1, search: '', nodeType: 'ALL', status: '' });
  };

  return (
    <div className="accounts-page">
      <div className="accounts-header">
        <div>
          <h1>
            Payables
            {!loading && <span className="accounts-header-count">({formatNumber(total)})</span>}
          </h1>
          <p>Unified list of pending payables across sellers and franchises</p>
        </div>
        <Link href="/dashboard/accounts" className="accounts-btn-secondary">
          &larr; Back to Accounts
        </Link>
      </div>

      <div className="accounts-filters">
        <div className="accounts-search">
          <span className="accounts-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <select
          className="accounts-filter-select"
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as NodeTypeFilter)}
        >
          <option value="ALL">All Types</option>
          <option value="SELLER">Sellers</option>
          <option value="FRANCHISE">Franchises</option>
        </select>

        <select
          className="accounts-filter-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="PARTIALLY_PAID">Partially Paid</option>
          <option value="PAID">Paid</option>
        </select>

        {hasFilters && (
          <button className="accounts-btn-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      <div className="accounts-table-wrap">
        {loading ? (
          <div className="accounts-loading">Loading payables...</div>
        ) : error ? (
          <div className="accounts-error">
            <p>{error}</p>
            <button onClick={() => fetchPayables({ page })}>Retry</button>
          </div>
        ) : payables.length === 0 ? (
          <div className="accounts-empty">
            <h3>{hasFilters ? 'No payables match your filters' : 'No payables found'}</h3>
            <p>
              {hasFilters
                ? 'Try adjusting your search or filters.'
                : 'Payables will appear here when sellers or franchises have pending amounts.'}
            </p>
          </div>
        ) : (
          <>
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Name</th>
                  <th className="numeric">Orders</th>
                  <th className="numeric">Total Amount</th>
                  <th className="numeric">Platform Earning</th>
                  <th className="numeric">Pending</th>
                  <th className="numeric">Settled</th>
                  <th>Last Paid</th>
                </tr>
              </thead>
              <tbody>
                {payables.map((entry) => (
                  <tr
                    key={`${entry.nodeType}-${entry.nodeId}`}
                    onClick={() => handleRowClick(entry)}
                  >
                    <td>
                      <span className={`node-type-badge ${entry.nodeType.toLowerCase()}`}>
                        {entry.nodeType}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, color: '#111827' }}>{entry.nodeName}</td>
                    <td className="numeric">{formatNumber(entry.totalOrders)}</td>
                    <td className="numeric">{formatCurrency(entry.totalAmount)}</td>
                    <td className="numeric">{formatCurrency(entry.platformEarning)}</td>
                    <td className="numeric amount-pending">
                      {formatCurrency(entry.pendingAmount)}
                    </td>
                    <td className="numeric amount-positive">
                      {formatCurrency(entry.settledAmount)}
                    </td>
                    <td style={{ fontSize: 13, color: '#6b7280' }}>
                      {entry.lastPaidAt
                        ? new Date(entry.lastPaidAt).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="accounts-pagination">
                <div>
                  Showing {(page - 1) * PAGE_LIMIT + 1}-
                  {Math.min(page * PAGE_LIMIT, total)} of {formatNumber(total)}
                </div>
                <div className="pagination-buttons">
                  <button
                    className="pagination-btn"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(page - 1)}
                  >
                    Prev
                  </button>
                  {generatePageNumbers(page, totalPages).map((p, idx) =>
                    typeof p === 'string' ? (
                      <span key={`${p}-${idx}`} style={{ padding: '6px 8px', fontSize: 13 }}>
                        ...
                      </span>
                    ) : (
                      <button
                        key={p}
                        className={`pagination-btn${page === p ? ' active' : ''}`}
                        onClick={() => handlePageChange(p)}
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    className="pagination-btn"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(page + 1)}
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
