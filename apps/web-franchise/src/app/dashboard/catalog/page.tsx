'use client';

import { useEffect, useState, FormEvent, useCallback } from 'react';
import {
  franchiseCatalogService,
  AvailableProduct,
  CatalogMapping,
  AddMappingPayload,
  UpdateMappingPayload,
} from '@/services/catalog.service';
import { useModal } from '@sportsmart/ui';
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
  const { notify, confirmDialog } = useModal();
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
  // Snapshot of the form values when the modal opened — used to
  // detect whether the user has actually changed anything. Save is
  // disabled until at least one field differs from this snapshot.
  const [originalEditForm, setOriginalEditForm] = useState<UpdateMappingPayload>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // ---- Add mapping modal ----
  // One row per variant (or one row total for products without variants).
  // Each row carries its own SKU + barcode + listed flag so the franchise
  // can map every variant in a single submit instead of opening the modal
  // once per variant.
  interface AddRow {
    variantId: string | null;
    label: string;
    masterSku: string | null;
    included: boolean;
    franchiseSku: string;
    barcode: string;
    isListed: boolean;
    // Already mapped by this franchise — the row is rendered as a
    // disabled/dimmed preview and is excluded from submit. Avoids
    // hitting the unique-mapping constraint at save time.
    alreadyMapped: boolean;
    // The status of the existing mapping (only meaningful when
    // alreadyMapped=true), so the row can show "In catalog" vs
    // "Pending review" vs "Rejected".
    existingStatus?: string;
  }
  const [addProduct, setAddProduct] = useState<AvailableProduct | null>(null);
  const [addRows, setAddRows] = useState<AddRow[]>([]);
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
    const initial: UpdateMappingPayload = {
      franchiseSku: mapping.franchiseSku || '',
      barcode: mapping.barcode || '',
      isListedForOnlineFulfillment: mapping.isListedForOnlineFulfillment,
    };
    setEditForm(initial);
    // Snapshot for the dirty-check. Save stays disabled until the
    // user changes at least one of these three fields.
    setOriginalEditForm(initial);
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
    // Capture the status before the save so we can show the right
    // success message. The server's updateMapping flips the status
    // back to PENDING_APPROVAL for any non-pending edit, so the
    // toast should reflect that rather than implying the change is
    // already live.
    const wasNonPending = editMapping.approvalStatus !== 'PENDING_APPROVAL';
    try {
      const payload: UpdateMappingPayload = {
        franchiseSku: (editForm.franchiseSku || '').trim() || undefined,
        barcode: (editForm.barcode || '').trim() || undefined,
        isListedForOnlineFulfillment: editForm.isListedForOnlineFulfillment,
      };
      await franchiseCatalogService.updateMapping(editMapping.id, payload);
      setEditMapping(null);
      flashSuccess(
        wasNonPending
          ? 'Submitted for admin review'
          : 'Mapping updated',
      );
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

  const handleRemoveMapping = async (mapping: CatalogMapping) => {const title = mapping.product?.title || 'this product';
    if (!(await confirmDialog(`Remove "${title}" from your catalog?`))) return;
    setRemovingId(mapping.id);
    try {
      await franchiseCatalogService.removeMapping(mapping.id);
      flashSuccess('Removed from catalog');
      await loadMappings();
    } catch (err) {
      if (err instanceof ApiError) {
        void notify(err.body.message || 'Failed to remove mapping');
      } else {
        void notify('Failed to remove mapping');
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
    const variants = product.variants ?? [];
    // Index existing mappings by variantId (null = product-level)
    // so we can mark already-mapped rows as disabled previews.
    const mappedByVariant = new Map<string | null, string>();
    for (const m of product.franchiseCatalogMappings ?? []) {
      mappedByVariant.set(m.variantId, m.approvalStatus);
    }
    if (variants.length === 0) {
      // Product without variants: a single product-level row.
      const existingStatus = mappedByVariant.get(null);
      setAddRows([{
        variantId: null,
        label: product.title,
        masterSku: product.baseSku,
        included: !existingStatus,
        franchiseSku: '',
        barcode: '',
        isListed: true,
        alreadyMapped: Boolean(existingStatus),
        existingStatus,
      }]);
    } else {
      // Product with variants: one row per variant. Variants the
      // franchise has already mapped come in disabled and unchecked,
      // with a preview label. The remaining variants are checkable
      // and selected by default — that lets the franchise add the
      // rest in a single submit.
      setAddRows(
        variants.map((v) => {
          const existingStatus = mappedByVariant.get(v.id);
          return {
            variantId: v.id,
            label: v.title || v.sku || v.masterSku || v.id.slice(0, 8),
            masterSku: v.sku || v.masterSku,
            included: !existingStatus,
            franchiseSku: '',
            barcode: '',
            isListed: true,
            alreadyMapped: Boolean(existingStatus),
            existingStatus,
          };
        }),
      );
    }
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

    const selected = addRows.filter((r) => r.included);
    if (selected.length === 0) {
      setAddError('Select at least one variant to add.');
      return;
    }

    // Franchise SKU is OPTIONAL — when blank, the system falls back
    // to the master/global SKU everywhere it's displayed and scanned.
    // We only validate that any *manually entered* franchise SKUs in
    // this batch are unique among themselves, so the franchise can't
    // type the same value twice by accident.
    const skuSeen = new Map<string, number>();
    for (const r of selected) {
      const sku = r.franchiseSku.trim();
      if (!sku) continue;
      if (skuSeen.has(sku)) {
        setAddError(`Franchise SKU "${sku}" is repeated. Each variant needs a unique SKU.`);
        return;
      }
      skuSeen.set(sku, 1);
    }

    setAddError('');
    setAddSaving(true);
    try {
      if (selected.length === 1) {
        // Single row → use the existing single-mapping endpoint so the
        // backend's per-row error message comes back cleanly.
        const r = selected[0];
        const payload: AddMappingPayload = {
          productId: addProduct.id,
          variantId: r.variantId || undefined,
          franchiseSku: r.franchiseSku.trim() || undefined,
          barcode: r.barcode.trim() || undefined,
          isListedForOnlineFulfillment: r.isListed,
        };
        await franchiseCatalogService.addMapping(payload);
      } else {
        // Multiple rows → use the bulk endpoint. The backend creates one
        // FranchiseCatalogMapping per row, each with its own SKU.
        const payloads: AddMappingPayload[] = selected.map((r) => ({
          productId: addProduct.id,
          variantId: r.variantId || undefined,
          franchiseSku: r.franchiseSku.trim() || undefined,
          barcode: r.barcode.trim() || undefined,
          isListedForOnlineFulfillment: r.isListed,
        }));
        await franchiseCatalogService.bulkAddMappings(payloads);
      }
      setAddProduct(null);
      flashSuccess(
        selected.length === 1
          ? 'Added to your catalog'
          : `${selected.length} variants added to your catalog`,
      );
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
              {editMapping.approvalStatus === 'REJECTED'
                ? 'Fix Rejected Mapping'
                : 'Edit Catalog Mapping'}
            </h3>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px 0' }}>
              {editMapping.product?.title || editMapping.globalSku}
            </p>

            {/* When the mapping was rejected by an admin, surface a
                clear banner that explains what happens next: edits
                here resubmit the row for re-review. Without this, the
                franchise would think saving means the row goes live. */}
            {editMapping.approvalStatus === 'REJECTED' && (
              <div
                role="status"
                style={{
                  padding: '10px 12px',
                  marginBottom: 16,
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#991b1b',
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ fontWeight: 700 }}>This mapping was rejected by the admin.</strong> Update the SKU or barcode below and click Save Changes — your submission will be sent back for re-review.
              </div>
            )}

            {/* Edits to an approved/stopped mapping reset the status
                to PENDING_APPROVAL — the admin must re-verify the new
                SKU / barcode / listing combination before the mapping
                goes live again. Make that consequence visible up
                front so the franchise doesn't accidentally pull a
                live product offline by tweaking a typo. */}
            {(editMapping.approvalStatus === 'APPROVED' ||
              editMapping.approvalStatus === 'STOPPED') && (
              <div
                role="status"
                style={{
                  padding: '10px 12px',
                  marginBottom: 16,
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#92400e',
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ fontWeight: 700 }}>Heads up:</strong> saving changes resets this mapping to <strong>Pending review</strong>. The admin must re-approve before it goes live again.
              </div>
            )}

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
                <label style={modalLabelStyle}>
                  Franchise SKU
                  <span style={{ fontWeight: 500, color: '#9ca3af', marginLeft: 6, fontSize: 11 }}>
                    (optional)
                  </span>
                </label>
                <input
                  type="text"
                  value={editForm.franchiseSku || ''}
                  onChange={(e) =>
                    setEditForm((p) => ({ ...p, franchiseSku: e.target.value }))
                  }
                  placeholder={editMapping.globalSku || 'Same as Master SKU'}
                  disabled={editSaving}
                  style={modalInputStyle}
                />
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  Leave blank to use the Master SKU ({editMapping.globalSku || '—'}). Only set this if your warehouse / POS system uses its own internal codes.
                </div>
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

              {(() => {
                // Dirty-check — the franchise can only submit when at
                // least one of franchiseSku / barcode / isListed has
                // changed from the original snapshot. Treat null and
                // empty-string as the same value (both render as a
                // blank input but the API accepts undefined).
                const norm = (v: unknown) =>
                  typeof v === 'string' ? v.trim() : v ?? '';
                const isDirty =
                  norm(editForm.franchiseSku) !== norm(originalEditForm.franchiseSku) ||
                  norm(editForm.barcode) !== norm(originalEditForm.barcode) ||
                  Boolean(editForm.isListedForOnlineFulfillment) !==
                    Boolean(originalEditForm.isListedForOnlineFulfillment);
                const submitLabel = editSaving
                  ? 'Saving…'
                  : editMapping.approvalStatus === 'REJECTED'
                    ? 'Resubmit for Review'
                    : editMapping.approvalStatus === 'APPROVED' ||
                        editMapping.approvalStatus === 'STOPPED'
                      ? 'Save & Send for Review'
                      : 'Save Changes';
                return (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
                    {!isDirty && (
                      <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 'auto' }}>
                        No changes to save
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={closeEditModal}
                      disabled={editSaving}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editSaving || !isDirty}
                      className="btn btn-primary"
                      title={
                        !isDirty
                          ? 'Make a change to enable Save'
                          : editMapping.approvalStatus === 'APPROVED' ||
                              editMapping.approvalStatus === 'STOPPED'
                            ? 'Saving will reset this mapping to Pending review'
                            : undefined
                      }
                    >
                      {submitLabel}
                    </button>
                  </div>
                );
              })()}
            </form>
          </div>
        </div>
      )}

      {/* Add Mapping Modal — wider than the default modal so the
          per-variant rows below have room for inline SKU/barcode inputs. */}
      {addProduct && (
        <div style={overlayStyle} onClick={closeAddModal}>
          <div
            style={{ ...modalStyle, width: 920, maxWidth: '95vw' }}
            onClick={(e) => e.stopPropagation()}
          >
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

              {/* Per-variant rows in a compact tabular layout — scales
                  cleanly to many variants. One horizontal row per variant
                  with inline SKU + barcode + listed inputs. */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <label style={{ ...modalLabelStyle, marginBottom: 0 }}>
                    {(addProduct.variants ?? []).length > 0 ? (
                      (() => {
                        const selectable = addRows.filter((r) => !r.alreadyMapped).length;
                        const selected = addRows.filter((r) => r.included && !r.alreadyMapped).length;
                        const lockedCount = addRows.length - selectable;
                        return (
                          <>
                            Variants ({selected}/{selectable} selected)
                            {lockedCount > 0 && (
                              <span style={{ fontWeight: 500, color: '#6b7280', marginLeft: 6, fontSize: 11 }}>
                                · {lockedCount} already in catalog
                              </span>
                            )}
                          </>
                        );
                      })()
                    ) : 'Catalog details'}
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      disabled={addSaving}
                      onClick={() => {
                        // Copy each variant's master SKU into the
                        // franchise SKU input as a starting value. The
                        // franchise can edit afterwards if they want a
                        // different internal code, otherwise leaving
                        // the master SKU is the right default — every
                        // place that displays / scans the SKU falls
                        // back to globalSku when franchiseSku is blank,
                        // so this is purely a convenience to make the
                        // value visible / editable in the input.
                        setAddRows((prev) =>
                          prev.map((r) => {
                            if (r.alreadyMapped) return r;
                            if (!r.included) return r;
                            if (r.franchiseSku.trim()) return r;
                            const seed = (r.masterSku && r.masterSku.trim()) || '';
                            return seed ? { ...r, franchiseSku: seed } : r;
                          }),
                        );
                      }}
                      style={{ ...bulkBtnStyle, color: '#1d4ed8', borderColor: '#bfdbfe' }}
                      title="Pre-fill empty fields with the Master SKU. You can still edit each one or leave blank to use the Master SKU automatically."
                    >
                      Copy from Master SKU
                    </button>
                    {addRows.length > 1 && (
                      <>
                        <button
                          type="button"
                          disabled={addSaving}
                          onClick={() =>
                            setAddRows((prev) =>
                              prev.map((r) => (r.alreadyMapped ? r : { ...r, included: true })),
                            )
                          }
                          style={bulkBtnStyle}
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          disabled={addSaving}
                          onClick={() =>
                            setAddRows((prev) =>
                              prev.map((r) => (r.alreadyMapped ? r : { ...r, included: false })),
                            )
                          }
                          style={bulkBtnStyle}
                        >
                          Clear all
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    background: '#fff',
                    overflow: 'hidden',
                  }}
                >
                  {/* Sticky column header row */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '32px minmax(180px, 1.4fr) 1.2fr 1.1fr 92px',
                      gap: 8,
                      padding: '8px 12px',
                      background: '#f9fafb',
                      borderBottom: '1px solid #e5e7eb',
                      fontSize: 10,
                      fontWeight: 700,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    <div></div>
                    <div>Variant</div>
                    <div title="Optional — leave blank to use the Master SKU">
                      Franchise SKU
                      <span
                        style={{
                          fontWeight: 500,
                          color: '#9ca3af',
                          marginLeft: 4,
                          fontSize: 10,
                          textTransform: 'none',
                          letterSpacing: 0,
                        }}
                      >
                        (optional)
                      </span>
                    </div>
                    <div>Barcode</div>
                    <div style={{ textAlign: 'center' }}>Listed</div>
                  </div>

                  {/* Scrollable body */}
                  <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {addRows.map((row, idx) => {
                      const updateRow = (patch: Partial<AddRow>) =>
                        setAddRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
                        );
                      // Three states for a row:
                      //   alreadyMapped → locked, shown as a preview tag,
                      //                   excluded from submit
                      //   !included     → unchecked-by-user, dimmed
                      //   included      → active row
                      const dim = row.alreadyMapped || !row.included;
                      const lockedStatusLabel = row.alreadyMapped
                        ? row.existingStatus === 'PENDING_APPROVAL'
                          ? 'Pending review'
                          : row.existingStatus === 'REJECTED'
                            ? 'Rejected'
                            : row.existingStatus === 'STOPPED'
                              ? 'Stopped'
                              : 'In catalog'
                        : null;
                      return (
                        <div
                          key={row.variantId ?? 'product-level'}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '32px minmax(180px, 1.4fr) 1.2fr 1.1fr 92px',
                            gap: 8,
                            alignItems: 'center',
                            padding: '8px 12px',
                            borderBottom:
                              idx === addRows.length - 1 ? 'none' : '1px solid #f1f5f9',
                            background: row.alreadyMapped
                              ? '#f8fafc'
                              : !row.included
                                ? '#fafafa'
                                : idx % 2 === 0 ? '#fff' : '#fcfcfd',
                            opacity: dim ? 0.6 : 1,
                            transition: 'opacity 0.12s, background 0.12s',
                          }}
                          title={row.alreadyMapped ? 'This variant is already in your catalog. Manage it from My Catalog.' : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={row.included}
                            onChange={(e) => updateRow({ included: e.target.checked })}
                            disabled={addSaving || row.alreadyMapped}
                            style={{
                              justifySelf: 'center',
                              cursor: addSaving || row.alreadyMapped ? 'not-allowed' : 'pointer',
                            }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: 13,
                                color: '#111827',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {row.label}
                            </div>
                            {row.masterSku && (
                              <div
                                style={{
                                  fontFamily: 'monospace',
                                  fontSize: 11,
                                  color: '#9ca3af',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {row.masterSku}
                              </div>
                            )}
                          </div>
                          {row.alreadyMapped ? (
                            // Locked preview — span the SKU + Barcode + Listed
                            // cells so the row reads as one clear "already in
                            // catalog" tag, not three empty inputs.
                            <div
                              style={{
                                gridColumn: 'span 3',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                                gap: 8,
                              }}
                            >
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '4px 10px',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  color: '#475569',
                                  background: '#e2e8f0',
                                  borderRadius: 999,
                                }}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 16 16"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M3 8l3 3 7-7" />
                                </svg>
                                {lockedStatusLabel}
                              </span>
                            </div>
                          ) : (
                            <>
                          <input
                            type="text"
                            value={row.franchiseSku}
                            onChange={(e) => updateRow({ franchiseSku: e.target.value })}
                            placeholder={row.masterSku || 'Same as Master SKU'}
                            title="Optional — leave blank to use the Master SKU"
                            disabled={addSaving || dim}
                            style={inlineInputStyle}
                          />
                          <input
                            type="text"
                            value={row.barcode}
                            onChange={(e) => updateRow({ barcode: e.target.value })}
                            placeholder="EAN / UPC"
                            disabled={addSaving || dim}
                            style={inlineInputStyle}
                          />
                          <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <input
                              type="checkbox"
                              checked={row.isListed}
                              onChange={(e) => updateRow({ isListed: e.target.checked })}
                              disabled={addSaving || dim}
                              style={{ cursor: addSaving || dim ? 'not-allowed' : 'pointer' }}
                              title="List for online fulfillment"
                            />
                          </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
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
                  // Rejected mappings get a subtle red row tint so the
                  // franchise can spot them at a glance and fix them.
                  // Once the franchise saves changes, the API flips the
                  // status back to PENDING_APPROVAL automatically.
                  const isRejected = mapping.approvalStatus === 'REJECTED';
                  return (
                    <tr
                      key={mapping.id}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        background: isRejected ? '#fef2f2' : 'transparent',
                      }}
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
                        {mapping.franchiseSku ? (
                          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {mapping.franchiseSku}
                          </span>
                        ) : (
                          // No override set — fall back to the master/global
                          // SKU and label it muted so the franchise knows
                          // it's the platform default, not a value they
                          // typed in.
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: 12,
                              color: '#9ca3af',
                            }}
                            title="Uses Master SKU (no override set)"
                          >
                            {mapping.globalSku || '—'}
                          </span>
                        )}
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
                            title={
                              isRejected
                                ? 'Fix the issue and re-submit for admin review'
                                : 'Edit catalog mapping'
                            }
                            style={{
                              padding: '6px 14px',
                              fontSize: 12,
                              fontWeight: 600,
                              border: isRejected ? '1px solid #b91c1c' : '1px solid #d1d5db',
                              borderRadius: 6,
                              background: isRejected ? '#b91c1c' : '#f9fafb',
                              color: isRejected ? '#fff' : '#111827',
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {isRejected ? 'Fix & Resubmit' : 'Edit'}
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

const bulkBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  fontSize: 11,
  fontWeight: 500,
  color: '#374151',
  cursor: 'pointer',
};

const inlineInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
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
