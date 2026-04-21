'use client';

import { useEffect, useState, FormEvent, useCallback } from 'react';
import {
  franchiseCatalogService,
  AvailableProduct,
  CatalogMapping,
  AddMappingPayload,
  UpdateMappingPayload,
} from '@/services/catalog.service';
import { ApiError } from '@/lib/api-client';

type TabKey = 'mine' | 'browse';

const PAGE_LIMIT = 12;

function formatPrice(value: number | null | undefined): string {
  if (value == null) return '—';
  return `\u20B9${Number(value).toLocaleString('en-IN')}`;
}

function primaryImage(
  images?: Array<{ url: string; isPrimary: boolean }>,
): string | null {
  if (!images || images.length === 0) return null;
  const primary = images.find((img) => img.isPrimary);
  return primary ? primary.url : images[0].url;
}

function approvalColor(status: string): string {
  switch (status) {
    case 'APPROVED':
      return '#16a34a';
    case 'PENDING':
    case 'PENDING_APPROVAL':
      return '#d97706';
    case 'REJECTED':
      return '#dc2626';
    default:
      return '#6b7280';
  }
}

function formatApprovalStatus(status: string): string {
  switch (status) {
    case 'PENDING_APPROVAL':
      return 'Pending';
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    default:
      return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

export default function CatalogPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('mine');

  // ---- My Catalog state ----
  const [mappings, setMappings] = useState<CatalogMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(true);
  const [mappingsPage, setMappingsPage] = useState(1);
  const [mappingsTotalPages, setMappingsTotalPages] = useState(1);
  const [mappingsTotal, setMappingsTotal] = useState(0);
  const [mineSearch, setMineSearch] = useState('');
  const [mineSearchInput, setMineSearchInput] = useState('');
  const [mineIsActive, setMineIsActive] = useState<string>('');
  const [mineApproval, setMineApproval] = useState<string>('');
  const [mineError, setMineError] = useState('');

  // ---- Browse Products state ----
  const [products, setProducts] = useState<AvailableProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsPage, setProductsPage] = useState(1);
  const [productsTotalPages, setProductsTotalPages] = useState(1);
  const [productsTotal, setProductsTotal] = useState(0);
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseSearchInput, setBrowseSearchInput] = useState('');
  const [browseError, setBrowseError] = useState('');

  // ---- Shared feedback ----
  const [successMessage, setSuccessMessage] = useState('');

  // ---- Edit mapping modal ----
  const [editMapping, setEditMapping] = useState<CatalogMapping | null>(null);
  const [editForm, setEditForm] = useState<UpdateMappingPayload>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // ---- Add mapping modal ----
  const [addProduct, setAddProduct] = useState<AvailableProduct | null>(null);
  const [addForm, setAddForm] = useState<{
    franchiseSku: string;
    barcode: string;
    isListedForOnlineFulfillment: boolean;
    variantId: string | null;
  }>({ franchiseSku: '', barcode: '', isListedForOnlineFulfillment: true, variantId: null });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');

  // ---- Remove mapping state ----
  const [removingId, setRemovingId] = useState<string | null>(null);

  const flashSuccess = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  // ---- Loaders ----
  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    setMineError('');
    try {
      const res = await franchiseCatalogService.listMappings({
        page: mappingsPage,
        limit: PAGE_LIMIT,
        search: mineSearch || undefined,
        isActive:
          mineIsActive === 'true' ? true : mineIsActive === 'false' ? false : undefined,
        approvalStatus: mineApproval || undefined,
      });
      if (res.data) {
        setMappings(res.data.mappings || []);
        setMappingsTotal(res.data.total || 0);
        setMappingsTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setMineError(err.body.message || 'Failed to load catalog');
      } else {
        setMineError('Failed to load catalog');
      }
    } finally {
      setMappingsLoading(false);
    }
  }, [mappingsPage, mineSearch, mineIsActive, mineApproval]);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    setBrowseError('');
    try {
      const res = await franchiseCatalogService.browseProducts({
        page: productsPage,
        limit: PAGE_LIMIT,
        search: browseSearch || undefined,
      });
      if (res.data) {
        setProducts(res.data.products || []);
        setProductsTotal(res.data.total || 0);
        setProductsTotalPages(res.data.totalPages || 1);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setBrowseError(err.body.message || 'Failed to load products');
      } else {
        setBrowseError('Failed to load products');
      }
    } finally {
      setProductsLoading(false);
    }
  }, [productsPage, browseSearch]);

  useEffect(() => {
    if (activeTab === 'mine') {
      loadMappings();
    }
  }, [activeTab, loadMappings]);

  useEffect(() => {
    if (activeTab === 'browse') {
      loadProducts();
    }
  }, [activeTab, loadProducts]);

  // ---- Handlers: My Catalog ----
  const handleMineSearch = () => {
    setMappingsPage(1);
    setMineSearch(mineSearchInput.trim());
  };

  const openEditModal = (mapping: CatalogMapping) => {
    setEditMapping(mapping);
    setEditForm({
      franchiseSku: mapping.franchiseSku || '',
      barcode: mapping.barcode || '',
      isListedForOnlineFulfillment: mapping.isListedForOnlineFulfillment,
    });
    setEditError('');
  };

  const closeEditModal = () => {
    if (editSaving) return;
    setEditMapping(null);
    setEditError('');
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editMapping) return;
    setEditError('');
    setEditSaving(true);
    try {
      const payload: UpdateMappingPayload = {
        franchiseSku: (editForm.franchiseSku || '').trim() || undefined,
        barcode: (editForm.barcode || '').trim() || undefined,
        isListedForOnlineFulfillment: editForm.isListedForOnlineFulfillment,
      };
      await franchiseCatalogService.updateMapping(editMapping.id, payload);
      setEditMapping(null);
      flashSuccess('Mapping updated');
      await loadMappings();
    } catch (err) {
      if (err instanceof ApiError) {
        setEditError(err.body.message || 'Failed to update mapping');
      } else {
        setEditError('Failed to update mapping');
      }
    } finally {
      setEditSaving(false);
    }
  };

  const handleRemoveMapping = async (mapping: CatalogMapping) => {
    const title = mapping.product?.title || 'this product';
    if (!window.confirm(`Remove "${title}" from your catalog?`)) return;
    setRemovingId(mapping.id);
    try {
      await franchiseCatalogService.removeMapping(mapping.id);
      flashSuccess('Removed from catalog');
      await loadMappings();
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.body.message || 'Failed to remove mapping');
      } else {
        alert('Failed to remove mapping');
      }
    } finally {
      setRemovingId(null);
    }
  };

  // ---- Handlers: Browse ----
  const handleBrowseSearch = () => {
    setProductsPage(1);
    setBrowseSearch(browseSearchInput.trim());
  };

  const openAddModal = (product: AvailableProduct) => {
    setAddProduct(product);
    // If the product has exactly one variant, preselect it so the
    // operator doesn't have to click. Multi-variant products force an
    // explicit choice before the submit button enables.
    const variants = product.variants ?? [];
    const preselect = variants.length === 1 ? variants[0].id : null;
    setAddForm({
      franchiseSku: '',
      barcode: '',
      isListedForOnlineFulfillment: true,
      variantId: preselect,
    });
    setAddError('');
  };

  const closeAddModal = () => {
    if (addSaving) return;
    setAddProduct(null);
    setAddError('');
  };

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!addProduct) return;

    // Multi-variant products must pick a variant. Fail fast with a
    // friendly message rather than sending an ambiguous payload the
    // backend's assertVariantBelongsToProduct will reject at runtime.
    const variants = addProduct.variants ?? [];
    if (variants.length > 0 && !addForm.variantId) {
      setAddError('Please pick a variant to map.');
      return;
    }

    setAddError('');
    setAddSaving(true);
    try {
      const payload: AddMappingPayload = {
        productId: addProduct.id,
        variantId: addForm.variantId || undefined,
        franchiseSku: addForm.franchiseSku.trim() || undefined,
        barcode: addForm.barcode.trim() || undefined,
        isListedForOnlineFulfillment: addForm.isListedForOnlineFulfillment,
      };
      await franchiseCatalogService.addMapping(payload);
      setAddProduct(null);
      flashSuccess('Added to your catalog');
      // Refresh both tabs' data so switching tab shows the new mapping
      await loadProducts();
    } catch (err) {
      if (err instanceof ApiError) {
        setAddError(err.body.message || 'Failed to add to catalog');
      } else {
        setAddError('Failed to add to catalog');
      }
    } finally {
      setAddSaving(false);
    }
  };

  // ---- Render ----
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Catalog</h1>
          <p>Manage the products your franchise stocks and lists for online fulfillment.</p>
        </div>
      </div>

      {successMessage && (
        <div className="alert alert-success" role="status">
          {successMessage}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid #e5e7eb',
          marginBottom: 20,
        }}
      >
        <TabButton
          label="My Catalog"
          active={activeTab === 'mine'}
          onClick={() => setActiveTab('mine')}
          count={mappingsTotal}
        />
        <TabButton
          label="Browse Products"
          active={activeTab === 'browse'}
          onClick={() => setActiveTab('browse')}
          count={productsTotal}
        />
      </div>

      {activeTab === 'mine' && (
        <MyCatalogTab
          mappings={mappings}
          loading={mappingsLoading}
          error={mineError}
          page={mappingsPage}
          totalPages={mappingsTotalPages}
          total={mappingsTotal}
          searchInput={mineSearchInput}
          setSearchInput={setMineSearchInput}
          onSearch={handleMineSearch}
          isActive={mineIsActive}
          setIsActive={(v) => {
            setMineIsActive(v);
            setMappingsPage(1);
          }}
          approval={mineApproval}
          setApproval={(v) => {
            setMineApproval(v);
            setMappingsPage(1);
          }}
          onPageChange={setMappingsPage}
          onEdit={openEditModal}
          onRemove={handleRemoveMapping}
          removingId={removingId}
          onGoBrowse={() => setActiveTab('browse')}
        />
      )}

      {activeTab === 'browse' && (
        <BrowseProductsTab
          products={products}
          loading={productsLoading}
          error={browseError}
          page={productsPage}
          totalPages={productsTotalPages}
          searchInput={browseSearchInput}
          setSearchInput={setBrowseSearchInput}
          onSearch={handleBrowseSearch}
          onPageChange={setProductsPage}
          onAdd={openAddModal}
        />
      )}

      {/* Edit Mapping Modal */}
      {editMapping && (
        <div style={overlayStyle} onClick={closeEditModal}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700 }}>
              Edit Catalog Mapping
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
              {editMapping.product?.title || editMapping.globalSku}
            </p>

            <form onSubmit={handleEditSubmit} noValidate>
              <div style={{ marginBottom: 14 }}>
                <label style={modalLabelStyle}>Global SKU</label>
                <div
                  style={{
                    ...modalInputStyle,
                    background: '#f9fafb',
                    color: '#6b7280',
                  }}
                >
                  {editMapping.globalSku || '—'}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={modalLabelStyle}>Franchise SKU</label>
                <input
                  type="text"
                  value={editForm.franchiseSku || ''}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, franchiseSku: e.target.value }))
                  }
                  placeholder="Your internal SKU"
                  disabled={editSaving}
                  style={modalInputStyle}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={modalLabelStyle}>Barcode</label>
                <input
                  type="text"
                  value={editForm.barcode || ''}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, barcode: e.target.value }))
                  }
                  placeholder="EAN / UPC"
                  disabled={editSaving}
                  style={modalInputStyle}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#111827',
                    cursor: editSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!editForm.isListedForOnlineFulfillment}
                    onChange={(e) =>
                      setEditForm((p) => ({
                        ...p,
                        isListedForOnlineFulfillment: e.target.checked,
                      }))
                    }
                    disabled={editSaving}
                  />
                  Listed for online fulfillment
                </label>
              </div>

              {editError && (
                <div
                  style={{
                    background: '#fee2e2',
                    color: '#991b1b',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {editError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={closeEditModal}
                  disabled={editSaving}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={editSaving} className="btn btn-primary">
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Mapping Modal */}
      {addProduct && (
        <div style={overlayStyle} onClick={closeAddModal}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: 18, fontWeight: 700 }}>
              Add to Catalog
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px 0' }}>
              Link this product to your franchise.
            </p>

            <div
              style={{
                display: 'flex',
                gap: 12,
                padding: 12,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                marginBottom: 18,
                background: '#f9fafb',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 6,
                  background: '#e5e7eb',
                  flexShrink: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  color: '#9ca3af',
                }}
              >
                {primaryImage(addProduct.images) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={primaryImage(addProduct.images) || ''}
                    alt={addProduct.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span>{'\u{1F4E6}'}</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: '#111827',
                    marginBottom: 2,
                  }}
                >
                  {addProduct.title}
                </div>
                {addProduct.brand?.name && (
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    {addProduct.brand.name}
                  </div>
                )}
                <div
                  style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}
                >
                  SKU: {addProduct.baseSku || '—'} &middot;{' '}
                  {formatPrice(addProduct.basePrice)}
                </div>
              </div>
            </div>

            <form onSubmit={handleAddSubmit} noValidate>
              {(addProduct.variants ?? []).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={modalLabelStyle}>
                    Variant{(addProduct.variants ?? []).length > 1 ? ' *' : ''}
                  </label>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                      gap: 8,
                      maxHeight: 220,
                      overflowY: 'auto',
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      padding: 8,
                      background: '#fafafa',
                    }}
                  >
                    {(addProduct.variants ?? []).map((v) => {
                      const selected = addForm.variantId === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          disabled={addSaving}
                          onClick={() =>
                            setAddForm((p) => ({ ...p, variantId: v.id }))
                          }
                          style={{
                            textAlign: 'left',
                            padding: '10px 12px',
                            background: selected ? '#eff6ff' : '#fff',
                            border: `1px solid ${selected ? '#3b82f6' : '#e5e7eb'}`,
                            borderRadius: 6,
                            cursor: addSaving ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                            lineHeight: 1.4,
                          }}
                        >
                          <div style={{ fontWeight: 600, color: '#111827', marginBottom: 2 }}>
                            {v.title || v.sku || v.masterSku || v.id.slice(0, 8)}
                          </div>
                          <div style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 11 }}>
                            {v.sku || v.masterSku || '\u2014'}
                          </div>
                          <div style={{ color: '#6b7280', fontSize: 11 }}>
                            {formatPrice(v.price)}
                            {typeof v.stock === 'number' ? ` \u00B7 stock ${v.stock}` : ''}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={modalLabelStyle}>Franchise SKU (optional)</label>
                <input
                  type="text"
                  value={addForm.franchiseSku}
                  onChange={(e) =>
                    setAddForm((p) => ({ ...p, franchiseSku: e.target.value }))
                  }
                  placeholder="Your internal SKU"
                  disabled={addSaving}
                  style={modalInputStyle}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={modalLabelStyle}>Barcode (optional)</label>
                <input
                  type="text"
                  value={addForm.barcode}
                  onChange={(e) =>
                    setAddForm((p) => ({ ...p, barcode: e.target.value }))
                  }
                  placeholder="EAN / UPC"
                  disabled={addSaving}
                  style={modalInputStyle}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#111827',
                    cursor: addSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={addForm.isListedForOnlineFulfillment}
                    onChange={(e) =>
                      setAddForm((p) => ({
                        ...p,
                        isListedForOnlineFulfillment: e.target.checked,
                      }))
                    }
                    disabled={addSaving}
                  />
                  List for online fulfillment
                </label>
              </div>

              {addError && (
                <div
                  style={{
                    background: '#fee2e2',
                    color: '#991b1b',
                    padding: '8px 12px',
                    borderRadius: 6,
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {addError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={closeAddModal}
                  disabled={addSaving}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={addSaving} className="btn btn-primary">
                  {addSaving ? 'Adding...' : 'Add to Catalog'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Sub-components =====

function TabButton({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '10px 18px',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
        color: active ? '#2563eb' : '#6b7280',
        fontWeight: active ? 700 : 500,
        fontSize: 14,
        cursor: 'pointer',
        marginBottom: -1,
      }}
    >
      {label}
      {typeof count === 'number' && count > 0 && (
        <span
          style={{
            marginLeft: 8,
            background: active ? '#eff6ff' : '#f3f4f6',
            color: active ? '#2563eb' : '#6b7280',
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 999,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function MyCatalogTab(props: {
  mappings: CatalogMapping[];
  loading: boolean;
  error: string;
  page: number;
  totalPages: number;
  total: number;
  searchInput: string;
  setSearchInput: (v: string) => void;
  onSearch: () => void;
  isActive: string;
  setIsActive: (v: string) => void;
  approval: string;
  setApproval: (v: string) => void;
  onPageChange: (p: number) => void;
  onEdit: (m: CatalogMapping) => void;
  onRemove: (m: CatalogMapping) => void;
  removingId: string | null;
  onGoBrowse: () => void;
}) {
  const {
    mappings,
    loading,
    error,
    page,
    totalPages,
    total,
    searchInput,
    setSearchInput,
    onSearch,
    isActive,
    setIsActive,
    approval,
    setApproval,
    onPageChange,
    onEdit,
    onRemove,
    removingId,
    onGoBrowse,
  } = props;

  return (
    <>
      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type="text"
            placeholder="Search by product title or SKU..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            style={{
              padding: '8px 12px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 13,
              width: 260,
            }}
          />
          <button
            onClick={onSearch}
            style={{
              padding: '8px 14px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#f9fafb',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Search
          </button>
        </div>
        <select
          value={isActive}
          onChange={(e) => setIsActive(e.target.value)}
          style={selectStyle}
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <select
          value={approval}
          onChange={(e) => setApproval(e.target.value)}
          style={selectStyle}
        >
          <option value="">All Approval</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>
          {total} total
        </span>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
            Loading...
          </div>
        ) : mappings.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 42, marginBottom: 12 }}>{'\u{1F4E6}'}</div>
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
              No products in your catalog yet
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Browse available products and add them to start selling.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onGoBrowse}
            >
              Browse Products
            </button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={thStyle}>PRODUCT</th>
                  <th style={thStyle}>GLOBAL SKU</th>
                  <th style={thStyle}>FRANCHISE SKU</th>
                  <th style={thStyle}>BARCODE</th>
                  <th style={thStyle}>LISTED</th>
                  <th style={thStyle}>APPROVAL</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => {
                  const img = primaryImage(mapping.product?.images);
                  return (
                    <tr
                      key={mapping.id}
                      style={{ borderBottom: '1px solid #f3f4f6' }}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div
                            style={{
                              width: 42,
                              height: 42,
                              borderRadius: 6,
                              background: '#f3f4f6',
                              overflow: 'hidden',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={img}
                                alt={mapping.product?.title || 'product'}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'cover',
                                }}
                              />
                            ) : (
                              <span style={{ fontSize: 18, color: '#9ca3af' }}>
                                {'\u{1F4E6}'}
                              </span>
                            )}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: '#111827' }}>
                              {mapping.product?.title || '—'}
                            </div>
                            {mapping.variant && (
                              <div style={{ fontSize: 11, color: '#6b7280' }}>
                                {mapping.variant.title || mapping.variant.sku}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {mapping.globalSku || '—'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {mapping.franchiseSku || '—'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {mapping.barcode || '—'}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {mapping.isListedForOnlineFulfillment ? (
                          <span style={{
                            display: 'inline-block',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: 999,
                            background: '#dcfce7',
                            color: '#15803d',
                          }}>Listed</span>
                        ) : (
                          <span style={{
                            display: 'inline-block',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: 999,
                            background: '#f3f4f6',
                            color: '#6b7280',
                          }}>Unlisted</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: 'inline-block',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: 999,
                            background: approvalColor(mapping.approvalStatus) + '18',
                            color: approvalColor(mapping.approvalStatus),
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatApprovalStatus(mapping.approvalStatus)}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div
                          style={{
                            display: 'inline-flex',
                            gap: 6,
                            justifyContent: 'flex-end',
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => onEdit(mapping)}
                            style={{
                              padding: '6px 14px',
                              fontSize: 12,
                              fontWeight: 600,
                              border: '1px solid #d1d5db',
                              borderRadius: 6,
                              background: '#f9fafb',
                              color: '#111827',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemove(mapping)}
                            disabled={removingId === mapping.id}
                            style={{
                              padding: '6px 14px',
                              fontSize: 12,
                              fontWeight: 600,
                              border: '1px solid #fecaca',
                              borderRadius: 6,
                              background: '#fef2f2',
                              color: '#dc2626',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {removingId === mapping.id ? '...' : 'Remove'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
      )}
    </>
  );
}

function BrowseProductsTab(props: {
  products: AvailableProduct[];
  loading: boolean;
  error: string;
  page: number;
  totalPages: number;
  searchInput: string;
  setSearchInput: (v: string) => void;
  onSearch: () => void;
  onPageChange: (p: number) => void;
  onAdd: (p: AvailableProduct) => void;
}) {
  const {
    products,
    loading,
    error,
    page,
    totalPages,
    searchInput,
    setSearchInput,
    onSearch,
    onPageChange,
    onAdd,
  } = props;

  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <input
          type="text"
          placeholder="Search products by title or SKU..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          style={{
            padding: '10px 14px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 14,
            flex: 1,
            minWidth: 260,
            maxWidth: 480,
          }}
        />
        <button
          onClick={onSearch}
          style={{
            padding: '10px 18px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            background: '#f9fafb',
            fontSize: 14,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Search
        </button>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <div
          className="card"
          style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}
        >
          Loading...
        </div>
      ) : products.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>{'\u{1F50D}'}</div>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            No products found
          </h3>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            Try a different search query.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {products.map((product) => {
            const img = primaryImage(product.images);
            return (
              <div
                key={product.id}
                style={{
                  background: '#fff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 12,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    aspectRatio: '1 / 1',
                    background: '#f3f4f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt={product.title}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: 40, color: '#d1d5db' }}>{'\u{1F4E6}'}</span>
                  )}
                </div>
                <div
                  style={{
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      color: '#111827',
                      marginBottom: 4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      minHeight: 36,
                    }}
                  >
                    {product.title}
                  </div>
                  {product.brand?.name && (
                    <div
                      style={{
                        fontSize: 12,
                        color: '#6b7280',
                        marginBottom: 4,
                      }}
                    >
                      {product.brand.name}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: '#111827',
                      marginBottom: 12,
                    }}
                  >
                    {formatPrice(product.basePrice)}
                  </div>
                  <button
                    type="button"
                    onClick={() => onAdd(product)}
                    style={{
                      marginTop: 'auto',
                      padding: '8px 12px',
                      background: '#2563eb',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    + Add to Catalog
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
      )}
    </>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 8,
        marginTop: 20,
        alignItems: 'center',
      }}
    >
      <button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        style={pageBtnStyle}
      >
        Previous
      </button>
      <span style={{ padding: '8px 12px', fontSize: 14 }}>
        Page {page} of {totalPages}
      </span>
      <button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        style={pageBtnStyle}
      >
        Next
      </button>
    </div>
  );
}

// ===== Styles =====

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  fontWeight: 600,
  fontSize: 11,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  verticalAlign: 'middle',
  color: '#111827',
};

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
  cursor: 'pointer',
};

const pageBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  background: '#fff',
  fontSize: 13,
  cursor: 'pointer',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0,0,0,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 28,
  width: 480,
  maxWidth: '100%',
  maxHeight: '90vh',
  overflowY: 'auto',
  boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
};

const modalLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 6,
  color: '#374151',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const modalInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  background: '#fff',
  fontFamily: 'inherit',
  outline: 'none',
};
