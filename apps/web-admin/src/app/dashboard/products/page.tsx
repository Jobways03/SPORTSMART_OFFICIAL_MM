'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService, ProductListItem, ListProductsParams } from '@/services/admin-products.service';
import { ApiError, apiClient } from '@/lib/api-client';
import ActionMenu from './components/action-menu';
import RejectModal from './components/reject-modal';
import RequestChangesModal from './components/request-changes-modal';
import DeleteModal from './components/delete-modal';
import './products.css';
import { useModal } from '@sportsmart/ui';

type ModalType = 'reject' | 'requestChanges' | 'delete' | null;

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ── Inventory panel types ───────────────────────────────────────
// Mirror of the admin seller-mappings and franchise-mappings
// endpoint responses. Defined inline because they're only used by
// the inline panel; promoting to the service file would couple
// unrelated views to the same shape.
interface AdminSellerMapping {
  id: string;
  seller: { id: string; sellerName: string; sellerShopName: string; status: string; sellerZipCode: string | null };
  variant: { id: string; masterSku: string; title: string; sku: string } | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  lowStockThreshold: number;
  mappingDisplayStatus: string;
  approvalStatus: string | null;
  sellerInternalSku: string | null;
  pickupPincode: string | null;
  dispatchSla: number;
  isActive: boolean;
  updatedAt: string;
}
interface AdminFranchiseMapping {
  id: string;
  franchise: { id: string; businessName: string; status: string; warehousePincode: string | null };
  variant: { id: string; sku: string; title: string } | null;
  variantId: string | null;
  globalSku: string;
  franchiseSku: string | null;
  stockQty: number;
  reservedQty: number;
  availableQty: number;
  lowStockThreshold: number;
  mappingDisplayStatus: string;
  approvalStatus: string;
  isActive: boolean;
  isListedForOnlineFulfillment: boolean;
  updatedAt: string;
}
interface InventoryPanelData {
  loading: boolean;
  sellers: AdminSellerMapping[];
  franchises: AdminFranchiseMapping[];
  error?: string;
}

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

function statusTone(status: string): StatusTone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'SUBMITTED':
    case 'CHANGES_REQUESTED':
      return 'warning';
    case 'REJECTED':
      return 'danger';
    case 'APPROVED':
      return 'info';
    case 'DRAFT':
    case 'SUSPENDED':
    case 'ARCHIVED':
    default:
      return 'neutral';
  }
}

function statusStripeColor(tone: StatusTone): string {
  switch (tone) {
    case 'success': return '#16a34a';
    case 'warning': return '#d97706';
    case 'danger': return '#dc2626';
    case 'info': return '#2563eb';
    case 'neutral':
    default: return '#cbd5e1';
  }
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
  const [pendingApprovalsTab, setPendingApprovalsTab] = useState(false);
  const [pendingMappings, setPendingMappings] = useState<any[]>([]);
  const [pendingMappingsLoading, setPendingMappingsLoading] = useState(false);
  const [pendingMappingsCount, setPendingMappingsCount] = useState(0);
  const [mappingActionLoading, setMappingActionLoading] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductListItem | null>(null);

  // Inline inventory panel — track which rows are expanded and cache
  // their per-product breakdown so reopening doesn't re-fetch.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [inventoryCache, setInventoryCache] = useState<
    Record<string, InventoryPanelData>
  >({});

  const loadInventory = useCallback(async (productId: string) => {
    try {
      const [sellersRes, franchisesRes] = await Promise.allSettled([
        apiClient<{ mappings: AdminSellerMapping[] }>(
          `/admin/products/${productId}/seller-mappings`,
        ),
        apiClient<{ mappings: AdminFranchiseMapping[] }>(
          `/admin/products/${productId}/franchise-mappings`,
        ),
      ]);
      const sellers =
        sellersRes.status === 'fulfilled' ? sellersRes.value.data?.mappings ?? [] : [];
      const franchises =
        franchisesRes.status === 'fulfilled' ? franchisesRes.value.data?.mappings ?? [] : [];
      setInventoryCache((cache) => ({
        ...cache,
        [productId]: { loading: false, sellers, franchises },
      }));
    } catch {
      setInventoryCache((cache) => ({
        ...cache,
        [productId]: { loading: false, sellers: [], franchises: [], error: 'Failed to load inventory' },
      }));
    }
  }, []);

  const toggleExpanded = useCallback((productId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    // Lazy-load on first expansion. The cache is keyed per product
    // so a refresh-after-edit can be done by clearing one entry.
    setInventoryCache((cache) => {
      if (cache[productId]) return cache;
      void loadInventory(productId);
      return { ...cache, [productId]: { loading: true, sellers: [], franchises: [] } };
    });
  }, [loadInventory]);

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

  const handleApproveMappingInline = async (mappingId: string) => {setMappingActionLoading(mappingId);
    try {
      await adminProductsService.approveMappings(mappingId);
      setPendingMappings(prev => prev.filter(m => m.id !== mappingId));
      setPendingMappingsCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      void notify(err instanceof ApiError ? err.message : 'Failed to approve mapping');
    } finally {
      setMappingActionLoading(null);
    }
  };

  const handleStopMappingInline = async (mappingId: string) => {setMappingActionLoading(mappingId);
    try {
      await adminProductsService.stopMapping(mappingId);
      setPendingMappings(prev => prev.filter(m => m.id !== mappingId));
      setPendingMappingsCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      void notify(err instanceof ApiError ? err.message : 'Failed to stop mapping');
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

  const handleApprove = async (product: ProductListItem) => {try {
      await adminProductsService.approveProduct(product.id);
      fetchProducts({ page: pagination.page });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      void notify(err instanceof ApiError ? err.message : 'Failed to approve product');
    }
  };

  const handleStatusChange = async (product: ProductListItem, status: string) => {try {
      await adminProductsService.updateStatus(product.id, status);
      fetchProducts({ page: pagination.page });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      void notify(err instanceof ApiError ? err.message : 'Failed to update status');
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
          value={
            statusFilter ? `s:${statusFilter}` : moderationFilter ? `m:${moderationFilter}` : ''
          }
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              setStatusFilter('');
              setModerationFilter('');
            } else if (v.startsWith('s:')) {
              setStatusFilter(v.slice(2));
              setModerationFilter('');
            } else if (v.startsWith('m:')) {
              setModerationFilter(v.slice(2));
              setStatusFilter('');
            }
          }}
        >
          <option value="">All Status</option>
          <option value="s:DRAFT">Draft</option>
          <option value="s:SUBMITTED">Submitted</option>
          <option value="s:APPROVED">Approved</option>
          <option value="s:ACTIVE">Active</option>
          <option value="s:REJECTED">Rejected</option>
          <option value="s:CHANGES_REQUESTED">Changes Requested</option>
          <option value="s:SUSPENDED">Suspended</option>
          <option value="s:ARCHIVED">Archived</option>
          <option value="m:PENDING">Pending</option>
          <option value="m:IN_REVIEW">In Review</option>
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

      {/* Product cards — replaces the prior table layout. Each
          product is its own card; the expand chevron opens an
          inventory panel inside the card so the relationship
          between a product and its sources is visually contained. */}
      {!pendingApprovalsTab && (
      <div className="products-table-wrap">
        {loading ? (
          <SkeletonCards />
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
            <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  expanded={expandedRows.has(product.id)}
                  inventoryData={inventoryCache[product.id]}
                  onToggleExpand={() => toggleExpanded(product.id)}
                  onOpen={() => router.push(`/dashboard/products/${product.id}/edit`)}
                  formatPrice={formatPrice}
                  formatStatus={formatStatus}
                  actions={
                    product.seller ? (
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
                        style={{
                          padding: '6px 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          border: '1px solid #d1d5db',
                          borderRadius: 6,
                          background: '#fff',
                          cursor: 'pointer',
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/dashboard/products/${product.id}/edit`);
                        }}
                      >
                        View
                      </button>
                    )
                  }
                />
              ))}
            </div>

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

/* ── ProductCard ────────────────────────────────────────────── */
/* Replaces the table row with a card. Same shape as the seller
   cards inside the inventory panel — left tone stripe, breathable
   padding, expand chevron that opens the inventory inside the card. */

function ProductCard({
  product: p,
  expanded,
  inventoryData,
  onToggleExpand,
  onOpen,
  formatPrice,
  formatStatus,
  actions,
}: {
  product: ProductListItem;
  expanded: boolean;
  inventoryData: InventoryPanelData | undefined;
  onToggleExpand: () => void;
  onOpen: () => void;
  formatPrice: (price: string | null) => string | null;
  formatStatus: (status: string) => string;
  actions: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const tone = statusTone(p.status);
  const stripe = statusStripeColor(tone);

  return (
    <div
      role="listitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 12,
        borderLeft: `3px solid ${stripe}`,
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hover ? '0 2px 8px rgba(15, 23, 42, 0.06)' : 'none',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          cursor: 'pointer',
          background: expanded ? '#f8fafc' : '#fff',
        }}
      >
        {/* Image */}
        {p.primaryImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="product-thumb"
            src={p.primaryImageUrl}
            alt={p.title}
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              objectFit: 'cover',
              border: '1px solid #e2e8f0',
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            className="product-thumb-placeholder"
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" style={{ color: '#94a3b8' }}>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16v12H4zM4 14l4-4 5 5M14 10l2-2 4 4"
              />
            </svg>
          </div>
        )}

        {/* Title + meta line */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              fontWeight: 600,
              color: '#0f172a',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span title={p.title}>{p.title}</span>
            {p.potentialDuplicateOf && (
              <span
                title="Possible duplicate"
                aria-label="Possible duplicate"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  width: 14,
                  height: 14,
                  color: '#d97706',
                  flexShrink: 0,
                }}
              >
                <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                  <path fill="currentColor" d="M8 1l7 13H1L8 1zm0 5v3.5m0 2V11" />
                  <circle cx="8" cy="11.5" r="0.8" fill="currentColor" />
                </svg>
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              color: '#64748b',
              marginTop: 3,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
            }}
          >
            {p.seller && (
              <>
                <span style={{ fontWeight: 500, color: '#475569' }}>{p.seller.sellerName}</span>
                <span style={{ color: '#cbd5e1' }}>·</span>
              </>
            )}
            {p.category && (
              <>
                <span>{p.category.name}</span>
                <span style={{ color: '#cbd5e1' }}>·</span>
              </>
            )}
            <span
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 4,
                background: p.hasVariants ? '#ede9fe' : '#e0f2fe',
                color: p.hasVariants ? '#6d28d9' : '#0369a1',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {p.hasVariants ? 'Variant' : 'Normal'}
            </span>
            <span style={{ color: '#cbd5e1' }}>·</span>
            <span style={{ fontWeight: 600, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
              {p.hasVariants ? 'Multiple prices' : (formatPrice(p.basePrice) || '—')}
            </span>
          </div>
        </div>

        {/* Stock */}
        <div style={{ flexShrink: 0 }}>
          <StockCell product={p} />
        </div>

        {/* Status pill */}
        <div style={{ flexShrink: 0 }}>
          <Pill tone={tone} label={formatStatus(p.status)} />
        </div>

        {/* Moderation pill — visible only when it adds info beyond
            the lifecycle status (e.g. PENDING). When it equals
            APPROVED on an ACTIVE product, the lifecycle pill alone
            is enough. */}
        {p.moderationStatus && p.moderationStatus !== 'APPROVED' && (
          <div style={{ flexShrink: 0 }}>
            <Pill tone="warning" label={formatStatus(p.moderationStatus)} subtle />
          </div>
        )}

        {/* Actions menu */}
        <div
          style={{ flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>

        {/* Expand chevron */}
        <button
          type="button"
          aria-label={expanded ? 'Hide inventory' : 'Show inventory'}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            background: expanded ? '#e0e7ff' : 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            color: expanded ? '#3730a3' : '#64748b',
            transition: 'background 0.15s, color 0.15s, transform 0.15s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 3l5 5-5 5"
            />
          </svg>
        </button>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #e2e8f0' }}>
          <InventoryPanel product={p} data={inventoryData} />
        </div>
      )}
    </div>
  );
}

/* ── StockCell ──────────────────────────────────────────────── */

function StockCell({ product: p }: { product: ProductListItem }) {
  const summary = p.inventorySummary;
  const total = summary?.totalStock ?? p.totalStock ?? p.baseStock ?? 0;
  const available = summary?.totalAvailable ?? total;
  const sellerCount = summary?.sellerCount ?? 0;
  const franchiseCount = summary?.franchiseCount ?? 0;
  const lowStockCount = summary?.lowStockCount ?? 0;

  const tone = available === 0 ? '#b91c1c' : available <= 5 ? '#b45309' : '#0f172a';
  const captionParts: string[] = [];
  if (sellerCount > 0) captionParts.push(`${sellerCount} seller${sellerCount === 1 ? '' : 's'}`);
  if (franchiseCount > 0) captionParts.push(`${franchiseCount} franchise${franchiseCount === 1 ? '' : 's'}`);

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 1,
        lineHeight: 1.2,
      }}
    >
      <span
        style={{
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 14,
          color: tone,
        }}
        title={
          summary
            ? `${available} available · ${summary.totalReserved} reserved · ${total} total`
            : `${total} total`
        }
      >
        {available}
        {total !== available && (
          <span style={{ fontWeight: 400, color: '#94a3b8' }}> / {total}</span>
        )}
      </span>
      {captionParts.length > 0 && (
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
          {captionParts.join(' · ')}
        </span>
      )}
      {lowStockCount > 0 && available > 0 && (
        <span style={{ fontSize: 10, color: '#b45309', fontWeight: 600 }}>
          ⚠ {lowStockCount} low
        </span>
      )}
    </div>
  );
}

/* ── Pill ───────────────────────────────────────────────────── */

function Pill({ tone, label, subtle }: { tone: StatusTone; label: string; subtle?: boolean }) {
  const palette: Record<StatusTone, { bg: string; fg: string; dot: string }> = {
    success: { bg: '#dcfce7', fg: '#166534', dot: '#16a34a' },
    warning: { bg: '#fef3c7', fg: '#92400e', dot: '#d97706' },
    danger: { bg: '#fee2e2', fg: '#991b1b', dot: '#dc2626' },
    info: { bg: '#dbeafe', fg: '#1e40af', dot: '#2563eb' },
    neutral: { bg: '#f1f5f9', fg: '#475569', dot: '#94a3b8' },
  };
  const c = palette[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: subtle ? '3px 8px' : '4px 10px',
        background: subtle ? '#f8fafc' : c.bg,
        color: c.fg,
        borderRadius: 999,
        fontSize: subtle ? 10 : 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        border: subtle ? `1px solid ${c.bg}` : 'none',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot }} />
      {label}
    </span>
  );
}

/* ── Skeleton ───────────────────────────────────────────────── */

function SkeletonCards() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 18px',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            borderLeft: '3px solid #e2e8f0',
          }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 6, background: '#f1f5f9' }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: 240, background: '#f1f5f9', borderRadius: 4 }} />
            <div style={{ height: 12, width: 160, background: '#f1f5f9', borderRadius: 4, marginTop: 6 }} />
          </div>
          <div style={{ width: 60, height: 24, background: '#f1f5f9', borderRadius: 12 }} />
          <div style={{ width: 80, height: 24, background: '#f1f5f9', borderRadius: 12 }} />
          <div style={{ width: 28, height: 28, background: '#f1f5f9', borderRadius: 6 }} />
        </div>
      ))}
    </div>
  );
}

/* ── Inventory panel ───────────────────────────────────────── */

function InventoryPanel({
  product,
  data,
}: {
  product: ProductListItem;
  data: InventoryPanelData | undefined;
}) {
  const [tab, setTab] = useState<'sellers' | 'franchises'>('sellers');
  const summary = product.inventorySummary;
  const sellers = data?.sellers ?? [];
  const franchises = data?.franchises ?? [];

  useEffect(() => {
    if (!data || data.loading) return;
    if (sellers.length === 0 && franchises.length > 0) setTab('franchises');
  }, [data?.loading, sellers.length, franchises.length]);

  const showBothTabs = sellers.length > 0 && franchises.length > 0;
  const onlySellers = sellers.length > 0 && franchises.length === 0;
  const onlyFranchises = franchises.length > 0 && sellers.length === 0;

  const totalStock = summary?.totalStock ?? product.totalStock ?? 0;
  const totalAvailable = summary?.totalAvailable ?? 0;
  const totalReserved = summary?.totalReserved ?? 0;
  const lowStockCount = summary?.lowStockCount ?? 0;
  const sellerCount = summary?.sellerCount ?? 0;
  const franchiseCount = summary?.franchiseCount ?? 0;

  const availableTone: 'success' | 'warning' | 'danger' =
    totalAvailable === 0 ? 'danger' : totalAvailable <= 5 ? 'warning' : 'success';

  return (
    <div style={{ padding: '18px 18px 22px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 28,
          padding: '18px 22px',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontSize: 32,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
              letterSpacing: '-0.5px',
              color:
                availableTone === 'danger' ? '#b91c1c' :
                availableTone === 'warning' ? '#b45309' :
                '#16a34a',
            }}
          >
            {totalAvailable}
          </span>
          <span style={{ fontSize: 16, fontWeight: 500, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
            / {totalStock}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginLeft: 4 }}>
            available
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
          {totalReserved > 0 && <SummaryChip tone="info" label={`${totalReserved} reserved`} />}
          {sellerCount > 0 && <SummaryChip tone="neutral" label={`${sellerCount} seller${sellerCount === 1 ? '' : 's'}`} />}
          {franchiseCount > 0 && <SummaryChip tone="neutral" label={`${franchiseCount} franchise${franchiseCount === 1 ? '' : 's'}`} />}
          {lowStockCount > 0 && <SummaryChip tone="warning" label={`${lowStockCount} low stock`} />}
          {sellerCount === 0 && franchiseCount === 0 && <SummaryChip tone="neutral" label="No partners" />}
        </div>
      </div>

      {data?.loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          Loading inventory breakdown…
        </div>
      ) : data?.error ? (
        <div style={{ padding: 16, fontSize: 13, color: '#b91c1c' }}>{data.error}</div>
      ) : sellers.length === 0 && franchises.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: '#64748b' }}>
          No sellers or franchises mapped to this product yet.
        </div>
      ) : (
        <>
          {showBothTabs && (
            <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e2e8f0' }}>
              <PanelTab active={tab === 'sellers'} count={sellers.length} label="Sellers" onClick={() => setTab('sellers')} />
              <PanelTab active={tab === 'franchises'} count={franchises.length} label="Franchises" onClick={() => setTab('franchises')} />
            </div>
          )}
          {(onlySellers || (showBothTabs && tab === 'sellers')) && <SellerGroupedList sellers={sellers} />}
          {(onlyFranchises || (showBothTabs && tab === 'franchises')) && <FranchiseGroupedList franchises={franchises} />}
        </>
      )}
    </div>
  );
}

function SummaryChip({ tone, label }: { tone: 'neutral' | 'info' | 'warning'; label: string }) {
  const palette: Record<typeof tone, { dot: string; bg: string; fg: string }> = {
    neutral: { dot: '#94a3b8', bg: '#f8fafc', fg: '#475569' },
    info: { dot: '#2563eb', bg: '#eff6ff', fg: '#1d4ed8' },
    warning: { dot: '#d97706', bg: '#fffbeb', fg: '#b45309' },
  };
  const p = palette[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: p.bg, color: p.fg, borderRadius: 999, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.dot }} />
      {label}
    </span>
  );
}

function PanelTab({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '8px 14px',
        fontFamily: 'inherit',
        fontSize: 13,
        fontWeight: 600,
        color: active ? '#1d4ed8' : '#64748b',
        borderBottom: active ? '2px solid #1d4ed8' : '2px solid transparent',
        marginBottom: -1,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {label}
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 20, height: 20, padding: '0 6px', fontSize: 11, fontWeight: 700, borderRadius: 999, background: active ? '#dbeafe' : '#f1f5f9', color: active ? '#1d4ed8' : '#64748b' }}>
        {count}
      </span>
    </button>
  );
}

function HealthDot({ status }: { status: 'healthy' | 'low' | 'out' | 'inactive' }) {
  const palette = {
    healthy: { bg: '#16a34a', label: 'Healthy' },
    low: { bg: '#d97706', label: 'Low stock' },
    out: { bg: '#dc2626', label: 'Out of stock' },
    inactive: { bg: '#94a3b8', label: 'Inactive' },
  };
  const p = palette[status];
  return (
    <span title={p.label} aria-label={p.label} style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: p.bg, flexShrink: 0 }} />
  );
}

function rowHealth(available: number, threshold: number, approval: string | null, isActive: boolean): 'healthy' | 'low' | 'out' | 'inactive' {
  if (!isActive || (approval && approval !== 'APPROVED')) return 'inactive';
  if (available === 0) return 'out';
  if (available <= threshold) return 'low';
  return 'healthy';
}

interface PartnerRow {
  id: string;
  sku: string;
  label: string;
  stock: number;
  available: number;
  reserved: number;
  slaDays?: number;
  approval: string | null;
  isActive: boolean;
  lowThreshold: number;
  updated: string;
  extra?: string;
}

function SellerGroupedList({ sellers }: { sellers: AdminSellerMapping[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: AdminSellerMapping[] }>();
    for (const m of sellers) {
      const key = m.seller.id;
      if (!map.has(key)) map.set(key, { name: m.seller.sellerName, rows: [] });
      map.get(key)!.rows.push(m);
    }
    return Array.from(map.entries());
  }, [sellers]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {grouped.map(([id, group]) => (
        <PartnerCard
          key={id}
          name={group.name}
          subtitle={group.rows[0]?.seller.sellerZipCode ? `Pincode ${group.rows[0].seller.sellerZipCode}` : undefined}
          totals={{
            stock: group.rows.reduce((s, r) => s + r.stockQty, 0),
            available: group.rows.reduce((s, r) => s + r.availableQty, 0),
            variants: group.rows.length,
          }}
          rows={group.rows.map((r) => ({
            id: r.id,
            sku: r.sellerInternalSku || r.variant?.sku || '—',
            label: r.variant?.title || 'Default',
            stock: r.stockQty,
            available: r.availableQty,
            reserved: r.reservedQty,
            slaDays: r.dispatchSla,
            approval: r.approvalStatus,
            isActive: r.isActive,
            lowThreshold: r.lowStockThreshold,
            updated: r.updatedAt,
          }))}
        />
      ))}
    </div>
  );
}

function FranchiseGroupedList({ franchises }: { franchises: AdminFranchiseMapping[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; pincode: string | null; status: string; rows: AdminFranchiseMapping[] }>();
    for (const m of franchises) {
      const key = m.franchise.id;
      if (!map.has(key)) {
        map.set(key, { name: m.franchise.businessName, pincode: m.franchise.warehousePincode, status: m.franchise.status, rows: [] });
      }
      map.get(key)!.rows.push(m);
    }
    return Array.from(map.entries());
  }, [franchises]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {grouped.map(([id, group]) => (
        <PartnerCard
          key={id}
          name={group.name}
          tone="franchise"
          subtitle={group.pincode ? `Pincode ${group.pincode} · ${group.status}` : group.status}
          totals={{
            stock: group.rows.reduce((s, r) => s + r.stockQty, 0),
            available: group.rows.reduce((s, r) => s + r.availableQty, 0),
            variants: group.rows.length,
          }}
          rows={group.rows.map((r) => ({
            id: r.id,
            sku: r.franchiseSku || r.globalSku || '—',
            label: r.variant?.title || 'Product-level',
            stock: r.stockQty,
            available: r.availableQty,
            reserved: r.reservedQty,
            slaDays: undefined,
            approval: r.approvalStatus,
            isActive: r.isActive,
            lowThreshold: r.lowStockThreshold,
            updated: r.updatedAt,
            extra: r.isListedForOnlineFulfillment ? 'Listed' : 'Hidden',
          }))}
        />
      ))}
    </div>
  );
}

function PartnerCard({
  name,
  subtitle,
  totals,
  rows,
  tone = 'seller',
}: {
  name: string;
  subtitle?: string;
  totals: { stock: number; available: number; variants: number };
  rows: PartnerRow[];
  tone?: 'seller' | 'franchise';
}) {
  const [open, setOpen] = useState(false);
  const initial = (name || '?').charAt(0).toUpperCase();
  const palette =
    tone === 'franchise'
      ? { stripe: '#7c3aed', avatarBg: '#ede9fe', avatarFg: '#6d28d9' }
      : { stripe: '#2563eb', avatarBg: '#dbeafe', avatarFg: '#1d4ed8' };
  const availableTone =
    totals.available === 0 ? '#b91c1c' : totals.available <= 5 ? '#b45309' : '#16a34a';

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', borderLeft: `3px solid ${palette.stripe}` }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(!open);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          cursor: 'pointer',
          userSelect: 'none',
          background: open ? '#f8fafc' : '#fff',
        }}
      >
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: palette.avatarBg, color: palette.avatarFg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', lineHeight: 1.2 }}>{name}</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            {subtitle ? `${subtitle} · ` : ''}{totals.variants} variant{totals.variants === 1 ? '' : 's'} · {totals.stock} in stock
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: availableTone, lineHeight: 1 }}>
            {totals.available}
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            avail
          </span>
        </div>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style={{ color: '#94a3b8', transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6l4 4 4-4" />
        </svg>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid #e2e8f0' }}>
          {rows.map((r, idx) => {
            const health = rowHealth(r.available, r.lowThreshold, r.approval, r.isActive);
            const availableColor =
              health === 'out' ? '#b91c1c' : health === 'low' ? '#b45309' : '#0f172a';
            return (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 18px 12px 14px',
                  borderTop: idx === 0 ? 'none' : '1px solid #f1f5f9',
                }}
              >
                <HealthDot status={health} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.3 }}>
                    {r.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#475569' }}>{r.sku}</span>
                    <span style={{ color: '#cbd5e1' }}>·</span>
                    <span>{r.stock} in stock</span>
                    {r.reserved > 0 && (
                      <>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span style={{ color: '#854d0e', fontWeight: 600 }}>{r.reserved} reserved</span>
                      </>
                    )}
                    {r.approval && r.approval !== 'APPROVED' && (
                      <>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span style={{ color: '#475569', fontWeight: 600 }}>{r.approval.replace(/_/g, ' ')}</span>
                      </>
                    )}
                    {r.extra && (
                      <>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span>{r.extra}</span>
                      </>
                    )}
                    {r.slaDays !== undefined && (
                      <>
                        <span style={{ color: '#cbd5e1' }}>·</span>
                        <span>{r.slaDays}d SLA</span>
                      </>
                    )}
                    <span style={{ color: '#cbd5e1' }}>·</span>
                    <span style={{ color: '#94a3b8' }}>
                      {new Date(r.updated).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: availableColor, lineHeight: 1 }}>
                    {r.available}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
                    available
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
