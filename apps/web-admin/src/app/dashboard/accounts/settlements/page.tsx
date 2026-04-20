'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  adminAccountsService,
  SettlementCycleListItem,
} from '@/services/admin-accounts.service';
import { ApiError } from '@/lib/api-client';
import CreateCycleModal from './components/create-cycle-modal';
import '../accounts.css';

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

function formatDate(input: string): string {
  if (!input) return '—';
  try {
    return new Date(input).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return input;
  }
}

export default function SettlementCyclesPage() {
  const router = useRouter();
  const [cycles, setCycles] = useState<SettlementCycleListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchCycles = useCallback(
    async (opts: { page?: number; status?: string } = {}) => {
      setLoading(true);
      setError('');
      try {
        const res = await adminAccountsService.listCycles({
          page: opts.page ?? page,
          limit: PAGE_LIMIT,
          status: opts.status !== undefined ? opts.status : status,
        });
        if (res.data) {
          setCycles(res.data.cycles || []);
          setTotal(res.data.total || 0);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/login');
          return;
        }
        setError('Failed to load settlement cycles. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [page, status, router],
  );

  useEffect(() => {
    fetchCycles({ page: 1 });
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    fetchCycles({ page: nextPage });
  };

  const onCycleCreated = () => {
    setShowCreateModal(false);
    fetchCycles({ page: 1 });
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  const getStatusClass = (statusValue: string) => {
    const value = (statusValue || '').toLowerCase();
    if (value.includes('complete')) return 'cycle-status-badge completed';
    if (value.includes('process')) return 'cycle-status-badge processing';
    if (value.includes('pend')) return 'cycle-status-badge pending';
    if (value.includes('draft')) return 'cycle-status-badge draft';
    if (value.includes('cancel') || value.includes('fail')) return 'cycle-status-badge cancelled';
    return 'cycle-status-badge draft';
  };

  return (
    <div className="accounts-page">
      <div className="accounts-header">
        <div>
          <h1>
            Settlement Cycles
            {!loading && <span className="accounts-header-count">({formatNumber(total)})</span>}
          </h1>
          <p>Create and manage unified settlement cycles for sellers and franchises</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link href="/dashboard/accounts" className="accounts-btn-secondary">
            &larr; Back
          </Link>
          <button className="accounts-btn-primary" onClick={() => setShowCreateModal(true)}>
            + Create New Cycle
          </button>
        </div>
      </div>

      <div className="accounts-filters">
        <select
          className="accounts-filter-select"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="PENDING">Pending</option>
          <option value="PROCESSING">Processing</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="accounts-table-wrap">
        {loading ? (
          <div className="accounts-loading">Loading settlement cycles...</div>
        ) : error ? (
          <div className="accounts-error">
            <p>{error}</p>
            <button onClick={() => fetchCycles({ page })}>Retry</button>
          </div>
        ) : cycles.length === 0 ? (
          <div className="accounts-empty">
            <h3>No settlement cycles yet</h3>
            <p>Create your first cycle to begin processing payables.</p>
          </div>
        ) : (
          <>
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Status</th>
                  <th className="numeric">Seller Count</th>
                  <th className="numeric">Franchise Count</th>
                  <th className="numeric">Seller Payable</th>
                  <th className="numeric">Franchise Payable</th>
                  <th className="numeric">Platform Earning</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => (
                  <tr
                    key={cycle.id}
                    onClick={() => router.push(`/dashboard/accounts/settlements/${cycle.id}`)}
                  >
                    <td>
                      <div style={{ fontWeight: 600, color: '#111827' }}>
                        {formatDate(cycle.periodStart)} - {formatDate(cycle.periodEnd)}
                      </div>
                    </td>
                    <td>
                      <span className={getStatusClass(cycle.status)}>
                        {cycle.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="numeric">{formatNumber(cycle.sellerSettlementCount)}</td>
                    <td className="numeric">{formatNumber(cycle.franchiseSettlementCount)}</td>
                    <td className="numeric">{formatCurrency(cycle.totalSellerPayable)}</td>
                    <td className="numeric">{formatCurrency(cycle.totalFranchisePayable)}</td>
                    <td className="numeric amount-positive">
                      {formatCurrency(cycle.totalPlatformEarning)}
                    </td>
                    <td style={{ fontSize: 13, color: '#6b7280' }}>
                      {formatDate(cycle.createdAt)}
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

      {showCreateModal && (
        <CreateCycleModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={onCycleCreated}
        />
      )}
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
