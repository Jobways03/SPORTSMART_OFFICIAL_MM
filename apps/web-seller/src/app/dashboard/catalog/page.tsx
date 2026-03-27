'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { sellerProductService } from '@/services/product.service';
import { ApiError } from '@/lib/api-client';
import '../products/product-form.css';
import '../products/products.css';

interface CatalogProduct {
  id: string;
  title: string;
  productCode: string;
  slug: string;
  hasVariants: boolean;
  categoryName: string | null;
  brandName: string | null;
  primaryImageUrl: string | null;
  variantCount: number;
  basePrice: string | null;
  status: string;
}

interface VariantInfo {
  id: string;
  masterSku: string;
  title: string;
  stockQty: string;
  sellerInternalSku: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface MapFormData {
  stockQty: string;
  pickupPincode: string;
  dispatchSla: string;
  sellerInternalSku: string;
}

const defaultMapForm: MapFormData = {
  stockQty: '',
  pickupPincode: '',
  dispatchSla: '2',
  sellerInternalSku: '',
};

export default function BrowseCatalogPage() {
  const router = useRouter();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seller status gating
  const [sellerStatus, setSellerStatus] = useState<string>('');
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(true);

  // Modal state
  const [showMapModal, setShowMapModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [mapForm, setMapForm] = useState<MapFormData>(defaultMapForm);
  const [mapLoading, setMapLoading] = useState(false);
  const [variantStocks, setVariantStocks] = useState<VariantInfo[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [mapError, setMapError] = useState('');

  // Default pincode from seller profile
  const [defaultPincode, setDefaultPincode] = useState('');

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    try {
      const sellerData = sessionStorage.getItem('seller');
      if (sellerData) {
        const parsed = JSON.parse(sellerData);
        if (parsed.status) setSellerStatus(parsed.status);
        if (parsed.isEmailVerified !== undefined) setIsEmailVerified(parsed.isEmailVerified);
      }
    } catch {}

    // Fetch seller profile to get default pickup pincode
    const token = sessionStorage.getItem('accessToken');
    if (token) {
      fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/seller/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(d => {
          if (d.data?.sellerZipCode) {
            setDefaultPincode(d.data.sellerZipCode);
          }
        })
        .catch(() => {});
    }
  }, []);

  const canAccess = sellerStatus === 'ACTIVE' && isEmailVerified;

  const fetchCatalog = useCallback(async (params: { page?: number; search?: string } = {}) => {
    setLoading(true);
    setError('');
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const res = await sellerProductService.browseCatalog(token, {
        page: params.page || pagination.page,
        limit: 20,
        search: params.search !== undefined ? params.search : search,
      });
      if (res.data) {
        setProducts(res.data.products || res.data.items || []);
        setPagination(res.data.pagination || { page: params.page || 1, limit: 20, total: 0, totalPages: 0 });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError('Failed to load catalog. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, search, router]);

  useEffect(() => {
    if (!canAccess) return;
    fetchCatalog({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchCatalog({ page: 1, search: value });
    }, 400);
  };

  const handlePageChange = (page: number) => {
    fetchCatalog({ page });
  };

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // Map modal
  const openMapModal = async (product: CatalogProduct) => {
    setSelectedProduct(product);
    setMapForm({ ...defaultMapForm, pickupPincode: defaultPincode });
    setMapError('');
    setVariantStocks([]);
    setShowMapModal(true);

    // For variant products, fetch variant details
    if (product.hasVariants && product.variantCount > 0 && product.slug) {
      setLoadingVariants(true);
      try {
        const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
        const res = await fetch(`${API_BASE}/api/v1/storefront/products/${product.slug}`);
        const data = await res.json();
        if (data.success && data.data?.variants) {
          setVariantStocks(
            data.data.variants.map((v: any) => ({
              id: v.id,
              masterSku: v.masterSku || v.title || 'Variant',
              title: v.title || v.masterSku || 'Variant',
              stockQty: '0',
              sellerInternalSku: '',
            }))
          );
        }
      } catch {
        // Fallback: just use the single stock form
      } finally {
        setLoadingVariants(false);
      }
    }
  };

  const closeMapModal = () => {
    setShowMapModal(false);
    setSelectedProduct(null);
    setMapForm(defaultMapForm);
    setVariantStocks([]);
    setMapError('');
  };

  const handleMapFormChange = (field: keyof MapFormData, value: string) => {
    setMapForm(prev => ({ ...prev, [field]: value }));
  };

  const handleMapSubmit = async () => {
    if (!selectedProduct) return;

    // For variant products, validate each variant has stock
    if (variantStocks.length > 0) {
      const hasAnyStock = variantStocks.some(v => Number(v.stockQty) > 0);
      if (!hasAnyStock) {
        setMapError('At least one variant must have stock greater than 0.');
        return;
      }
    } else {
      if (!mapForm.stockQty || Number(mapForm.stockQty) < 0) {
        setMapError('Stock quantity is required and must be 0 or more.');
        return;
      }
    }

    setMapLoading(true);
    setMapError('');
    try {
      const token = sessionStorage.getItem('accessToken') || '';

      if (variantStocks.length > 0) {
        // Map each variant individually with its own stock
        for (const variant of variantStocks) {
          if (Number(variant.stockQty) <= 0) continue; // Skip variants with 0 stock
          const payload: any = {
            productId: selectedProduct.id,
            variantId: variant.id,
            stockQty: Number(variant.stockQty),
            dispatchSla: Number(mapForm.dispatchSla) || 2,
          };
          if (mapForm.pickupPincode) payload.pickupPincode = mapForm.pickupPincode;
          if (variant.sellerInternalSku.trim()) payload.sellerInternalSku = variant.sellerInternalSku.trim();
          await sellerProductService.mapToProduct(token, payload);
        }
      } else {
        // Simple product — single mapping
        const payload: any = {
          productId: selectedProduct.id,
          stockQty: Number(mapForm.stockQty),
          dispatchSla: Number(mapForm.dispatchSla) || 2,
        };
        if (mapForm.pickupPincode) payload.pickupPincode = mapForm.pickupPincode;
        if (mapForm.sellerInternalSku.trim()) payload.sellerInternalSku = mapForm.sellerInternalSku.trim();
        await sellerProductService.mapToProduct(token, payload);
      }

      showToast('success', `Mapping submitted for "${selectedProduct.title}"! Pending admin approval.`);
      closeMapModal();
      setProducts(prev => prev.filter(p => p.id !== selectedProduct.id));
      setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      const msg = err?.body?.message || err?.message || 'Failed to map product. Please try again.';
      setMapError(msg);
    } finally {
      setMapLoading(false);
    }
  };

  if (!canAccess) {
    const message = sellerStatus !== 'ACTIVE'
      ? 'Your account needs admin approval before you can browse the catalog.'
      : 'Please verify your email before you can browse the catalog.';
    const heading = sellerStatus !== 'ACTIVE'
      ? 'Account Approval Required'
      : 'Email Verification Required';
    return (
      <div className="products-page">
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
          <h2 style={{ color: '#1f2937', marginBottom: 8 }}>{heading}</h2>
          <p>{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="products-page">
      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>{toast.message}</div>
      )}

      {/* Header */}
      <div className="products-header">
        <h1>
          Browse Catalog
          {!loading && (
            <span className="products-header-count">({pagination.total})</span>
          )}
        </h1>
      </div>

      {/* Search */}
      <div className="products-filters">
        <div className="products-search">
          <span className="products-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search catalog by name, code, brand..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        {search && (
          <button
            className="products-filter-clear-btn"
            onClick={() => { setSearch(''); fetchCatalog({ page: 1, search: '' }); }}
          >
            Clear search
          </button>
        )}
      </div>

      {/* Table */}
      <div className="products-table-wrap">
        {loading ? (
          <div className="products-loading">Loading catalog...</div>
        ) : error ? (
          <div className="products-error">
            <p>{error}</p>
            <button onClick={() => fetchCatalog({ page: pagination.page })}>Retry</button>
          </div>
        ) : products.length === 0 ? (
          <div className="products-empty">
            <h3>{search ? 'No products match your search' : 'No products available'}</h3>
            <p>
              {search
                ? 'Try adjusting your search terms.'
                : 'There are no active products in the catalog to browse right now.'}
            </p>
          </div>
        ) : (
          <>
            <table className="products-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Code</th>
                  <th>Category</th>
                  <th>Brand</th>
                  <th>Variants</th>
                  <th>Price</th>
                  <th style={{ width: 160 }}>Action</th>
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
                          <span className="product-name-primary">{product.title}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#6b7280' }}>
                        {product.productCode || '\u2014'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 13 }}>
                        {product.categoryName || '\u2014'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 13 }}>
                        {product.brandName || '\u2014'}
                      </span>
                    </td>
                    <td>
                      <span className={`type-badge ${product.variantCount > 0 ? 'variant' : 'normal'}`}>
                        {product.variantCount > 0 ? `${product.variantCount} variants` : 'Single'}
                      </span>
                    </td>
                    <td>
                      <span className="product-price">
                        {product.basePrice ? formatPrice(product.basePrice) : '\u2014'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="form-btn primary"
                        style={{ padding: '7px 16px', fontSize: 12 }}
                        onClick={() => openMapModal(product)}
                      >
                        + Add to My Products
                      </button>
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

      {/* Map Product Modal */}
      {showMapModal && selectedProduct && (
        <div className="variant-modal-overlay" onClick={closeMapModal}>
          <div className="variant-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="variant-modal-header">
              <h2>Add to My Products</h2>
              <button className="variant-modal-close" onClick={closeMapModal}>&times;</button>
            </div>
            <div className="variant-modal-body">
              {/* Product being mapped */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 16px',
                background: '#f9fafb',
                borderRadius: 10,
                marginBottom: 20,
                border: '1px solid #e5e7eb',
              }}>
                {selectedProduct.primaryImageUrl ? (
                  <img
                    src={selectedProduct.primaryImageUrl}
                    alt={selectedProduct.title}
                    style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{
                    width: 48, height: 48, borderRadius: 8, background: '#e5e7eb',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#9ca3af', fontSize: 18,
                  }}>
                    &#128247;
                  </div>
                )}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1f2937' }}>{selectedProduct.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>
                    {selectedProduct.productCode || 'No code'}
                  </div>
                </div>
              </div>

              {mapError && (
                <div className="info-box warning" style={{ marginBottom: 16 }}>{mapError}</div>
              )}

              {/* Stock: per-variant or single */}
              {loadingVariants ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>Loading variants...</div>
              ) : variantStocks.length > 0 ? (
                <div className="form-group">
                  <label className="form-label">Stock per Variant <span className="required">*</span></label>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f9fafb' }}>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}>Variant</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e5e7eb', width: 100 }}>Stock</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid #e5e7eb', width: 120 }}>Internal SKU</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variantStocks.map((v, idx) => (
                          <tr key={v.id} style={{ borderBottom: idx < variantStocks.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                            <td style={{ padding: '8px 12px' }}>
                              <div style={{ fontWeight: 500 }}>{v.title}</div>
                              <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{v.masterSku}</div>
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <input
                                type="number"
                                className="form-input"
                                style={{ padding: '6px 10px', fontSize: 13 }}
                                placeholder="0"
                                min="0"
                                value={v.stockQty}
                                onChange={(e) => {
                                  const updated = [...variantStocks];
                                  updated[idx] = { ...updated[idx], stockQty: e.target.value };
                                  setVariantStocks(updated);
                                }}
                              />
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <input
                                type="text"
                                className="form-input"
                                style={{ padding: '6px 10px', fontSize: 13 }}
                                placeholder="Optional"
                                value={v.sellerInternalSku}
                                onChange={(e) => {
                                  const updated = [...variantStocks];
                                  updated[idx] = { ...updated[idx], sellerInternalSku: e.target.value };
                                  setVariantStocks(updated);
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <span className="form-hint">Set stock for each variant you want to sell. Variants with 0 stock will be skipped.</span>
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">
                    Stock Quantity <span className="required">*</span>
                  </label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="e.g. 100"
                    min="0"
                    value={mapForm.stockQty}
                    onChange={(e) => handleMapFormChange('stockQty', e.target.value)}
                  />
                </div>
              )}

              {/* Internal SKU — only shown for simple products (variant products have it in the table) */}
              {variantStocks.length === 0 && (
                <div className="form-group">
                  <label className="form-label">Internal SKU (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Your own reference code"
                    value={mapForm.sellerInternalSku}
                    onChange={(e) => handleMapFormChange('sellerInternalSku', e.target.value)}
                  />
                  <span className="form-hint">Your internal reference code for this product.</span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Pickup Pincode</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 400001"
                  maxLength={6}
                  value={mapForm.pickupPincode}
                  onChange={(e) => handleMapFormChange('pickupPincode', e.target.value)}
                />
                <span className="form-hint">{defaultPincode ? 'Auto-filled from your profile. Change if shipping from a different location.' : 'Where this product will ship from.'}</span>
              </div>

              <div className="form-group">
                <label className="form-label">Dispatch SLA (days)</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="2"
                  min="1"
                  max="30"
                  value={mapForm.dispatchSla}
                  onChange={(e) => handleMapFormChange('dispatchSla', e.target.value)}
                />
                <span className="form-hint">Maximum days to dispatch after order placement. Default: 2 days.</span>
              </div>
            </div>
            <div className="variant-modal-footer">
              <button className="form-btn" onClick={closeMapModal} disabled={mapLoading}>
                Cancel
              </button>
              <button
                className="form-btn primary"
                onClick={handleMapSubmit}
                disabled={mapLoading}
              >
                {mapLoading ? 'Adding...' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatPrice(price: string | null) {
  if (!price) return null;
  const num = parseFloat(price);
  if (isNaN(num)) return price;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
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
