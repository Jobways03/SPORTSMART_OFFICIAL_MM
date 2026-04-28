'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sellerProductService } from '@/services/product.service';
import { ApiError } from '@/lib/api-client';
import '../../products/product-form.css';
import '../../products/products.css';

// ===== Interfaces =====

interface MappingRow {
  id: string;
  variantId: string;
  variantSku: string | null;
  variantOptions: { option: string; value: string }[] | null;
  // stockQty = total physical units this seller holds.
  // reservedQty = units locked by in-flight customer orders that have
  //   reserved but not yet paid (15-min TTL).
  // Available = stockQty - reservedQty — that's what the storefront
  //   shows customers and what the seller actually has free to sell.
  stockQty: number;
  reservedQty?: number;
  dispatchSla: number;
  pickupPincode: string | null;
  isActive: boolean;
  approvalStatus?: string;
  sellerInternalSku?: string | null;
}

interface MappedProduct {
  id: string;
  productCode: string;
  title: string;
  primaryImageUrl: string | null;
  mappings: MappingRow[];
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface EditFormData {
  stockQty: string;
  pickupPincode: string;
  dispatchSla: string;
  isActive: boolean;
}

// ===== Component =====

export default function MyProductsPage() {
  const router = useRouter();

  // Data
  const [products, setProducts] = useState<MappedProduct[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seller status gating
  const [sellerStatus, setSellerStatus] = useState<string>('');
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(true);

  // Expandable rows — track which productIds are expanded
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Inline stock editing (per mapping)
  const [editingStockId, setEditingStockId] = useState<string | null>(null);
  const [editingStockValue, setEditingStockValue] = useState('');

  // Edit modal (per mapping row)
  const [showEditModal, setShowEditModal] = useState(false);
  const [editMapping, setEditMapping] = useState<{ product: MappedProduct; mapping: MappingRow } | null>(null);
  const [editForm, setEditForm] = useState<EditFormData>({ stockQty: '', pickupPincode: '', dispatchSla: '', isActive: true });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');

  // Delete confirm (per product — removes all mappings)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteProduct, setDeleteProduct] = useState<MappedProduct | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // ===== Seller status check =====
  useEffect(() => {
    try {
      const sellerData = sessionStorage.getItem('seller');
      if (sellerData) {
        const parsed = JSON.parse(sellerData);
        if (parsed.status) setSellerStatus(parsed.status);
        if (parsed.isEmailVerified !== undefined) setIsEmailVerified(parsed.isEmailVerified);
      }
    } catch {}
  }, []);

  const canAccess = sellerStatus === 'ACTIVE' && isEmailVerified;

  // ===== Fetch =====
  const fetchProducts = useCallback(async (params: { page?: number; search?: string } = {}) => {
    setLoading(true);
    setError('');
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const res = await sellerProductService.getMyMappedProducts(token, {
        page: params.page || pagination.page,
        limit: 20,
        search: params.search !== undefined ? params.search : search,
      });
      if (res.data) {
        setProducts(res.data.products || []);
        setPagination(res.data.pagination || { page: params.page || 1, limit: 20, total: 0, totalPages: 0 });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError('Failed to load your products. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, search, router]);

  useEffect(() => {
    if (!canAccess) return;
    fetchProducts({ page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  // ===== Search =====
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchProducts({ page: 1, search: value });
    }, 400);
  };

  // ===== Pagination =====
  const handlePageChange = (page: number) => {
    fetchProducts({ page });
  };

  // ===== Toast =====
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // ===== Expand / Collapse =====
  const toggleExpand = (productId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // ===== Helpers for product-level aggregation =====
  const getTotalStock = (product: MappedProduct): number =>
    product.mappings.reduce((sum, m) => sum + m.stockQty, 0);

  // Total reserved across all variant mappings of this product. This
  // is what's locked by in-flight customer orders right now.
  const getTotalReserved = (product: MappedProduct): number =>
    product.mappings.reduce((sum, m) => sum + (m.reservedQty ?? 0), 0);

  // Available = total stock minus reserved. Floor at 0 in case a row
  // ever drifts (race conditions caught by the API are rare but the
  // UI shouldn't show negative numbers).
  const getTotalAvailable = (product: MappedProduct): number =>
    Math.max(0, getTotalStock(product) - getTotalReserved(product));

  const getOverallActive = (product: MappedProduct): boolean =>
    product.mappings.some(m => m.isActive);

  // ===== Inline stock editing (per mapping) =====
  const startStockEdit = (mapping: MappingRow) => {
    setEditingStockId(mapping.id);
    setEditingStockValue(String(mapping.stockQty));
  };

  const cancelStockEdit = () => {
    setEditingStockId(null);
    setEditingStockValue('');
  };

  const saveStockEdit = async (mappingId: string) => {
    const qty = Number(editingStockValue);
    if (isNaN(qty) || qty < 0) {
      showToast('error', 'Stock must be 0 or more.');
      return;
    }
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.updateMapping(token, mappingId, { stockQty: qty });
      setProducts(prev =>
        prev.map(p => ({
          ...p,
          mappings: p.mappings.map(m => m.id === mappingId ? { ...m, stockQty: qty } : m),
        }))
      );
      showToast('success', 'Stock updated.');
      cancelStockEdit();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      showToast('error', err?.body?.message || 'Failed to update stock.');
    }
  };

  // ===== Toggle active (per mapping) =====
  const toggleActive = async (mappingId: string, currentActive: boolean) => {
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const newStatus = !currentActive;
      await sellerProductService.updateMapping(token, mappingId, { isActive: newStatus });
      setProducts(prev =>
        prev.map(p => ({
          ...p,
          mappings: p.mappings.map(m => m.id === mappingId ? { ...m, isActive: newStatus } : m),
        }))
      );
      showToast('success', newStatus ? 'Variant activated.' : 'Variant deactivated.');
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      showToast('error', err?.body?.message || 'Failed to update status.');
    }
  };

  // ===== Edit modal (per mapping) =====
  const openEditModal = (product: MappedProduct, mapping: MappingRow) => {
    setEditMapping({ product, mapping });
    setEditForm({
      stockQty: String(mapping.stockQty),
      pickupPincode: mapping.pickupPincode || '',
      dispatchSla: String(mapping.dispatchSla),
      isActive: mapping.isActive,
    });
    setEditError('');
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setEditMapping(null);
    setEditError('');
  };

  const handleEditFormChange = (field: keyof EditFormData, value: string | boolean) => {
    setEditForm(prev => ({ ...prev, [field]: value }));
  };

  const handleEditSubmit = async () => {
    if (!editMapping) return;
    if (!editForm.stockQty || Number(editForm.stockQty) < 0) {
      setEditError('Stock quantity is required and must be 0 or more.');
      return;
    }
    setEditLoading(true);
    setEditError('');
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const payload: any = {
        stockQty: Number(editForm.stockQty),
        dispatchSla: Number(editForm.dispatchSla) || 2,
        isActive: editForm.isActive,
      };
      if (editForm.pickupPincode) payload.pickupPincode = editForm.pickupPincode;

      await sellerProductService.updateMapping(token, editMapping.mapping.id, payload);
      setProducts(prev =>
        prev.map(p => ({
          ...p,
          mappings: p.mappings.map(m =>
            m.id === editMapping.mapping.id
              ? {
                  ...m,
                  stockQty: payload.stockQty,
                  dispatchSla: payload.dispatchSla,
                  isActive: payload.isActive,
                  pickupPincode: editForm.pickupPincode || null,
                }
              : m
          ),
        }))
      );
      showToast('success', 'Mapping updated successfully.');
      closeEditModal();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setEditError(err?.body?.message || err?.message || 'Failed to update mapping.');
    } finally {
      setEditLoading(false);
    }
  };

  // ===== Delete product (remove all mappings) =====
  const openDeleteConfirm = (product: MappedProduct) => {
    setDeleteProduct(product);
    setShowDeleteConfirm(true);
  };

  const closeDeleteConfirm = () => {
    setShowDeleteConfirm(false);
    setDeleteProduct(null);
  };

  const handleDelete = async () => {
    if (!deleteProduct) return;
    setDeleteLoading(true);
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      // Remove all mappings for this product
      for (const mapping of deleteProduct.mappings) {
        await sellerProductService.removeMapping(token, mapping.id);
      }
      setProducts(prev => prev.filter(p => p.id !== deleteProduct.id));
      setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
      showToast('success', `"${deleteProduct.title}" removed from your products.`);
      closeDeleteConfirm();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      showToast('error', err?.body?.message || 'Failed to remove product.');
    } finally {
      setDeleteLoading(false);
    }
  };

  // ===== Seller status gating render =====
  if (!canAccess) {
    const message = sellerStatus !== 'ACTIVE'
      ? 'Your account needs admin approval before you can manage products.'
      : 'Please verify your email before you can manage products.';
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

  // ===== Main render =====
  return (
    <div className="products-page">
      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>{toast.message}</div>
      )}

      {/* Header */}
      <div className="products-header">
        <h1>
          My Products
          {!loading && (
            <span className="products-header-count">({pagination.total})</span>
          )}
        </h1>
        <Link href="/dashboard/catalog" className="products-add-btn">
          + BROWSE CATALOG
        </Link>
      </div>

      {/* Search */}
      <div className="products-filters">
        <div className="products-search">
          <span className="products-search-icon">&#128269;</span>
          <input
            type="text"
            placeholder="Search your products..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        {search && (
          <button
            className="products-filter-clear-btn"
            onClick={() => { setSearch(''); fetchProducts({ page: 1, search: '' }); }}
          >
            Clear search
          </button>
        )}
      </div>

      {/* Table */}
      <div className="products-table-wrap">
        {loading ? (
          <div className="products-loading">Loading your products...</div>
        ) : error ? (
          <div className="products-error">
            <p>{error}</p>
            <button onClick={() => fetchProducts({ page: pagination.page })}>Retry</button>
          </div>
        ) : products.length === 0 ? (
          <div className="products-empty">
            <h3>{search ? 'No products match your search' : 'No mapped products yet'}</h3>
            <p>
              {search
                ? 'Try adjusting your search terms.'
                : 'Browse the catalog and add products you want to sell.'}
            </p>
            {!search && (
              <Link
                href="/dashboard/catalog"
                className="form-btn primary"
                style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}
              >
                Browse Catalog
              </Link>
            )}
          </div>
        ) : (
          <>
            <table className="products-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Product</th>
                  <th>Code</th>
                  <th>Variants</th>
                  <th>Total Stock</th>
                  <th>Status</th>
                  <th style={{ width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.flatMap(product => {
                  const isExpanded = expandedIds.has(product.id);
                  const totalStock = getTotalStock(product);
                  const totalReserved = getTotalReserved(product);
                  const totalAvailable = getTotalAvailable(product);
                  const overallActive = getOverallActive(product);
                  const variantCount = product.mappings.length;

                  const rows: React.ReactNode[] = [];

                  // Product summary row
                  rows.push(
                    <tr
                      key={`product-${product.id}`}
                      onClick={() => toggleExpand(product.id)}
                      style={{ cursor: 'pointer', background: isExpanded ? '#f9fafb' : undefined }}
                    >
                      <td style={{ textAlign: 'center', padding: '14px 8px 14px 16px' }}>
                        <span style={{ display: 'inline-block', fontSize: 12, color: '#6b7280', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
                      </td>
                      <td>
                        <div className="product-name-cell">
                          {product.primaryImageUrl ? (
                            <img className="product-thumb" src={product.primaryImageUrl} alt={product.title} />
                          ) : (
                            <div className="product-thumb-placeholder">&#128247;</div>
                          )}
                          <div className="product-name-text">
                            <span className="product-name-primary">{product.title}</span>
                          </div>
                        </div>
                      </td>
                      <td><span style={{ fontSize: 13, fontFamily: 'monospace', color: '#6b7280' }}>{product.productCode}</span></td>
                      <td>
                        <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 100, background: '#dbeafe', color: '#1d4ed8' }}>
                          {variantCount} variant{variantCount !== 1 ? 's' : ''}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.2 }}>
                          <span
                            className="product-stock"
                            style={{
                              fontVariantNumeric: 'tabular-nums',
                              color: totalAvailable === 0 ? '#b91c1c' : undefined,
                            }}
                            title={
                              totalReserved > 0
                                ? `${totalAvailable} available · ${totalReserved} reserved (in pending orders) · ${totalStock} total`
                                : `${totalStock} units in stock`
                            }
                          >
                            {totalAvailable}
                          </span>
                          {totalReserved > 0 && (
                            <span style={{ fontSize: 11, color: '#854d0e' }}>
                              {totalReserved} reserved · {totalStock} total
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {(() => {
                          // Show dominant approval status across all mappings
                          const statuses = product.mappings.map(m => m.approvalStatus || 'APPROVED');
                          const hasPending = statuses.includes('PENDING_APPROVAL');
                          const hasStopped = statuses.includes('STOPPED');
                          const allApproved = statuses.every(s => s === 'APPROVED');

                          if (hasPending) {
                            return (
                              <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 100, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                                PENDING APPROVAL
                              </span>
                            );
                          }
                          if (allApproved) {
                            return (
                              <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 100, background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}>
                                APPROVED
                              </span>
                            );
                          }
                          if (hasStopped) {
                            return (
                              <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 100, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
                                STOPPED
                              </span>
                            );
                          }
                          return (
                            <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 100, background: '#f3f4f6', color: '#6b7280', border: '1px solid #e5e7eb' }}>
                              {statuses[0]?.replace(/_/g, ' ') || 'UNKNOWN'}
                            </span>
                          );
                        })()}
                      </td>
                      <td>
                        <div className="variant-table-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="danger" onClick={() => openDeleteConfirm(product)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  );

                  // Expanded variant rows
                  if (isExpanded) {
                    for (const mapping of product.mappings) {
                      rows.push(
                        <tr key={`mapping-${mapping.id}`} style={{ background: '#fafbfd' }}>
                          <td style={{ padding: '10px 8px 10px 16px' }}></td>
                          <td style={{ paddingLeft: 68 }}>
                            <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{(mapping.variantOptions?.map(o => o.value).join(' / ') || 'Variant')}</span>
                          </td>
                          <td><span style={{ fontSize: 12, fontFamily: 'monospace', color: mapping.sellerInternalSku ? '#374151' : '#9ca3af' }}>{(mapping.sellerInternalSku || mapping.variantSku || '')}</span></td>
                          <td><span style={{ fontSize: 12, color: '#6b7280' }}>{mapping.dispatchSla} {mapping.dispatchSla === 1 ? 'day' : 'days'} SLA</span></td>
                          <td>
                            {editingStockId === mapping.id ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input type="number" min="0" value={editingStockValue} onChange={(e) => setEditingStockValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveStockEdit(mapping.id); if (e.key === 'Escape') cancelStockEdit(); }} autoFocus style={{ width: 70, padding: '4px 8px', fontSize: 13, border: '1px solid #303030', borderRadius: 6, outline: 'none' }} />
                                <button onClick={() => saveStockEdit(mapping.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', fontSize: 16, padding: '2px 4px' }} title="Save">&#10003;</button>
                                <button onClick={cancelStockEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16, padding: '2px 4px' }} title="Cancel">&#10005;</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.2 }}>
                                <span
                                  className="product-stock"
                                  onClick={() => startStockEdit(mapping)}
                                  style={{
                                    cursor: 'pointer',
                                    borderBottom: '1px dashed #9ca3af',
                                    paddingBottom: 1,
                                    fontVariantNumeric: 'tabular-nums',
                                    color:
                                      Math.max(0, mapping.stockQty - (mapping.reservedQty ?? 0)) === 0
                                        ? '#b91c1c'
                                        : undefined,
                                  }}
                                  title={
                                    (mapping.reservedQty ?? 0) > 0
                                      ? `${Math.max(0, mapping.stockQty - (mapping.reservedQty ?? 0))} available · ${mapping.reservedQty} reserved · ${mapping.stockQty} total. Click to edit total stock.`
                                      : `${mapping.stockQty} total · click to edit`
                                  }
                                >
                                  {Math.max(0, mapping.stockQty - (mapping.reservedQty ?? 0))}
                                </span>
                                {(mapping.reservedQty ?? 0) > 0 && (
                                  <span style={{ fontSize: 10, color: '#854d0e' }}>
                                    {mapping.reservedQty} reserved · {mapping.stockQty} total
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                          <td>
                            {(() => {
                              const status = mapping.approvalStatus || 'APPROVED';
                              let badgeBg = '#f3f4f6';
                              let badgeColor = '#6b7280';
                              let badgeBorder = '1px solid #e5e7eb';
                              let label = status.replace(/_/g, ' ');

                              if (status === 'APPROVED') {
                                badgeBg = '#dcfce7'; badgeColor = '#166534'; badgeBorder = '1px solid #bbf7d0'; label = 'APPROVED';
                              } else if (status === 'PENDING_APPROVAL') {
                                badgeBg = '#fef3c7'; badgeColor = '#92400e'; badgeBorder = '1px solid #fde68a'; label = 'PENDING';
                              } else if (status === 'STOPPED') {
                                badgeBg = '#fef2f2'; badgeColor = '#991b1b'; badgeBorder = '1px solid #fecaca'; label = 'STOPPED';
                              }

                              return (
                                <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 100, background: badgeBg, color: badgeColor, border: badgeBorder }}>
                                  {label}
                                </span>
                              );
                            })()}
                          </td>
                          <td>
                            <div className="variant-table-actions">
                              <button onClick={() => openEditModal(product, mapping)}>Edit</button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  }

                  return rows;
                })}
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

      {/* Edit Mapping Modal */}
      {showEditModal && editMapping && (
        <div className="variant-modal-overlay" onClick={closeEditModal}>
          <div className="variant-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="variant-modal-header">
              <h2>Edit Mapping</h2>
              <button className="variant-modal-close" onClick={closeEditModal}>&times;</button>
            </div>
            <div className="variant-modal-body">
              {/* Product + variant info */}
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
                {editMapping.product.primaryImageUrl ? (
                  <img
                    src={editMapping.product.primaryImageUrl}
                    alt={editMapping.product.title}
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
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#1f2937' }}>{editMapping.product.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {editMapping.mapping.variantOptions?.map(o => o.value).join(' / ') || 'Variant'}
                    {(editMapping.mapping.sellerInternalSku || editMapping.mapping.variantSku) ? ` — ${editMapping.mapping.sellerInternalSku || editMapping.mapping.variantSku}` : ''}
                  </div>
                </div>
              </div>

              {editError && (
                <div className="info-box warning" style={{ marginBottom: 16 }}>{editError}</div>
              )}

              <div className="form-group">
                <label className="form-label">
                  Stock Quantity <span className="required">*</span>
                </label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  value={editForm.stockQty}
                  onChange={(e) => handleEditFormChange('stockQty', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Pickup Pincode</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 400001"
                  maxLength={6}
                  value={editForm.pickupPincode}
                  onChange={(e) => handleEditFormChange('pickupPincode', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Dispatch SLA (days)</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  max="30"
                  value={editForm.dispatchSla}
                  onChange={(e) => handleEditFormChange('dispatchSla', e.target.value)}
                />
              </div>

              <div style={{ padding: '10px 0', fontSize: 12, color: '#6b7280', fontStyle: 'italic' }}>
                Approval status is managed by the admin. You can update stock, pincode, and dispatch SLA.
              </div>
            </div>
            <div className="variant-modal-footer">
              <button className="form-btn" onClick={closeEditModal} disabled={editLoading}>
                Cancel
              </button>
              <button
                className="form-btn primary"
                onClick={handleEditSubmit}
                disabled={editLoading}
              >
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && deleteProduct && (
        <div className="variant-modal-overlay" onClick={closeDeleteConfirm}>
          <div className="variant-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="variant-modal-header">
              <h2>Remove Product</h2>
              <button className="variant-modal-close" onClick={closeDeleteConfirm}>&times;</button>
            </div>
            <div className="variant-modal-body">
              <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.6 }}>
                Are you sure you want to remove <strong>{deleteProduct.title}</strong> from your products?
                This will unmap all {deleteProduct.mappings.length} variant{deleteProduct.mappings.length !== 1 ? 's' : ''} and you will no longer sell this product.
              </p>
              <div className="info-box warning" style={{ marginTop: 16 }}>
                This action cannot be undone. You can re-add the product from the catalog later.
              </div>
            </div>
            <div className="variant-modal-footer">
              <button className="form-btn" onClick={closeDeleteConfirm} disabled={deleteLoading}>
                Cancel
              </button>
              <button
                className="form-btn"
                style={{
                  background: '#dc2626', color: '#fff', borderColor: '#dc2626',
                }}
                onClick={handleDelete}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Removing...' : 'Remove Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Product Row Group (product row + expandable variant rows) =====

function ProductRowGroup({
  productKey,
  product,
  isExpanded,
  totalStock,
  overallActive,
  variantCount,
  onToggleExpand,
  onRemove,
  editingStockId,
  editingStockValue,
  onStartStockEdit,
  onCancelStockEdit,
  onSaveStockEdit,
  onSetEditingStockValue,
  onToggleActive,
  onEditMapping,
}: {
  productKey: string;
  product: MappedProduct;
  isExpanded: boolean;
  totalStock: number;
  overallActive: boolean;
  variantCount: number;
  onToggleExpand: () => void;
  onRemove: () => void;
  editingStockId: string | null;
  editingStockValue: string;
  onStartStockEdit: (mapping: MappingRow) => void;
  onCancelStockEdit: () => void;
  onSaveStockEdit: (mappingId: string) => void;
  onSetEditingStockValue: (value: string) => void;
  onToggleActive: (mappingId: string, currentActive: boolean) => void;
  onEditMapping: (mapping: MappingRow) => void;
}) {
  return (
    <React.Fragment key={productKey}>
      {/* Product summary row */}
      <tr
        onClick={onToggleExpand}
        style={{ cursor: 'pointer', background: isExpanded ? '#f9fafb' : undefined }}
      >
        <td style={{ textAlign: 'center', padding: '14px 8px 14px 16px' }}>
          <span style={{
            display: 'inline-block',
            fontSize: 12,
            color: '#6b7280',
            transition: 'transform 0.2s',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>
            &#9654;
          </span>
        </td>
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
            {product.productCode}
          </span>
        </td>
        <td>
          <span style={{
            display: 'inline-block',
            padding: '3px 10px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 100,
            background: '#dbeafe',
            color: '#1d4ed8',
          }}>
            {variantCount} variant{variantCount !== 1 ? 's' : ''}
          </span>
        </td>
        <td>
          <span className="product-stock">{totalStock}</span>
        </td>
        <td>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 100,
            background: overallActive ? '#dcfce7' : '#f3f4f6',
            color: overallActive ? '#15803d' : '#6b7280',
          }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: overallActive ? '#16a34a' : '#9ca3af',
            }} />
            {overallActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </td>
        <td>
          <div className="variant-table-actions" onClick={(e) => e.stopPropagation()}>
            <button className="danger" onClick={onRemove}>Remove</button>
          </div>
        </td>
      </tr>

      {/* Expanded variant rows */}
      {isExpanded && product.mappings.map(mapping => (
        <tr
          key={mapping.id}
          style={{ background: '#fafbfd' }}
        >
          <td style={{ padding: '10px 8px 10px 16px' }}></td>
          <td style={{ paddingLeft: 68 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
                {(mapping.variantOptions?.map(o => o.value).join(' / ') || 'Variant')}
              </span>
            </div>
          </td>
          <td>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: mapping.sellerInternalSku ? '#374151' : '#9ca3af' }}>
              {(mapping.sellerInternalSku || mapping.variantSku || '')}
            </span>
          </td>
          <td>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {mapping.dispatchSla} {mapping.dispatchSla === 1 ? 'day' : 'days'} SLA
            </span>
          </td>
          <td>
            {editingStockId === mapping.id ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number"
                  min="0"
                  value={editingStockValue}
                  onChange={(e) => onSetEditingStockValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSaveStockEdit(mapping.id);
                    if (e.key === 'Escape') onCancelStockEdit();
                  }}
                  autoFocus
                  style={{
                    width: 70, padding: '4px 8px', fontSize: 13,
                    border: '1px solid var(--color-primary)', borderRadius: 6,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => onSaveStockEdit(mapping.id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#16a34a', fontSize: 16, padding: '2px 4px',
                  }}
                  title="Save"
                >
                  &#10003;
                </button>
                <button
                  onClick={onCancelStockEdit}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#dc2626', fontSize: 16, padding: '2px 4px',
                  }}
                  title="Cancel"
                >
                  &#10005;
                </button>
              </div>
            ) : (
              <span
                className="product-stock"
                onClick={() => onStartStockEdit(mapping)}
                style={{ cursor: 'pointer', borderBottom: '1px dashed #9ca3af', paddingBottom: 1 }}
                title="Click to edit stock"
              >
                {mapping.stockQty}
              </span>
            )}
          </td>
          <td>
            <button
              onClick={() => onToggleActive(mapping.id, mapping.isActive)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 100,
                border: 'none',
                cursor: 'pointer',
                background: mapping.isActive ? '#dcfce7' : '#f3f4f6',
                color: mapping.isActive ? '#15803d' : '#6b7280',
                transition: 'all 0.15s',
              }}
              title={mapping.isActive ? 'Click to deactivate' : 'Click to activate'}
            >
              <span style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: mapping.isActive ? '#16a34a' : '#9ca3af',
              }} />
              {mapping.isActive ? 'ACTIVE' : 'INACTIVE'}
            </button>
          </td>
          <td>
            <div className="variant-table-actions">
              <button onClick={() => onEditMapping(mapping)}>Edit</button>
            </div>
          </td>
        </tr>
      ))}
    </React.Fragment>
  );
}

// ===== Pagination helper =====

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
