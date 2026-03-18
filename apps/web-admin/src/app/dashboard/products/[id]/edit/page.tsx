'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService, ProductDetail } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import RejectModal from '../../components/reject-modal';
import RequestChangesModal from '../../components/request-changes-modal';
import '../../product-form.css';
import RichTextEditor from '@/components/RichTextEditor';

interface CategoryOption {
  id: string;
  name: string;
}

interface BrandOption {
  id: string;
  name: string;
}

interface OptionEntry {
  name: string;
  values: string[];
  isEditing: boolean;
}

type ModalType = 'reject' | 'requestChanges' | null;

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [product, setProduct] = useState<ProductDetail | null>(null);

  // Modal
  const [activeModal, setActiveModal] = useState<ModalType>(null);

  // Categories & Brands
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);

  // Form fields
  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [brandId, setBrandId] = useState('');
  const [brandName, setBrandName] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [baseSku, setBaseSku] = useState('');
  const [baseStock, setBaseStock] = useState('');
  const [baseBarcode, setBaseBarcode] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState('kg');
  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [dimensionUnit, setDimensionUnit] = useState('cm');
  const [returnPolicy, setReturnPolicy] = useState('');
  const [warrantyInfo, setWarrantyInfo] = useState('');

  // Tags
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // SEO
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [handle, setHandle] = useState('');

  // Status change
  const [statusAction, setStatusAction] = useState('');
  const [statusChanging, setStatusChanging] = useState(false);

  // Options editor
  const [productOptions, setProductOptions] = useState<OptionEntry[]>([]);
  const [generatingVariants, setGeneratingVariants] = useState(false);

  // Image upload
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const populateForm = useCallback((p: ProductDetail) => {
    setTitle(p.title || '');
    setShortDescription(p.shortDescription || '');
    setDescription(p.description || '');
    setCategoryId(p.categoryId || '');
    setCategoryName(p.category?.name || '');
    setBrandId(p.brandId || '');
    setBrandName(p.brand?.name || '');
    setBasePrice(p.basePrice || '');
    setCompareAtPrice(p.compareAtPrice || '');
    setCostPrice(p.costPrice || '');
    setBaseSku(p.baseSku || '');
    setBaseStock(p.baseStock !== null && p.baseStock !== undefined ? String(p.baseStock) : '');
    setBaseBarcode(p.baseBarcode || '');
    setWeight(p.weight || '');
    setWeightUnit(p.weightUnit || 'kg');
    setLength(p.length || '');
    setWidth(p.width || '');
    setHeight(p.height || '');
    setDimensionUnit(p.dimensionUnit || 'cm');
    setReturnPolicy(p.returnPolicy || '');
    setWarrantyInfo(p.warrantyInfo || '');
    setTags(p.tags ? p.tags.map(t => t.tag) : []);
    setMetaTitle(p.seo?.metaTitle || '');
    setMetaDescription(p.seo?.metaDescription || '');
    setHandle(p.seo?.handle || '');

    // Reconstruct options from product data
    if ((p as any).options && (p as any).optionValues) {
      const optEntries: OptionEntry[] = [];
      for (const po of (p as any).options) {
        const def = po.optionDefinition;
        if (!def) continue;
        const vals = (p as any).optionValues
          .filter((pov: any) => pov.optionValue?.optionDefinitionId === def.id)
          .map((pov: any) => pov.optionValue?.displayValue || pov.optionValue?.value || '');
        optEntries.push({ name: def.displayName || def.name, values: vals, isEditing: false });
      }
      setProductOptions(optEntries);
    }
  }, []);

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminProductsService.getProduct(productId);
      if (res.data) {
        setProduct(res.data);
        populateForm(res.data);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load product');
    } finally {
      setLoading(false);
    }
  }, [productId, populateForm, router]);

  const loadCatalogData = useCallback(async () => {
    try {
      const [catRes, brandRes] = await Promise.all([
        adminProductsService.getCategories(),
        adminProductsService.getBrands(),
      ]);
      if (catRes.data) {
        const cats = Array.isArray(catRes.data) ? catRes.data : (catRes.data as any).categories || [];
        setCategories(cats);
      }
      if (brandRes.data) {
        const brs = Array.isArray(brandRes.data) ? brandRes.data : (brandRes.data as any).brands || [];
        setBrands(brs);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    loadProduct();
    loadCatalogData();
  }, [loadProduct, loadCatalogData]);

  // ===== Tag helpers =====

  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  };

  // ===== Moderation actions =====

  const handleApprove = async () => {
    try {
      await adminProductsService.approveProduct(productId);
      setSuccess('Product approved successfully.');
      loadProduct();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve product');
    }
  };

  const handleStatusChange = async () => {
    if (!statusAction) return;
    setStatusChanging(true);
    setError('');
    try {
      await adminProductsService.updateStatus(productId, statusAction);
      setSuccess(`Product status updated to ${statusAction}.`);
      setStatusAction('');
      loadProduct();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setStatusChanging(false);
    }
  };

  // ===== Option management =====

  const addOption = () => {
    setProductOptions(prev => [...prev, { name: '', values: [''], isEditing: true }]);
  };

  const removeOption = (index: number) => {
    setProductOptions(prev => prev.filter((_, i) => i !== index));
  };

  const updateOptionName = (index: number, name: string) => {
    setProductOptions(prev => prev.map((opt, i) => i === index ? { ...opt, name } : opt));
  };

  const addOptionValue = (index: number) => {
    setProductOptions(prev => prev.map((opt, i) =>
      i === index ? { ...opt, values: [...opt.values, ''] } : opt
    ));
  };

  const updateOptionValue = (optIndex: number, valIndex: number, value: string) => {
    setProductOptions(prev => prev.map((opt, i) => {
      if (i !== optIndex) return opt;
      const newValues = [...opt.values];
      if (valIndex >= newValues.length) {
        newValues.push(value);
      } else {
        newValues[valIndex] = value;
      }
      return { ...opt, values: newValues };
    }));
  };

  const removeOptionValue = (optIndex: number, valIndex: number) => {
    setProductOptions(prev => prev.map((opt, i) =>
      i === optIndex ? { ...opt, values: opt.values.filter((_, j) => j !== valIndex) } : opt
    ));
  };

  const toggleOptionEdit = (index: number) => {
    setProductOptions(prev => prev.map((opt, i) =>
      i === index ? { ...opt, isEditing: !opt.isEditing } : opt
    ));
  };

  // ===== Generate variants =====

  const handleGenerateVariants = async () => {
    const validOptions = productOptions
      .filter(opt => opt.name.trim() && opt.values.some(v => v.trim()))
      .map(opt => ({ name: opt.name.trim(), values: opt.values.filter(v => v.trim()) }));

    if (validOptions.length === 0) {
      setError('Add at least one option with values before generating variants.');
      return;
    }

    if (product && product.variants && product.variants.length > 0) {
      if (!confirm('This will replace all existing variants. Continue?')) return;
    }

    setGeneratingVariants(true);
    setError('');
    try {
      await adminProductsService.generateManualVariants(productId, validOptions);
      setSuccess('Variants generated successfully.');
      setProductOptions(prev => prev.map(opt => ({ ...opt, isEditing: false })));
      loadProduct();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to generate variants.');
    } finally {
      setGeneratingVariants(false);
    }
  };

  // ===== Delete variant =====

  const handleDeleteVariant = async (variantId: string) => {
    if (!confirm('Delete this variant?')) return;
    try {
      await adminProductsService.deleteVariant(productId, variantId);
      setSuccess('Variant deleted.');
      loadProduct();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete variant.');
    }
  };

  // ===== Image management =====

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingImage(true);
    setError('');
    let uploaded = 0, failed = 0;

    for (let i = 0; i < files.length; i++) {
      if (files[i].size > 5 * 1024 * 1024) { failed++; continue; }
      try {
        await adminProductsService.uploadImage(productId, files[i]);
        uploaded++;
      } catch { failed++; }
    }

    if (failed > 0) setError(`${uploaded} image(s) uploaded, ${failed} failed.`);
    else setSuccess(`${uploaded} image(s) uploaded.`);

    loadProduct();
    setUploadingImage(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteImage = async (imageId: string) => {
    if (!confirm('Delete this image?')) return;
    try {
      await adminProductsService.deleteImage(productId, imageId);
      setSuccess('Image deleted.');
      loadProduct();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete image.');
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    if (!product) return;
    const currentImages = [...(product as any).images].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    const targetImage = currentImages.find((img: any) => img.id === imageId);
    if (!targetImage) return;
    const otherImages = currentImages.filter((img: any) => img.id !== imageId);
    const newOrder = [targetImage, ...otherImages].map((img: any) => img.id);

    try {
      await adminProductsService.reorderImages(productId, newOrder);
      setSuccess('Primary image updated.');
      loadProduct();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reorder images.');
    }
  };

  // ===== Form submit =====

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Product title is required.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    const payload: Record<string, unknown> = {
      title: title.trim(),
    };

    payload.shortDescription = shortDescription.trim() || null;
    payload.description = description.trim() || null;

    if (categoryId) payload.categoryId = categoryId;
    else if (categoryName.trim()) payload.categoryName = categoryName.trim();

    if (brandId) payload.brandId = brandId;
    else if (brandName.trim()) payload.brandName = brandName.trim();

    if (basePrice) payload.basePrice = parseFloat(basePrice);
    if (compareAtPrice) payload.compareAtPrice = parseFloat(compareAtPrice);
    else payload.compareAtPrice = null;
    if (costPrice) payload.costPrice = parseFloat(costPrice);
    else payload.costPrice = null;
    payload.baseSku = baseSku.trim() || null;
    if (baseStock !== '') payload.baseStock = parseInt(baseStock, 10);
    payload.baseBarcode = baseBarcode.trim() || null;
    if (weight) payload.weight = parseFloat(weight);
    else payload.weight = null;
    payload.weightUnit = weightUnit || null;
    if (length) payload.length = parseFloat(length);
    else payload.length = null;
    if (width) payload.width = parseFloat(width);
    else payload.width = null;
    if (height) payload.height = parseFloat(height);
    else payload.height = null;
    payload.dimensionUnit = dimensionUnit || null;
    payload.returnPolicy = returnPolicy.trim() || null;
    payload.warrantyInfo = warrantyInfo.trim() || null;
    payload.tags = tags;

    const seo: Record<string, string | null> = {};
    seo.metaTitle = metaTitle.trim() || null;
    seo.metaDescription = metaDescription.trim() || null;
    seo.handle = handle.trim() || null;
    payload.seo = seo;

    try {
      const res = await adminProductsService.updateProduct(productId, payload);
      if (res.data) {
        setProduct(res.data);
        populateForm(res.data);
        setSuccess('Product updated successfully.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to update product');
    } finally {
      setSubmitting(false);
    }
  };

  const onModalSuccess = () => {
    setActiveModal(null);
    setSuccess('Action completed successfully.');
    loadProduct();
  };

  const formatStatus = (status: string) => status.replace(/_/g, ' ');

  if (loading) {
    return (
      <div className="product-form-page">
        <div className="product-form-loading">Loading product...</div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="product-form-page">
        <div className="product-form-alert error">{error || 'Product not found.'}</div>
        <Link href="/dashboard/products" className="product-form-back">
          &#8592; Back to Products
        </Link>
      </div>
    );
  }

  const isSubmitted = product.status === 'SUBMITTED';

  return (
    <div className="product-form-page">
      <Link href="/dashboard/products" className="product-form-back">
        &#8592; Back to Products
      </Link>

      <div className="product-form-header">
        <h1>Edit Product</h1>
      </div>

      {error && <div className="product-form-alert error">{error}</div>}
      {success && <div className="product-form-alert success">{success}</div>}

      {/* Moderation Actions (only for SUBMITTED products) */}
      {isSubmitted && (
        <div className="moderation-actions">
          <span className="moderation-label">Moderation: Product is awaiting review</span>
          <button className="moderation-btn approve" onClick={handleApprove}>Approve</button>
          <button className="moderation-btn reject" onClick={() => setActiveModal('reject')}>Reject</button>
          <button className="moderation-btn changes" onClick={() => setActiveModal('requestChanges')}>Request Changes</button>
        </div>
      )}

      {/* Seller info (readonly) */}
      {product.seller && (
        <div className="product-seller-bar">
          <span className="seller-label">Seller:</span>
          <span className="seller-value">
            {product.seller.sellerName} ({product.seller.sellerShopName}) &mdash; {product.seller.email}
          </span>
        </div>
      )}

      {/* Status info bar */}
      <div className="product-seller-bar">
        <span className="seller-label">Status:</span>
        <span className="seller-value">{formatStatus(product.status)}</span>
        <span className="seller-label" style={{ marginLeft: 16 }}>Moderation:</span>
        <span className="seller-value">{formatStatus(product.moderationStatus)}</span>
        {product.moderationNote && (
          <>
            <span className="seller-label" style={{ marginLeft: 16 }}>Note:</span>
            <span className="seller-value">{product.moderationNote}</span>
          </>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Basic Info */}
        <div className="product-form-section">
          <h2>Basic Information</h2>
          <div className="form-group">
            <label>Product Title <span className="required">*</span></label>
            <input
              type="text"
              placeholder="Enter product title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Short Description</label>
            <textarea
              placeholder="Brief description of the product"
              value={shortDescription}
              onChange={e => setShortDescription(e.target.value)}
              style={{ minHeight: 60 }}
            />
          </div>
          <div className="form-group">
            <label>Full Description</label>
            <RichTextEditor value={description} onChange={setDescription} placeholder="Detailed product description" minHeight={200} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Category</label>
              <input
                type="text"
                list="category-list"
                value={categoryName}
                onChange={e => {
                  const typed = e.target.value;
                  setCategoryName(typed);
                  const match = categories.find(c => c.name.toLowerCase() === typed.toLowerCase());
                  if (match) setCategoryId(match.id);
                  else setCategoryId('');
                }}
                placeholder="Type or select category"
              />
              <datalist id="category-list">
                {categories.map(c => <option key={c.id} value={c.name} />)}
              </datalist>
              <div className="field-hint">Type a new category or select from existing</div>
            </div>
            <div className="form-group">
              <label>Brand</label>
              <input
                type="text"
                list="brand-list"
                value={brandName}
                onChange={e => {
                  const typed = e.target.value;
                  setBrandName(typed);
                  const match = brands.find(b => b.name.toLowerCase() === typed.toLowerCase());
                  if (match) setBrandId(match.id);
                  else setBrandId('');
                }}
                placeholder="Type or select brand"
              />
              <datalist id="brand-list">
                {brands.map(b => <option key={b.id} value={b.name} />)}
              </datalist>
              <div className="field-hint">Type a new brand or select from existing</div>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div className="product-form-section">
          <h2>Pricing</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Base Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={basePrice}
                onChange={e => setBasePrice(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Compare At Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={compareAtPrice}
                onChange={e => setCompareAtPrice(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Cost Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={costPrice}
                onChange={e => setCostPrice(e.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>SKU</label>
              <input
                type="text"
                placeholder="Stock Keeping Unit"
                value={baseSku}
                onChange={e => setBaseSku(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Stock</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={baseStock}
                onChange={e => setBaseStock(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Barcode</label>
              <input
                type="text"
                placeholder="UPC, EAN, etc."
                value={baseBarcode}
                onChange={e => setBaseBarcode(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Shipping */}
        <div className="product-form-section">
          <h2>Shipping</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Weight</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={weight}
                onChange={e => setWeight(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Weight Unit</label>
              <select value={weightUnit} onChange={e => setWeightUnit(e.target.value)}>
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="lb">lb</option>
                <option value="oz">oz</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Length</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={length}
                onChange={e => setLength(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Width</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={width}
                onChange={e => setWidth(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Height</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={height}
                onChange={e => setHeight(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Dimension Unit</label>
              <select value={dimensionUnit} onChange={e => setDimensionUnit(e.target.value)}>
                <option value="cm">cm</option>
                <option value="in">in</option>
                <option value="m">m</option>
              </select>
            </div>
          </div>
        </div>

        {/* Variants */}
        <div className="product-form-section">
          <h2>Variants</h2>

          {/* Options Editor */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#374151' }}>Options</div>

            {productOptions.map((opt, optIdx) => (
              <div key={optIdx} className="option-card">
                {opt.isEditing ? (
                  <div className="option-card-editing">
                    <div className="option-card-edit-header">
                      <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                        <label>Option name</label>
                        <input type="text" value={opt.name} onChange={e => updateOptionName(optIdx, e.target.value)} placeholder="e.g. Size, Color, Material" />
                      </div>
                      <button type="button" className="option-delete-btn" onClick={() => removeOption(optIdx)} title="Delete option">&#128465;</button>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <label>Option values</label>
                      {opt.values.map((val, valIdx) => (
                        <div key={valIdx} className="option-value-row">
                          <input type="text" value={val} onChange={e => updateOptionValue(optIdx, valIdx, e.target.value)} placeholder="Enter value" />
                          <button type="button" className="option-delete-btn" onClick={() => removeOptionValue(optIdx, valIdx)} title="Remove value">&#128465;</button>
                        </div>
                      ))}
                      <button type="button" className="add-option-btn" style={{ marginTop: 8 }} onClick={() => addOptionValue(optIdx)}>+ Add another value</button>
                    </div>
                    <button type="button" className="moderation-btn approve" style={{ marginTop: 12, padding: '6px 20px', fontSize: 13 }} onClick={() => toggleOptionEdit(optIdx)}>Done</button>
                  </div>
                ) : (
                  <div className="option-card-collapsed">
                    <div className="option-card-info">
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{opt.name || 'Unnamed option'}</div>
                      <div className="option-chips">
                        {opt.values.filter(v => v.trim()).map((val, i) => (
                          <span key={i} className="option-chip">{val}</span>
                        ))}
                      </div>
                    </div>
                    <button type="button" className="product-form-btn" style={{ padding: '4px 16px', fontSize: 13 }} onClick={() => toggleOptionEdit(optIdx)}>Edit</button>
                  </div>
                )}
              </div>
            ))}

            <button type="button" className="add-option-btn" onClick={addOption}>+ Add another option</button>
          </div>

          {/* Generate button */}
          {productOptions.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <button type="button" className="product-form-btn product-form-btn-primary" onClick={handleGenerateVariants} disabled={generatingVariants}>
                {generatingVariants ? 'Generating...' : 'Generate Variants'}
              </button>
              {product && product.variants && product.variants.length > 0 && (
                <span className="field-hint" style={{ marginLeft: 12 }}>This will replace existing {product.variants.length} variant(s)</span>
              )}
            </div>
          )}

          {/* Variants Table */}
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#374151' }}>
            Variants ({product?.variants?.length || 0})
          </div>

          {(!product?.variants || product.variants.length === 0) ? (
            <div className="field-hint">No variants yet. Define options above and click &quot;Generate Variants&quot; to create them.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="variant-table">
                <thead>
                  <tr>
                    <th>Option Values</th>
                    <th>SKU</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants.map((variant: any) => {
                    const ovs = (variant.optionValues || []).map((ov: any) => {
                      if (ov.optionValue) return { value: ov.optionValue.value, displayValue: ov.optionValue.displayValue };
                      return ov;
                    });
                    const variantLabel = ovs.map((ov: any) => ov.displayValue || ov.value).join(' / ') || variant.title || 'Unnamed';

                    return (
                      <tr key={variant.id}>
                        <td style={{ fontWeight: 500 }}>{variantLabel}</td>
                        <td>{variant.sku || '\u2014'}</td>
                        <td>&#8377; {variant.price}</td>
                        <td>{variant.stock}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <Link href={`/dashboard/products/${productId}/variants/${variant.id}`} style={{ color: 'var(--color-primary)', fontSize: 13 }}>Edit</Link>
                            <button type="button" onClick={() => handleDeleteVariant(variant.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>Delete</button>
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

        {/* Images */}
        <div className="product-form-section">
          <h2>Images</h2>
          <div className="image-upload-area" onClick={() => fileInputRef.current?.click()}>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} style={{ display: 'none' }} />
            <p>{uploadingImage ? 'Uploading...' : 'Click to upload images'}</p>
            <p className="field-hint">Max 5MB each. JPG, PNG, or WebP.</p>
          </div>

          {product?.images && product.images.length > 0 ? (
            <div className="image-grid">
              {[...product.images].sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((img: any) => (
                <div key={img.id} className={`image-card${img.isPrimary ? ' primary' : ''}`}>
                  <img src={img.url} alt="" />
                  {img.isPrimary && <div className="image-primary-badge">Primary</div>}
                  <div className="image-card-actions">
                    {!img.isPrimary && (
                      <button type="button" className="primary-btn" onClick={() => handleSetPrimary(img.id)} title="Set as primary">&#9733;</button>
                    )}
                    <button type="button" className="delete-btn" onClick={() => handleDeleteImage(img.id)} title="Delete">&times;</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="field-hint">No images uploaded yet.</p>
          )}
        </div>

        {/* Tags */}
        <div className="product-form-section">
          <h2>Tags</h2>
          <div className="form-group">
            <label>Product Tags</label>
            <div className="tags-input-wrap">
              {tags.map(tag => (
                <span key={tag} className="tag-item">
                  {tag}
                  <button type="button" className="tag-remove" onClick={() => removeTag(tag)}>&times;</button>
                </span>
              ))}
              <input
                className="tags-input"
                type="text"
                placeholder="Add tag and press Enter"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
              />
            </div>
            <div className="field-hint">Press Enter or comma to add a tag.</div>
          </div>
        </div>

        {/* SEO */}
        <div className="product-form-section">
          <h2>SEO</h2>
          <div className="form-group">
            <label>Meta Title</label>
            <input
              type="text"
              placeholder="Page title for search engines"
              value={metaTitle}
              onChange={e => setMetaTitle(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Meta Description</label>
            <textarea
              placeholder="Description for search engines"
              value={metaDescription}
              onChange={e => setMetaDescription(e.target.value)}
              style={{ minHeight: 60 }}
            />
          </div>
          <div className="form-group">
            <label>URL Handle</label>
            <input
              type="text"
              placeholder="product-url-slug"
              value={handle}
              onChange={e => setHandle(e.target.value)}
            />
          </div>
        </div>

        {/* Policy */}
        <div className="product-form-section">
          <h2>Policy</h2>
          <div className="form-group">
            <label>Return Policy</label>
            <textarea
              placeholder="Describe the return policy for this product"
              value={returnPolicy}
              onChange={e => setReturnPolicy(e.target.value)}
              style={{ minHeight: 60 }}
            />
          </div>
          <div className="form-group">
            <label>Warranty Information</label>
            <textarea
              placeholder="Warranty details"
              value={warrantyInfo}
              onChange={e => setWarrantyInfo(e.target.value)}
              style={{ minHeight: 60 }}
            />
          </div>
        </div>

        {/* Status Change (for ACTIVE/SUSPENDED/ARCHIVED) */}
        {(product.status === 'ACTIVE' || product.status === 'SUSPENDED' || product.status === 'APPROVED') && (
          <div className="product-form-section">
            <h2>Status Change</h2>
            <div className="status-change-group">
              <div className="form-group">
                <label>Change Status</label>
                <select value={statusAction} onChange={e => setStatusAction(e.target.value)}>
                  <option value="">Select new status</option>
                  {product.status !== 'ACTIVE' && <option value="ACTIVE">Active</option>}
                  {product.status !== 'SUSPENDED' && <option value="SUSPENDED">Suspended</option>}
                  {(product.status as string) !== 'ARCHIVED' && <option value="ARCHIVED">Archived</option>}
                </select>
              </div>
              <button
                type="button"
                className="status-change-btn"
                onClick={handleStatusChange}
                disabled={!statusAction || statusChanging}
              >
                {statusChanging ? 'Updating...' : 'Update Status'}
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="product-form-actions">
          <Link href="/dashboard/products" className="product-form-btn" style={{ textDecoration: 'none' }}>
            Cancel
          </Link>
          <button
            type="submit"
            className="product-form-btn product-form-btn-primary"
            disabled={submitting}
          >
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      {/* Modals */}
      {activeModal === 'reject' && product && (
        <RejectModal
          product={product}
          onClose={() => setActiveModal(null)}
          onSuccess={onModalSuccess}
        />
      )}
      {activeModal === 'requestChanges' && product && (
        <RequestChangesModal
          product={product}
          onClose={() => setActiveModal(null)}
          onSuccess={onModalSuccess}
        />
      )}
    </div>
  );
}
