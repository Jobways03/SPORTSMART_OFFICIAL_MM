'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService } from '@/services/admin-products.service';
import { adminSellersService, SellerListItem } from '@/services/admin-sellers.service';
import { ApiError } from '@/lib/api-client';
import '../product-form.css';
import { RichTextEditor } from '@sportsmart/ui';

// ----- Types -----

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

interface Brand {
  id: string;
  name: string;
}

interface FlatCategory {
  id: string;
  name: string;
  depth: number;
}

interface Toast {
  type: 'success' | 'error';
  message: string;
}

// ----- Helpers -----

function flattenCategories(nodes: CategoryNode[], depth = 0): FlatCategory[] {
  const result: FlatCategory[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    if (node.children && node.children.length > 0) {
      result.push(...flattenCategories(node.children, depth + 1));
    }
  }
  return result;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ----- Component -----

export default function CreateProductPage() {
  const router = useRouter();

  // Form state (single object like seller page)
  const [form, setForm] = useState({
    sellerEmail: '',
    title: '',
    categoryId: '',
    categoryName: '',
    brandId: '',
    brandName: '',
    shortDescription: '',
    description: '',
    hasVariants: false,
    basePrice: '',
    compareAtPrice: '',
    costPrice: '',
    baseSku: '',
    baseStock: '',
    baseBarcode: '',
    weight: '',
    weightUnit: 'kg',
    length: '',
    width: '',
    height: '',
    dimensionUnit: 'cm',
    returnPolicy: '',
    warrantyInfo: '',
    tags: [] as string[],
    seoMetaTitle: '',
    seoMetaDescription: '',
    seoHandle: '',
  });

  const [tagInput, setTagInput] = useState('');
  const [seoHandleEdited, setSeoHandleEdited] = useState(false);

  // Data state
  const [categories, setCategories] = useState<FlatCategory[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeSellers, setActiveSellers] = useState<SellerListItem[]>([]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ----- Load categories, brands, and sellers -----

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, brandRes] = await Promise.all([
          adminProductsService.getCategories(),
          adminProductsService.getBrands(),
        ]);
        if (catRes.data) {
          const nodes = Array.isArray(catRes.data) ? catRes.data : (catRes.data as any).categories || [];
          setCategories(flattenCategories(nodes));
        }
        if (brandRes.data) {
          const brandList = Array.isArray(brandRes.data) ? brandRes.data : (brandRes.data as any).brands || [];
          setBrands(brandList);
        }
      } catch {
        // Non-critical — dropdowns will just be empty
      }

      try {
        const sellersRes = await adminSellersService.listSellers({ status: 'ACTIVE', limit: 100 });
        if (sellersRes.data?.sellers) {
          setActiveSellers(sellersRes.data.sellers);
        }
      } catch {
        // Non-critical
      }
    }
    loadData();
  }, []);

  // ----- Toast helper -----

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ----- Form helpers -----

  const updateField = useCallback(
    (field: string, value: string | boolean) => {
      setForm(prev => {
        const next = { ...prev, [field]: value };
        // Auto-generate SEO handle from title
        if (field === 'title' && !seoHandleEdited) {
          next.seoHandle = slugify(value as string);
        }
        return next;
      });
      // Clear field error on change
      setErrors(prev => {
        if (prev[field]) {
          const next = { ...prev };
          delete next[field];
          return next;
        }
        return prev;
      });
    },
    [seoHandleEdited],
  );

  const addTag = useCallback(() => {
    const tag = tagInput.trim();
    if (tag && !form.tags.includes(tag)) {
      setForm(prev => ({ ...prev, tags: [...prev.tags, tag] }));
    }
    setTagInput('');
  }, [tagInput, form.tags]);

  const removeTag = useCallback((tag: string) => {
    setForm(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tag) }));
  }, []);

  // ----- Validation -----

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.sellerEmail.trim()) {
      errs.sellerEmail = 'Seller is required';
    }
    if (!form.title.trim()) {
      errs.title = 'Title is required';
    }
    if (!form.hasVariants) {
      if (!form.basePrice || isNaN(Number(form.basePrice)) || Number(form.basePrice) <= 0) {
        errs.basePrice = 'Price is required and must be greater than 0';
      }
      if (form.baseStock === '' || isNaN(Number(form.baseStock)) || Number(form.baseStock) < 0) {
        errs.baseStock = 'Stock is required and must be 0 or more';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ----- Build payload -----

  function buildPayload() {
    const payload: any = {
      sellerEmail: form.sellerEmail.trim(),
      title: form.title.trim(),
      hasVariants: form.hasVariants,
    };

    if (form.categoryId) payload.categoryId = form.categoryId;
    else if (form.categoryName?.trim()) payload.categoryName = form.categoryName.trim();
    if (form.brandId) payload.brandId = form.brandId;
    else if (form.brandName?.trim()) payload.brandName = form.brandName.trim();
    if (form.shortDescription.trim()) payload.shortDescription = form.shortDescription.trim();
    if (form.description.trim()) payload.description = form.description.trim();

    // Always send pricing/inventory — used as defaults for variants too
    if (form.basePrice) payload.basePrice = Number(form.basePrice);
    if (form.compareAtPrice) payload.compareAtPrice = Number(form.compareAtPrice);
    if (form.costPrice) payload.costPrice = Number(form.costPrice);
    if (form.baseSku.trim()) payload.baseSku = form.baseSku.trim();
    if (form.baseStock !== '') payload.baseStock = Number(form.baseStock);
    if (form.baseBarcode.trim()) payload.baseBarcode = form.baseBarcode.trim();

    if (form.weight) payload.weight = Number(form.weight);
    payload.weightUnit = form.weightUnit;
    if (form.length) payload.length = Number(form.length);
    if (form.width) payload.width = Number(form.width);
    if (form.height) payload.height = Number(form.height);
    payload.dimensionUnit = form.dimensionUnit;

    if (form.returnPolicy.trim()) payload.returnPolicy = form.returnPolicy.trim();
    if (form.warrantyInfo.trim()) payload.warrantyInfo = form.warrantyInfo.trim();

    if (form.tags.length > 0) payload.tags = form.tags;

    const seo: any = {};
    if (form.seoMetaTitle.trim()) seo.metaTitle = form.seoMetaTitle.trim();
    if (form.seoMetaDescription.trim()) seo.metaDescription = form.seoMetaDescription.trim();
    if (form.seoHandle.trim()) seo.handle = form.seoHandle.trim();
    if (Object.keys(seo).length > 0) payload.seo = seo;

    return payload;
  }

  // ----- Submit handler -----

  async function handleSave() {
    if (!validate()) {
      showToast('error', 'Please fix the errors before saving.');
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      const res = await adminProductsService.createProduct(payload);

      if (res.data?.id) {
        showToast('success', 'Product created successfully.');
        setTimeout(() => router.push(`/dashboard/products/${res.data!.id}/edit`), 800);
      } else {
        showToast('success', 'Product saved as draft.');
        setTimeout(() => router.push('/dashboard/products'), 800);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          router.replace('/login');
          return;
        }
        showToast('error', err.message || 'Failed to create product.');
        if (err.body.errors) {
          const fieldErrors: Record<string, string> = {};
          for (const e of err.body.errors) {
            fieldErrors[e.field] = e.message;
          }
          setErrors(prev => ({ ...prev, ...fieldErrors }));
        }
      } else {
        showToast('error', 'An unexpected error occurred.');
      }
    } finally {
      setSaving(false);
    }
  }

  // ----- Render -----

  return (
    <div className="product-form-page">
      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>{toast.message}</div>
      )}

      {/* Header */}
      <div className="product-form-header">
        <div>
          <Link href="/dashboard/products" className="product-form-back">
            &larr; Back to Products
          </Link>
          <h1>Create Product</h1>
        </div>
      </div>

      {/* Section 1: Seller (admin-specific) */}
      <div className="form-card">
        <div className="form-card-title">SELLER</div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label className="form-label">
              Seller Email <span className="required">*</span>
            </label>
            <select
              className="form-select"
              value={form.sellerEmail}
              onChange={e => updateField('sellerEmail', e.target.value)}
            >
              <option value="">Select an active seller</option>
              {activeSellers.map(s => (
                <option key={s.sellerId} value={s.email}>
                  {s.sellerName} — {s.email} ({s.sellerShopName})
                </option>
              ))}
            </select>
            {errors.sellerEmail && <span className="form-error">{errors.sellerEmail}</span>}
            <span className="form-hint">The product will be created under this seller&apos;s account.</span>
          </div>
        </div>
      </div>

      {/* Section 2: Basic Info */}
      <div className="form-card">
        <div className="form-card-title">BASIC INFORMATION</div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label className="form-label">
              Title <span className="required">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={form.title}
              onChange={e => updateField('title', e.target.value)}
              placeholder="Product title"
              maxLength={200}
            />
            {errors.title && <span className="form-error">{errors.title}</span>}
          </div>

          <div className="form-group">
            <label className="form-label">Category</label>
            <input
              type="text"
              className="form-input"
              list="category-list"
              value={form.categoryId ? categories.find(c => c.id === form.categoryId)?.name || form.categoryName || '' : form.categoryName || ''}
              onChange={e => {
                const typed = e.target.value;
                const match = categories.find(c => c.name.toLowerCase() === typed.toLowerCase());
                if (match) {
                  setForm(prev => ({ ...prev, categoryId: match.id, categoryName: '' }));
                } else {
                  setForm(prev => ({ ...prev, categoryId: '', categoryName: typed }));
                }
              }}
              placeholder="Type or select category"
            />
            <datalist id="category-list">
              {categories.map(cat => (
                <option key={cat.id} value={cat.name} />
              ))}
            </datalist>
            <span className="form-hint">Type a new category or select from existing</span>
          </div>

          <div className="form-group">
            <label className="form-label">Brand</label>
            <input
              type="text"
              className="form-input"
              list="brand-list"
              value={form.brandId ? brands.find(b => b.id === form.brandId)?.name || form.brandName || '' : form.brandName || ''}
              onChange={e => {
                const typed = e.target.value;
                const match = brands.find(b => b.name.toLowerCase() === typed.toLowerCase());
                if (match) {
                  setForm(prev => ({ ...prev, brandId: match.id, brandName: '' }));
                } else {
                  setForm(prev => ({ ...prev, brandId: '', brandName: typed }));
                }
              }}
              placeholder="Type or select brand"
            />
            <datalist id="brand-list">
              {brands.map(b => (
                <option key={b.id} value={b.name} />
              ))}
            </datalist>
            <span className="form-hint">Type a new brand or select from existing</span>
          </div>

          <div className="form-group full-width">
            <label className="form-label">Short Description</label>
            <textarea
              className="form-textarea"
              value={form.shortDescription}
              onChange={e => updateField('shortDescription', e.target.value)}
              placeholder="Brief description (shown in product cards)"
              maxLength={300}
            />
            <span className="form-hint">{form.shortDescription.length}/300</span>
          </div>

          <div className="form-group full-width">
            <label className="form-label">Description</label>
            <RichTextEditor
              value={form.description}
              onChange={(val) => updateField('description', val)}
              placeholder="Full product description"
              minHeight={200}
            />
          </div>
        </div>
      </div>

      {/* Section 3: Product Type & Pricing */}
      <div className="form-card">
        <div className="form-card-title">PRODUCT TYPE &amp; PRICING</div>

        <div className="form-checkbox-group">
          <input
            type="checkbox"
            id="hasVariants"
            checked={form.hasVariants}
            onChange={e => updateField('hasVariants', e.target.checked)}
          />
          <label htmlFor="hasVariants">This product has variants (e.g., sizes, colors)</label>
        </div>

        {form.hasVariants && (
          <div className="info-box">
            These values will be applied as defaults to all generated variants. You can edit individual variants later.
          </div>
        )}

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">
                Price <span className="required">*</span>
              </label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.basePrice}
                  onChange={e => updateField('basePrice', e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              {errors.basePrice && <span className="form-error">{errors.basePrice}</span>}
            </div>

            <div className="form-group">
              <label className="form-label">Compare at Price</label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.compareAtPrice}
                  onChange={e => updateField('compareAtPrice', e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              <span className="form-hint">Original price (shown as strikethrough)</span>
            </div>

            <div className="form-group">
              <label className="form-label">Cost Price</label>
              <div className="input-with-prefix">
                <span className="input-prefix">&#8377;</span>
                <input
                  type="number"
                  className="form-input"
                  value={form.costPrice}
                  onChange={e => updateField('costPrice', e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              <span className="form-hint">For profit calculation (not shown to customers)</span>
            </div>

            <div className="form-group">
              <label className="form-label">SKU</label>
              <input
                type="text"
                className="form-input"
                value={form.baseSku}
                onChange={e => updateField('baseSku', e.target.value)}
                placeholder="Stock keeping unit"
              />
              <span className="form-hint" style={{ color: '#dc2626', fontWeight: 500 }}>
                NOTE: SKU is mandatory if you want to fulfill orders using Shiprocket Shipping.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">
                Stock <span className="required">*</span>
              </label>
              <input
                type="number"
                className="form-input"
                value={form.baseStock}
                onChange={e => updateField('baseStock', e.target.value)}
                placeholder="0"
                min="0"
                step="1"
              />
              {errors.baseStock && <span className="form-error">{errors.baseStock}</span>}
            </div>

            <div className="form-group">
              <label className="form-label">Barcode</label>
              <input
                type="text"
                className="form-input"
                value={form.baseBarcode}
                onChange={e => updateField('baseBarcode', e.target.value)}
                placeholder="UPC, EAN, ISBN, etc."
              />
            </div>
          </div>
      </div>

      {/* Section 4: Shipping */}
      <div className="form-card">
        <div className="form-card-title">SHIPPING</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Weight</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.weight}
                onChange={e => updateField('weight', e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
              />
              <select
                className="form-select"
                value={form.weightUnit}
                onChange={e => updateField('weightUnit', e.target.value)}
                style={{ width: 80 }}
              >
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="lb">lb</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Dimensions (L x W x H)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.length}
                onChange={e => updateField('length', e.target.value)}
                placeholder="L"
                min="0"
                step="0.1"
              />
              <span style={{ color: 'var(--color-text-secondary)' }}>&times;</span>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.width}
                onChange={e => updateField('width', e.target.value)}
                placeholder="W"
                min="0"
                step="0.1"
              />
              <span style={{ color: 'var(--color-text-secondary)' }}>&times;</span>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.height}
                onChange={e => updateField('height', e.target.value)}
                placeholder="H"
                min="0"
                step="0.1"
              />
              <select
                className="form-select"
                value={form.dimensionUnit}
                onChange={e => updateField('dimensionUnit', e.target.value)}
                style={{ width: 80 }}
              >
                <option value="cm">cm</option>
                <option value="in">in</option>
                <option value="m">m</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Section 5: Tags */}
      <div className="form-card">
        <div className="form-card-title">TAGS</div>
        <div className="tags-input-group">
          <input
            type="text"
            className="form-input"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Add a tag"
          />
          <button type="button" onClick={addTag}>Add</button>
        </div>
        {form.tags.length > 0 && (
          <div className="tags-list">
            {form.tags.map(tag => (
              <span key={tag} className="tag-chip">
                {tag}
                <button type="button" onClick={() => removeTag(tag)}>&times;</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Section 6: SEO */}
      <div className="form-card">
        <div className="form-card-title">SEO (SEARCH ENGINE OPTIMIZATION)</div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label className="form-label">Handle (URL slug)</label>
            <input
              type="text"
              className="form-input"
              value={form.seoHandle}
              onChange={e => {
                setSeoHandleEdited(true);
                updateField('seoHandle', e.target.value);
              }}
              placeholder="product-url-slug"
            />
            <span className="form-hint">Auto-generated from title. Edit to customize.</span>
          </div>

          <div className="form-group full-width">
            <label className="form-label">Meta Title</label>
            <input
              type="text"
              className="form-input"
              value={form.seoMetaTitle}
              onChange={e => updateField('seoMetaTitle', e.target.value)}
              placeholder="SEO meta title"
              maxLength={70}
            />
          </div>

          <div className="form-group full-width">
            <label className="form-label">Meta Description</label>
            <textarea
              className="form-textarea"
              value={form.seoMetaDescription}
              onChange={e => updateField('seoMetaDescription', e.target.value)}
              placeholder="SEO meta description"
              maxLength={160}
            />
            <span className="form-hint">{form.seoMetaDescription.length}/160</span>
          </div>
        </div>
      </div>

      {/* Section 7: Policies */}
      <div className="form-card">
        <div className="form-card-title">POLICIES</div>
        <div className="form-grid">
          <div className="form-group full-width">
            <label className="form-label">Return Policy</label>
            <textarea
              className="form-textarea"
              value={form.returnPolicy}
              onChange={e => updateField('returnPolicy', e.target.value)}
              placeholder="Describe your return policy"
            />
          </div>

          <div className="form-group full-width">
            <label className="form-label">Warranty Info</label>
            <textarea
              className="form-textarea"
              value={form.warrantyInfo}
              onChange={e => updateField('warrantyInfo', e.target.value)}
              placeholder="Describe warranty coverage"
            />
          </div>
        </div>
      </div>

      {/* Action Buttons (sticky footer) */}
      <div className="form-actions">
        <button
          type="button"
          className="form-btn"
          onClick={() => router.push('/dashboard/products')}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="form-btn primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Create Product'}
        </button>
      </div>
    </div>
  );
}
