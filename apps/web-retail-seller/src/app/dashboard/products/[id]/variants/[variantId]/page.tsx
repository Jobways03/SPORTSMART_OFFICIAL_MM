'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  sellerProductService,
  ProductDetail,
  ProductVariant,
  ProductVariantImage,
} from '@/services/product.service';
import { useModal } from '@sportsmart/ui';
import { ApiError } from '@/lib/api-client';
import '../../../product-form.css';

export default function VariantDetailPage() {
  const { notify, confirmDialog } = useModal();
const router = useRouter();
  const params = useParams();
  const productId = params.id as string;
  const variantId = params.variantId as string;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Form state for current variant
  const [form, setForm] = useState({
    title: '',
    price: '',
    compareAtPrice: '',
    costPrice: '',
    sku: '',
    barcode: '',
    stock: '',
    weight: '',
    weightUnit: 'g',
    length: '',
    width: '',
    height: '',
    dimensionUnit: 'cm',
  });

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const currentVariant = product?.variants.find(v => v.id === variantId) || null;
  const allVariants = product?.variants || [];

  const populateForm = useCallback((v: ProductVariant) => {
    setForm({
      title: v.title || '',
      price: v.price ?? '',
      compareAtPrice: v.compareAtPrice ?? '',
      costPrice: v.costPrice ?? '',
      sku: v.sku || '',
      barcode: v.barcode || '',
      stock: String(v.stock ?? 0),
      weight: v.weight ?? '',
      weightUnit: v.weightUnit || 'g',
      length: (v as any).length ?? '',
      width: (v as any).width ?? '',
      height: (v as any).height ?? '',
      dimensionUnit: (v as any).dimensionUnit || 'cm',
    });
  }, []);

  const loadProduct = useCallback(async () => {
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const res = await sellerProductService.getProduct(token, productId);
      if (res.data) {
        setProduct(res.data);
        const variant = res.data.variants.find((v: ProductVariant) => v.id === variantId);
        if (variant) populateForm(variant);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setLoadError(err.message || 'Failed to load product.');
      } else {
        setLoadError('Failed to load product.');
      }
    } finally {
      setLoading(false);
    }
  }, [productId, variantId, populateForm]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  // When switching variants via sidebar
  useEffect(() => {
    if (product) {
      const variant = product.variants.find(v => v.id === variantId);
      if (variant) populateForm(variant);
    }
  }, [variantId, product, populateForm]);

  function getVariantLabel(v: ProductVariant) {
    const ovs = (v.optionValues || []).map((ov: any) => {
      if (ov.optionValue) return { value: ov.optionValue.value, displayValue: ov.optionValue.displayValue, optionName: ov.optionValue.optionDefinition?.name };
      return ov;
    });
    if (ovs.length > 0) {
      return ovs.map((ov: any) => ov.displayValue || ov.value).join(' / ');
    }
    return v.title || v.sku || 'Unnamed';
  }

  function getVariantImage(v: ProductVariant): string | null {
    if (v.images && v.images.length > 0) return v.images[0].url;
    if (product && product.images.length > 0) return product.images[0].url;
    return null;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const payload: any = {};
      if (form.title.trim()) payload.title = form.title.trim();
      if (form.price) payload.price = Number(form.price);
      if (form.compareAtPrice) payload.compareAtPrice = Number(form.compareAtPrice);
      else payload.compareAtPrice = null;
      if (form.costPrice) payload.costPrice = Number(form.costPrice);
      else payload.costPrice = null;
      payload.sku = form.sku.trim() || null;
      payload.barcode = form.barcode.trim() || null;
      if (form.stock !== '') payload.stock = Number(form.stock);
      if (form.weight) payload.weight = Number(form.weight);
      else payload.weight = null;
      payload.weightUnit = form.weightUnit;
      if (form.length) payload.length = Number(form.length);
      else payload.length = null;
      if (form.width) payload.width = Number(form.width);
      else payload.width = null;
      if (form.height) payload.height = Number(form.height);
      else payload.height = null;
      payload.dimensionUnit = form.dimensionUnit;

      await sellerProductService.updateVariant(token, productId, variantId, payload);
      showToast('success', 'Variant updated successfully.');
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast('error', err.message || 'Failed to update variant.');
      } else {
        showToast('error', 'Failed to update variant.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].size > 5 * 1024 * 1024) {
        showToast('error', `"${files[i].name}" exceeds 5MB and was skipped.`);
      } else {
        validFiles.push(files[i]);
      }
    }

    if (validFiles.length === 0) return;

    setUploadingImage(true);
    const token = sessionStorage.getItem('accessToken') || '';
    let uploaded = 0;
    let failed = 0;

    for (const file of validFiles) {
      try {
        await sellerProductService.uploadVariantImage(token, productId, variantId, file);
        uploaded++;
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      showToast('error', `${uploaded} image(s) uploaded, ${failed} failed.`);
    } else {
      showToast('success', `${uploaded} image(s) uploaded successfully.`);
    }

    await loadProduct();
    setUploadingImage(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleMoveImage(imageId: string, direction: 'up' | 'down') {
    const sorted = [...variantImages].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    const idx = sorted.findIndex((img: any) => img.id === imageId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const newOrder = sorted.map((img: any) => img.id);
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.reorderVariantImages(token, productId, variantId, newOrder);
      await loadProduct();
    } catch {
      showToast('error', 'Failed to reorder images.');
    }
  }

  async function handleDeleteImage(imageId: string) {if (!(await confirmDialog('Delete this variant image?'))) return;
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      await sellerProductService.deleteVariantImage(token, productId, variantId, imageId);
      showToast('success', 'Image deleted.');
      await loadProduct();
    } catch (err) {
      if (err instanceof ApiError) {
        showToast('error', err.message || 'Failed to delete image.');
      } else {
        showToast('error', 'Failed to delete image.');
      }
    }
  }

  // Loading / Error
  if (loading) return <div className="form-loading">Loading variant...</div>;
  if (loadError) {
    return (
      <div className="product-form-page">
        <Link href={`/dashboard/products/${productId}/edit`} className="product-form-back">&larr; Back to Product</Link>
        <div className="form-card"><p style={{ color: 'var(--color-error)', fontSize: 14 }}>{loadError}</p></div>
      </div>
    );
  }
  if (!product || !currentVariant) {
    return (
      <div className="product-form-page">
        <Link href={`/dashboard/products/${productId}/edit`} className="product-form-back">&larr; Back to Product</Link>
        <div className="form-card"><p style={{ fontSize: 14 }}>Variant not found.</p></div>
      </div>
    );
  }

  const variantLabel = getVariantLabel(currentVariant);
  const variantImages = currentVariant.images || [];

  return (
    <div className="product-form-page">
      {/* Toast */}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      {/* Header */}
      <div className="product-form-header">
        <div>
          <Link href={`/dashboard/products/${productId}/edit`} className="product-form-back">
            &larr; Back to {product.title}
          </Link>
          <h1>{variantLabel}</h1>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="variant-detail-layout">
        {/* Left Column: Image + Variant List */}
        <div className="variant-detail-left">
          {/* Variant Image */}
          <div className="form-card">
            <div className="form-card-title">VARIANT IMAGE</div>
            <p className="variant-detail-hint">Edit variant image here</p>

            {(() => {
              const colorOv = (currentVariant.optionValues || []).find((ov: any) => {
                const name = ov.optionValue?.optionDefinition?.name || ov.optionName || '';
                return name.toLowerCase() === 'color' || name.toLowerCase() === 'colour';
              });
              const colorValue = (colorOv as any)?.optionValue?.displayValue || colorOv?.displayValue;
              if (colorValue) {
                return (
                  <div style={{
                    background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6,
                    padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#1e40af',
                  }}>
                    Images are shared across all <strong>{colorValue}</strong> variants
                  </div>
                );
              }
              return null;
            })()}

            {variantImages.length > 0 && (() => {
              const sorted = [...variantImages].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
              return (
              <div className="image-grid" style={{ marginBottom: 12 }}>
                {sorted.map((img, idx) => (
                  <div key={img.id}>
                    <div className="image-card">
                      <img src={img.url} alt={variantLabel} />
                      <div className="image-card-actions">
                        <button
                          className="delete-btn"
                          onClick={() => handleDeleteImage(img.id)}
                          title="Delete image"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                    {sorted.length > 1 && (
                      <div className="image-move-buttons">
                        <button disabled={idx === 0} onClick={() => handleMoveImage(img.id, 'up')} title="Move left">&larr;</button>
                        <button disabled={idx === sorted.length - 1} onClick={() => handleMoveImage(img.id, 'down')} title="Move right">&rarr;</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              );
            })()}
            <div
              className="image-upload-area"
              onClick={() => fileInputRef.current?.click()}
              style={{ marginBottom: 0 }}
            >
              <p>{uploadingImage ? 'Uploading...' : 'Click to upload variant images'}</p>
              <p className="upload-hint">Select one or more images. Max 5MB each. JPG, PNG, or WebP.</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
          </div>

          {/* Variant List Sidebar */}
          <div className="form-card">
            <div className="form-card-title">VARIANTS</div>
            <p className="variant-detail-hint">Click on variant to edit its details.</p>
            <div className="variant-sidebar-list">
              {allVariants.map(v => {
                const isActive = v.id === variantId;
                const img = getVariantImage(v);
                return (
                  <Link
                    key={v.id}
                    href={`/dashboard/products/${productId}/variants/${v.id}`}
                    className={`variant-sidebar-item${isActive ? ' active' : ''}`}
                  >
                    {img ? (
                      <img src={img} alt="" className="variant-sidebar-thumb" />
                    ) : (
                      <div className="variant-sidebar-thumb-placeholder">?</div>
                    )}
                    <span className="variant-sidebar-label">{getVariantLabel(v)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Editing Sections */}
        <div className="variant-detail-right">
          {/* Options / Variant Title */}
          <div className="form-card">
            <div className="form-card-title">VARIANT INFO</div>
            <p className="variant-detail-hint">Variant identification</p>
            {(currentVariant.optionValues || []).length > 0 ? (
              (currentVariant.optionValues || []).map((ov: any, idx: number) => {
                const flat = ov.optionValue
                  ? { id: ov.id || idx, value: ov.optionValue.value, displayValue: ov.optionValue.displayValue, optionName: ov.optionValue.optionDefinition?.name }
                  : ov;
                return (
                  <div key={flat.id} className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label">{flat.optionName || 'Option'}</label>
                    <input
                      type="text"
                      className="form-input"
                      value={flat.displayValue || flat.value}
                      readOnly
                      style={{ background: '#f9fafb', color: '#6b7280' }}
                    />
                  </div>
                );
              })
            ) : (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.title || ''}
                  onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Variant title"
                />
              </div>
            )}
          </div>

          {/* Pricing Details */}
          <div className="form-card">
            <div className="form-card-title">PRICING DETAILS</div>
            <p className="variant-detail-hint">Edit pricing details here</p>
            <div className="form-group">
              <label className="form-label">Price <span className="required">*</span></label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.price}
                  onChange={e => setForm(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Compare at Price</label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.compareAtPrice}
                  onChange={e => setForm(prev => ({ ...prev, compareAtPrice: e.target.value }))}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Cost Price</label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.costPrice}
                  onChange={e => setForm(prev => ({ ...prev, costPrice: e.target.value }))}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          </div>

          {/* Inventory Details */}
          <div className="form-card">
            <div className="form-card-title">INVENTORY DETAILS</div>
            <p className="variant-detail-hint">Edit inventory details here</p>
            <div className="form-group">
              <label className="form-label">SKU</label>
              <input
                type="text"
                className="form-input"
                value={form.sku}
                onChange={e => setForm(prev => ({ ...prev, sku: e.target.value }))}
                placeholder="Stock keeping unit"
              />
              <span className="form-hint" style={{ color: '#dc2626', fontWeight: 500 }}>
                NOTE: SKU is mandatory if you want to fulfill orders using Shiprocket Shipping.
              </span>
            </div>
            <div className="form-group">
              <label className="form-label">Barcode</label>
              <input
                type="text"
                className="form-input"
                value={form.barcode}
                onChange={e => setForm(prev => ({ ...prev, barcode: e.target.value }))}
                placeholder="UPC, EAN, ISBN, etc."
              />
            </div>
            <div className="form-group">
              <label className="form-label">Quantity <span className="required">*</span></label>
              <input
                type="number"
                className="form-input"
                value={form.stock}
                onChange={e => setForm(prev => ({ ...prev, stock: e.target.value }))}
                placeholder="0"
                min="0"
                step="1"
              />
            </div>
          </div>

          {/* Shipping Details */}
          <div className="form-card">
            <div className="form-card-title">SHIPPING DETAILS</div>
            <p className="variant-detail-hint">Edit shipping details here</p>
            <div className="form-group">
              <label className="form-label">Weight Unit</label>
              <select
                className="form-select"
                value={form.weightUnit}
                onChange={e => setForm(prev => ({ ...prev, weightUnit: e.target.value }))}
              >
                <option value="g">Gram (g)</option>
                <option value="kg">Kilogram (kg)</option>
                <option value="lb">Pound (lb)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Weight</label>
              <input
                type="number"
                className="form-input"
                value={form.weight}
                onChange={e => setForm(prev => ({ ...prev, weight: e.target.value }))}
                placeholder="0"
                min="0"
                step="0.01"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Dimensions (L x W x H)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  className="form-input"
                  style={{ flex: 1 }}
                  value={form.length}
                  onChange={e => setForm(prev => ({ ...prev, length: e.target.value }))}
                  placeholder="L"
                  min="0"
                  step="0.1"
                />
                <span style={{ color: '#9ca3af' }}>&times;</span>
                <input
                  type="number"
                  className="form-input"
                  style={{ flex: 1 }}
                  value={form.width}
                  onChange={e => setForm(prev => ({ ...prev, width: e.target.value }))}
                  placeholder="W"
                  min="0"
                  step="0.1"
                />
                <span style={{ color: '#9ca3af' }}>&times;</span>
                <input
                  type="number"
                  className="form-input"
                  style={{ flex: 1 }}
                  value={form.height}
                  onChange={e => setForm(prev => ({ ...prev, height: e.target.value }))}
                  placeholder="H"
                  min="0"
                  step="0.1"
                />
                <select
                  className="form-select"
                  value={form.dimensionUnit}
                  onChange={e => setForm(prev => ({ ...prev, dimensionUnit: e.target.value }))}
                  style={{ width: 70 }}
                >
                  <option value="cm">cm</option>
                  <option value="in">in</option>
                  <option value="m">m</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Save Button */}
      <div className="form-actions">
        <button
          type="button"
          className="form-btn"
          onClick={() => router.push(`/dashboard/products/${productId}/edit`)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="form-btn primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
