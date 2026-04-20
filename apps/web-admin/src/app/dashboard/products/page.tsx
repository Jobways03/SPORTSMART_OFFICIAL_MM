'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService, ProductListItem, ListProductsParams } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import ActionMenu from './components/action-menu';
import RejectModal from './components/reject-modal';
import RequestChangesModal from './components/request-changes-modal';
import DeleteModal from './components/delete-modal';
import './products.css';

type ModalType = 'reject' | 'requestChanges' | 'delete' | null;

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
  const [pendingApprovalsTab, setPendingApprovalsTab] = useState(false);
  const [pendingMappings, setPendingMappings] = useState<any[]>([]);
  const [pendingMappingsLoading, setPendingMappingsLoading] = useState(false);
  const [pendingMappingsCount, setPendingMappingsCount] = useState(0);
  const [mappingActionLoading, setMappingActionLoading] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductListItem | null>(null);

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
        hasSellers: 'true',
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

  const fetchPendingMappings = useCallback(async () => {
    setPendingMappingsLoading(true);
    try {
      const res = await adminProductsService.getPendingMappings({ page: 1, limit: 100 });
      if (res.data) {
        const mappings = res.data.mappings || res.data.items || [];
        setPendingMappings(mappings);
        setPendingMappingsCount(res.data.pagination?.total ?? res.data.total ?? mappings.length);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
    } finally {
      setPendingMappingsLoading(false);
    }
  }, [router]);

  // Fetch pending count on mount
  useEffect(() => {
    adminProductsService.getPendingMappings({ limit: 0 })
      .then(res => {
        if (res.data?.pagination?.total !== undefined) {
          setPendingMappingsCount(res.data.pagination.total);
        } else if (res.data?.total !== undefined) {
          setPendingMappingsCount(res.data.total);
        }
      })
      .catch(() => {});
  }, []);

  const handleApproveMappingInline = async (mappingId: string) => {
    setMappingActionLoading(mappingId);
    try {
      await adminProductsService.approveMappings(mappingId);
      setPendingMappings(prev => prev.filter(m => m.id !== mappingId));
      setPendingMappingsCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to approve mapping');
    } finally {
      setMappingActionLoading(null);
    }
  };

  const handleStopMappingInline = async (mappingId: string) => {
    setMappingActionLoading(mappingId);
    try {
      await adminProductsService.stopMapping(mappingId);
      setPendingMappings(prev => prev.filter(m => m.id !== mappingId));
      setPendingMappingsCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to stop mapping');
    } finally {
      setMappingActionLoading(null);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setModerationFilter('');
    setPendingApprovalsTab(false);
    fetchProducts({ page: 1, search: '', status: '', moderationStatus: '' });
  };

  const openModal = (type: ModalType, product: ProductListItem) => {
    setSelectedProduct(product);
    setActiveModal(type);
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelectedProduct(null);
  };

  const onActionComplete = () => {
    closeModal();
    fetchProducts({ page: pagination.page });
  };

  const handleApprove = async (product: ProductListItem) => {
    try {
      await adminProductsService.approveProduct(product.id);
      fetchProducts({ page: pagination.page });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      alert(err instanceof ApiError ? err.message : 'Failed to approve product');
    }
  };

  const handleStatusChange = async (product: ProductListItem, status: string) => {
    try {
      await adminProductsService.updateStatus(product.id, status);
      fetchProducts({ page: pagination.page });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      alert(err instanceof ApiError ? err.message : 'Failed to update status');
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
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  const hasFilters = search || statusFilter || moderationFilter || pendingApprovalsTab;

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
          className={`products-quick-filter-tab${!moderationFilter && !statusFilter && !pendingApprovalsTab ? ' active' : ''}`}
          onClick={() => { setModerationFilter(''); setStatusFilter(''); setPendingApprovalsTab(false); }}
        >
          All Products
        </button>
        <button
          className={`products-quick-filter-tab${moderationFilter === 'PENDING' && !pendingApprovalsTab ? ' active' : ''}`}
          onClick={() => { setModerationFilter('PENDING'); setStatusFilter(''); setPendingApprovalsTab(false); }}
        >
          Pending Review
        </button>
        <button
          className={`products-quick-filter-tab${statusFilter === 'ACTIVE' && !moderationFilter && !pendingApprovalsTab ? ' active' : ''}`}
          onClick={() => { setStatusFilter('ACTIVE'); setModerationFilter(''); setPendingApprovalsTab(false); }}
        >
          Active
        </button>
        <button
          className={`products-quick-filter-tab${statusFilter === 'DRAFT' && !moderationFilter && !pendingApprovalsTab ? ' active' : ''}`}
          onClick={() => { setStatusFilter('DRAFT'); setModerationFilter(''); setPendingApprovalsTab(false); }}
        >
          Drafts
        </button>
        <button
          className={`products-quick-filter-tab${pendingApprovalsTab ? ' active' : ''}`}
          onClick={() => { setPendingApprovalsTab(true); setModerationFilter(''); setStatusFilter(''); fetchPendingMappings(); }}
          style={{ position: 'relative' }}
        >
          Pending Seller Approvals
          {pendingMappingsCount > 0 && (
            <span style={{
              marginLeft: 6,
              background: '#f59e0b',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 8,
              minWidth: 16,
              textAlign: 'center',
              display: 'inline-block',
            }}>
              {pendingMappingsCount > 99 ? '99+' : pendingMappingsCount}
            </span>
          )}
        </button>
      </div>

      {/* Filters */}
      <div className="products-filters">
        <div className="products-search">
          <span className="products-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search by title, seller, category..."
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

        <select
          className="products-filter-select"
          value={moderationFilter}
          onChange={(e) => setModerationFilter(e.target.value)}
        >
          <option value="">All Approval</option>
          <option value="PENDING">Pending</option>
          <option value="IN_REVIEW">In Review</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CHANGES_REQUESTED">Changes Requested</option>
        </select>

        {hasFilters && (
          <button className="products-filter-clear-btn" onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {/* Pending Seller Approvals View */}
      {pendingApprovalsTab && (
        <div className="products-table-wrap">
          {pendingMappingsLoading ? (
            <div className="products-loading">Loading pending approvals...</div>
          ) : pendingMappings.length === 0 ? (
            <div className="products-empty">
              <h3>No pending seller approvals</h3>
              <p>All seller mappings have been reviewed.</p>
            </div>
          ) : (
            <table className="products-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Seller</th>
                  <th>Internal SKU</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th style={{ width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingMappings.map(mapping => (
                  <tr key={mapping.id}>
                    <td>
                      <div className="product-name-cell">
                        <div className="product-name-text">
                          <span className="product-name-primary">{mapping.product?.title || mapping.productTitle || 'Unknown'}</span>
                          {mapping.variant && (
                            <span className="product-name-secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                              {mapping.variant.title || mapping.variant.masterSku || ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 500 }}>{mapping.seller?.sellerName || 'Unknown'}</span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: (mapping.sellerInternalSku || mapping.variant?.sku) ? '#374151' : '#9ca3af' }}>
                        {mapping.sellerInternalSku || mapping.variant?.sku || '\u2014'}
                      </span>
                    </td>
                    <td>
                      <span className="product-stock">{mapping.stockQty ?? 0}</span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 10px',
                        borderRadius: 12,
                        fontSize: 11,
                        fontWeight: 600,
                        background: '#fef3c7',
                        color: '#92400e',
                        border: '1px solid #fde68a',
                      }}>
                        PENDING
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleApproveMappingInline(mapping.id)}
                          disabled={mappingActionLoading === mapping.id}
                          style={{
                            padding: '5px 14px',
                            fontSize: 12,
                            fontWeight: 600,
                            border: 'none',
                            borderRadius: 6,
                            cursor: 'pointer',
                            background: '#16a34a',
                            color: '#fff',
                            opacity: mappingActionLoading === mapping.id ? 0.6 : 1,
                          }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleStopMappingInline(mapping.id)}
                          disabled={mappingActionLoading === mapping.id}
                          style={{
                            padding: '5px 14px',
                            fontSize: 12,
                            fontWeight: 600,
                            border: 'none',
                            borderRadius: 6,
                            cursor: 'pointer',
                            background: '#dc2626',
                            color: '#fff',
                            opacity: mappingActionLoading === mapping.id ? 0.6 : 1,
                          }}
                        >
                          Stop
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Table */}
      {!pendingApprovalsTab && (
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
                  <th>Seller</th>
                  <th>Type</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Approval</th>
                  <th style={{ width: 60 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.id}>
                    <td>
                      <div className="product-name-cell">
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
                          <span className="product-name-primary">
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
                      </div>
                    </td>
                    <td>
                      {product.seller ? (
                        <div className="product-seller-cell">
                          <span className="product-seller-name">{product.seller.sellerName}</span>
                          <span className="product-seller-shop">{product.seller.sellerShopName}</span>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--color-text-secondary)' }}>&mdash;</span>
                      )}
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
                    <td>
                      <span className={getModerationBadgeClass(product.moderationStatus)}>
                        {formatStatus(product.moderationStatus)}
                      </span>
                    </td>
                    <td>
                      {product.seller ? (
                        <ActionMenu
                          product={product}
                          onEdit={() => router.push(`/dashboard/products/${product.id}/edit`)}
                          onApprove={() => handleApprove(product)}
                          onReject={() => openModal('reject', product)}
                          onRequestChanges={() => openModal('requestChanges', product)}
                          onStatusChange={(status) => handleStatusChange(product, status)}
                          onDelete={() => openModal('delete', product)}
                        />
                      ) : (
                        <button
                          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer' }}
                          onClick={() => router.push(`/dashboard/products/${product.id}/edit`)}
                        >
                          View
                        </button>
                      )}
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
      )}

      {/* Modals */}
      {activeModal === 'reject' && selectedProduct && (
        <RejectModal product={selectedProduct} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'requestChanges' && selectedProduct && (
        <RequestChangesModal product={selectedProduct} onClose={closeModal} onSuccess={onActionComplete} />
      )}
      {activeModal === 'delete' && selectedProduct && (
        <DeleteModal product={selectedProduct} onClose={closeModal} onSuccess={onActionComplete} />
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
