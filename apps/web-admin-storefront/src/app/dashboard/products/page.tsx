'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService, ProductListItem, ListProductsParams } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import './products.css';
import { useModal } from '@sportsmart/ui';

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function ProductsPage() {
  const { notify, confirmDialog } = useModal();
const router = useRouter();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [moderationFilter, setModerationFilter] = useState('');

  // Bulk moderation — only the current-page set of PENDING rows is selectable
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState<null | 'approve' | 'reject' | 'request-changes'>(null);
  const [bulkModal, setBulkModal] = useState<null | 'reject' | 'request-changes'>(null);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');

  const selectableIds = products
    .filter((p) => p.status === 'SUBMITTED')
    .map((p) => p.id);

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      if (selectableIds.every((id) => prev.has(id))) return new Set();
      return new Set(selectableIds);
    });
  const clearSelection = () => setSelected(new Set());
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProducts = useCallback(async (params: ListProductsParams = {}) => {
    setLoading(true);
    setError('');
    try {
      const res = await adminProductsService.listProducts({
        page: params.page || pagination.page,
        limit: 20,
        search: params.search !== undefined ? params.search : search,
        status: params.status !== undefined ? params.status : statusFilter,
        moderationStatus: params.moderationStatus !== undefined ? params.moderationStatus : moderationFilter,
      });
      if (res.data) {
        setProducts(res.data.products);
        setPagination(res.data.pagination);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError('Failed to load products. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, search, statusFilter, moderationFilter, router]);

  useEffect(() => {
    fetchProducts({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, moderationFilter]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchProducts({ page: 1, search: value });
    }, 400);
  };

  const handlePageChange = (page: number) => {
    fetchProducts({ page });
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setModerationFilter('');
    fetchProducts({ page: 1, search: '', status: '', moderationStatus: '' });
  };

  // Bulk moderation handlers
  const runBulkApprove = async () => {if (selected.size === 0) return;
    if (!(await confirmDialog(`Approve ${selected.size} selected product(s)?`))) return;
    setBulkSaving('approve');
    setBulkMessage('');
    try {
      const res = await adminProductsService.bulkApprove([...selected]);
      const d = res.data;
      setBulkMessage(
        d
          ? `Approved ${d.ok.length}${d.failed.length ? ` — ${d.failed.length} failed` : ''}`
          : 'Done',
      );
      clearSelection();
      await fetchProducts({ page: pagination.page });
    } catch (err) {
      setBulkMessage(
        err instanceof ApiError
          ? err.body.message || 'Bulk approve failed'
          : 'Bulk approve failed',
      );
    } finally {
      setBulkSaving(null);
    }
  };

  const runBulkRejectOrChanges = async () => {
    if (selected.size === 0 || !bulkModal) return;
    const text = bulkNote.trim();
    if (!text) {
      setBulkMessage(
        bulkModal === 'reject' ? 'Reason is required' : 'Note is required',
      );
      return;
    }
    setBulkSaving(bulkModal);
    setBulkMessage('');
    try {
      const res =
        bulkModal === 'reject'
          ? await adminProductsService.bulkReject([...selected], text)
          : await adminProductsService.bulkRequestChanges([...selected], text);
      const d = res.data;
      setBulkMessage(
        d
          ? `${bulkModal === 'reject' ? 'Rejected' : 'Changes requested on'} ${d.ok.length}${d.failed.length ? ` — ${d.failed.length} failed` : ''}`
          : 'Done',
      );
      setBulkModal(null);
      setBulkNote('');
      clearSelection();
      await fetchProducts({ page: pagination.page });
    } catch (err) {
      setBulkMessage(
        err instanceof ApiError
          ? err.body.message || 'Bulk action failed'
          : 'Bulk action failed',
      );
    } finally {
      setBulkSaving(null);
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'DRAFT': return 'products-status-badge draft';
      case 'SUBMITTED': return 'products-status-badge submitted';
      case 'APPROVED': return 'products-status-badge approved';
      case 'ACTIVE': return 'products-status-badge active';
      case 'REJECTED': return 'products-status-badge rejected';
      case 'CHANGES_REQUESTED': return 'products-status-badge changes-requested';
      case 'SUSPENDED': return 'products-status-badge suspended';
      case 'ARCHIVED': return 'products-status-badge archived';
      default: return 'products-status-badge';
    }
  };

  const getModerationBadgeClass = (status: string) => {
    switch (status) {
      case 'PENDING': return 'moderation-badge pending';
      case 'APPROVED': return 'moderation-badge approved';
      case 'REJECTED': return 'moderation-badge rejected';
      case 'CHANGES_REQUESTED': return 'moderation-badge changes-requested';
      case 'IN_REVIEW': return 'moderation-badge in-review';
      default: return 'moderation-badge';
    }
  };

  const formatStatus = (status: string) => {
    const displayMap: Record<string, string> = {
      DRAFT: 'Draft',
      SUBMITTED: 'Pending Review',
      APPROVED: 'Approved',
      ACTIVE: 'Active',
      SUSPENDED: 'Inactive',
      ARCHIVED: 'Archived',
      REJECTED: 'Rejected',
      CHANGES_REQUESTED: 'Changes Requested',
      PENDING: 'Pending',
      IN_REVIEW: 'In Review',
    };
    return displayMap[status] || status.replace(/_/g, ' ');
  };

  const formatPrice = (price: string | null) => {
    if (!price) return null;
    const num = parseFloat(price);
    if (isNaN(num)) return price;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  const hasFilters = search || statusFilter || moderationFilter;

  return (
    <div className="products-page">
      <div className="products-header">
        <h1>
          Products
          {!loading && (
            <span className="products-header-count">({pagination.total})</span>
          )}
        </h1>
        <Link href="/dashboard/products/new" className="products-add-btn">
          + ADD PRODUCT
        </Link>
      </div>

      {/* Quick Filter Tabs */}
      <div className="products-quick-filters">
        <button
          className={`products-quick-filter-tab${!moderationFilter && !statusFilter ? ' active' : ''}`}
          onClick={() => { setModerationFilter(''); setStatusFilter(''); }}
        >
          All Products
        </button>
        <button
          className={`products-quick-filter-tab${moderationFilter === 'PENDING' ? ' active' : ''}`}
          onClick={() => { setModerationFilter('PENDING'); setStatusFilter(''); }}
        >
          Pending Review
        </button>
        <button
          className={`products-quick-filter-tab${statusFilter === 'ACTIVE' && !moderationFilter ? ' active' : ''}`}
          onClick={() => { setStatusFilter('ACTIVE'); setModerationFilter(''); }}
        >
          Active
        </button>
        <button
          className={`products-quick-filter-tab${statusFilter === 'DRAFT' && !moderationFilter ? ' active' : ''}`}
          onClick={() => { setStatusFilter('DRAFT'); setModerationFilter(''); }}
        >
          Drafts
        </button>
      </div>

      {/* Filters */}
      <div className="products-filters">
        <div className="products-search">
          <span className="products-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search by title, category..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        <select
          className="products-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="APPROVED">Approved</option>
          <option value="ACTIVE">Active</option>
          <option value="REJECTED">Rejected</option>
          <option value="CHANGES_REQUESTED">Changes Requested</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="ARCHIVED">Archived</option>
        </select>

        {hasFilters && (
          <button className="products-filter-clear-btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="products-table-wrap">
        {loading ? (
          <div className="products-loading">Loading products...</div>
        ) : error ? (
          <div className="products-error">
            <p>{error}</p>
            <button onClick={() => fetchProducts({ page: pagination.page })}>Retry</button>
          </div>
        ) : products.length === 0 ? (
          <div className="products-empty">
            <h3>{hasFilters ? 'No products match your filters' : 'No products yet'}</h3>
            <p>
              {hasFilters
                ? 'Try adjusting your search or filters.'
                : 'Products will appear here once sellers create them.'}
            </p>
          </div>
        ) : (
          <>
            {/* Bulk action bar — only surfaces when rows are selected */}
            {selected.size > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  marginBottom: 12,
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 600, color: '#1e40af' }}>
                  {selected.size} selected
                </span>
                <button
                  type="button"
                  onClick={runBulkApprove}
                  disabled={bulkSaving !== null}
                  style={{
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 500,
                    background: '#16a34a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: bulkSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {bulkSaving === 'approve' ? 'Approving\u2026' : 'Approve all'}
                </button>
                <button
                  type="button"
                  onClick={() => { setBulkModal('request-changes'); setBulkNote(''); setBulkMessage(''); }}
                  disabled={bulkSaving !== null}
                  style={{
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 500,
                    background: '#fff',
                    color: '#b45309',
                    border: '1px solid #fbbf24',
                    borderRadius: 6,
                    cursor: bulkSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Request changes
                </button>
                <button
                  type="button"
                  onClick={() => { setBulkModal('reject'); setBulkNote(''); setBulkMessage(''); }}
                  disabled={bulkSaving !== null}
                  style={{
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 500,
                    background: '#fff',
                    color: '#b91c1c',
                    border: '1px solid #fca5a5',
                    borderRadius: 6,
                    cursor: bulkSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Reject all
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  style={{
                    marginLeft: 'auto',
                    padding: '6px 10px',
                    fontSize: 13,
                    background: 'transparent',
                    color: '#6b7280',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Clear
                </button>
              </div>
            )}
            {bulkMessage && !bulkModal && (
              <div
                style={{
                  padding: '8px 12px',
                  marginBottom: 12,
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 8,
                  fontSize: 13,
                  color: '#15803d',
                }}
              >
                {bulkMessage}
              </div>
            )}

            <table className="products-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all pending products on this page"
                      checked={
                        selectableIds.length > 0 &&
                        selectableIds.every((id) => selected.has(id))
                      }
                      onChange={toggleAll}
                      disabled={selectableIds.length === 0}
                    />
                  </th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.id}>
                    <td style={{ width: 36 }} onClick={(e) => e.stopPropagation()}>
                      {product.status === 'SUBMITTED' ? (
                        <input
                          type="checkbox"
                          checked={selected.has(product.id)}
                          onChange={() => toggleOne(product.id)}
                          aria-label={`Select ${product.title}`}
                        />
                      ) : null}
                    </td>
                    <td>
                      <Link
                        href={`/dashboard/products/${product.id}/edit`}
                        className="product-name-cell"
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        {product.primaryImageUrl ? (
                          <img
                            className="product-thumb"
                            src={product.primaryImageUrl}
                            alt={product.title}
                          />
                        ) : (
                          <div className="product-thumb-placeholder">
                            &#128247;
                          </div>
                        )}
                        <div className="product-name-text">
                          <span className="product-name-primary" style={{ color: '#1a56db' }}>
                            {product.title}
                            {product.potentialDuplicateOf && (
                              <span className="duplicate-warning-badge" title="Possible Duplicate">
                                &#9888;
                              </span>
                            )}
                          </span>
                          {product.category && (
                            <span className="product-name-secondary">{product.category.name}</span>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td>
                      <span className={`type-badge ${product.hasVariants ? 'variant' : 'normal'}`}>
                        {product.hasVariants ? 'Variant' : 'Normal'}
                      </span>
                    </td>
                    <td>
                      {product.hasVariants ? (
                        <span className="product-price multiple">Multiple</span>
                      ) : (
                        <span className="product-price">
                          {formatPrice(product.basePrice) || '\u2014'}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="product-stock">
                        {product.totalStock ?? product.baseStock ?? 0}
                      </span>
                    </td>
                    <td>
                      <span className={getStatusBadgeClass(product.status)}>
                        {formatStatus(product.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="products-pagination">
                <div className="products-pagination-info">
                  Showing {(pagination.page - 1) * pagination.limit + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
                </div>
                <div className="products-pagination-buttons">
                  <button
                    className="products-pagination-btn"
                    disabled={pagination.page <= 1}
                    onClick={() => handlePageChange(pagination.page - 1)}
                  >
                    Prev
                  </button>
                  {generatePageNumbers(pagination.page, pagination.totalPages).map((p) =>
                    typeof p === 'string' ? (
                      <span key={p} style={{ padding: '6px 8px', fontSize: 13 }}>...</span>
                    ) : (
                      <button
                        key={p}
                        className={`products-pagination-btn${pagination.page === p ? ' active' : ''}`}
                        onClick={() => handlePageChange(p)}
                      >
                        {p}
                      </button>
                    )
                  )}
                  <button
                    className="products-pagination-btn"
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

      {/* Bulk reject / request-changes modal */}
      {bulkModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !bulkSaving) setBulkModal(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(17, 24, 39, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 480,
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              {bulkModal === 'reject'
                ? `Reject ${selected.size} product(s)`
                : `Request changes on ${selected.size} product(s)`}
            </h2>
            <p style={{ marginTop: 4, marginBottom: 12, color: '#6b7280', fontSize: 13 }}>
              This {bulkModal === 'reject' ? 'reason' : 'note'} will be sent to
              every seller whose product is in this batch. Each seller receives
              an email with the text below.
            </p>
            {bulkMessage && (
              <div
                style={{
                  padding: 10,
                  background: '#fef2f2',
                  color: '#b91c1c',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                {bulkMessage}
              </div>
            )}
            <textarea
              rows={4}
              placeholder={
                bulkModal === 'reject'
                  ? 'Rejection reason (required)'
                  : 'What needs to change (required)'
              }
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 14,
                border: '1px solid #d1d5db',
                borderRadius: 8,
                marginBottom: 16,
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
              disabled={bulkSaving !== null}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setBulkModal(null)}
                disabled={bulkSaving !== null}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 500,
                  background: '#fff',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  cursor: bulkSaving ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={runBulkRejectOrChanges}
                disabled={bulkSaving !== null}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: bulkModal === 'reject' ? '#dc2626' : '#d97706',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: bulkSaving ? 'not-allowed' : 'pointer',
                }}
              >
                {bulkSaving
                  ? bulkModal === 'reject'
                    ? 'Rejecting\u2026'
                    : 'Saving\u2026'
                  : bulkModal === 'reject'
                    ? 'Confirm Rejection'
                    : 'Send Changes Note'}
              </button>
            </div>
          </div>
        </div>
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
