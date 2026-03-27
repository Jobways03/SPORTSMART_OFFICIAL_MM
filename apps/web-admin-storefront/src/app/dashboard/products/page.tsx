'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService, ProductListItem, ListProductsParams } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import './products.css';

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [moderationFilter, setModerationFilter] = useState('');
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
            <table className="products-table">
              <thead>
                <tr>
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
