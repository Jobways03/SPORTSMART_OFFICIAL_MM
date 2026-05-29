'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sellerProductService } from '@/services/product.service';
import { apiClient, ApiError } from '@/lib/api-client';
import '../product-form.css';
import { RichTextEditor } from '@sportsmart/ui';
// Phase 39 (2026-05-21) — category metafield section.
import {
  CategoryMetafieldFormSection,
  metafieldValuesToPayload,
  type MetafieldValueEntry,
} from '../components/CategoryMetafieldFormSection';

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
  // Phase 32 (2026-05-21) — the sessionStorage-based seller status
  // gate that previously lived here was removed. It was a defence-in-
  // depth check that fell through silently when sessionStorage was
  // empty or stale. The backend SellerProductsController already
  // re-fetches the seller and refuses non-ACTIVE / email-unverified
  // accounts (returns 403 with a clear message which the toast
  // displays). Removing the half-implemented client-side gate keeps
  // the authoritative check in one place.
  const [accessBlocked] = useState(false);
  const [blockMessage] = useState('');

  // Form state
  const [form, setForm] = useState({
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
    // Tax & GST — values are strings (form-input convention) and get
    // coerced to numbers / enum strings in buildPayload(). Empty strings
    // mean "user didn't pick" and the backend will use schema defaults.
    hsnCode: '',
    gstRateBps: '',
    supplyTaxability: '',
    cessRateBps: '',
    defaultUqcCode: '',
    taxCategory: '',
    taxInclusivePricing: true,
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

  // AI generation
  const [aiGenerating, setAiGenerating] = useState(false);

  const generateWithAI = useCallback(async () => {
    if (!form.title.trim()) {
      setToast({ type: 'error', message: 'Enter a product title first to generate content with AI.' });
      return;
    }
    setAiGenerating(true);
    try {
      const json = await apiClient<any>('/ai/generate-product-content', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title,
          category: form.categoryName || categories.find(c => c.id === form.categoryId)?.name || '',
          brand: form.brandName || brands.find(b => b.id === form.brandId)?.name || '',
          shortDescription: form.shortDescription,
        }),
      });
      if (json.data) {
        setForm(prev => ({
          ...prev,
          description: json.data.description || prev.description,
          seoHandle: json.data.slug || prev.seoHandle,
          seoMetaTitle: json.data.metaTitle || prev.seoMetaTitle,
          seoMetaDescription: json.data.metaDescription || prev.seoMetaDescription,
        }));
        setSeoHandleEdited(true);
        setToast({ type: 'success', message: 'AI content generated! Review and edit as needed.' });
      } else {
        setToast({ type: 'error', message: json.message || 'AI generation failed.' });
      }
    } catch {
      setToast({ type: 'error', message: 'AI generation failed. Check your connection.' });
    } finally {
      setAiGenerating(false);
    }
  }, [form.title, form.categoryName, form.categoryId, form.brandName, form.brandId, form.shortDescription, categories, brands]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Phase 39 (2026-05-21) — category-metafield values for this product.
  // Keyed by definition id. Empty entries are filtered out at payload
  // build time so the backend doesn't see null upserts.
  const [metafieldValues, setMetafieldValues] = useState<Record<string, MetafieldValueEntry>>({});

  // ----- Load categories and brands -----

  useEffect(() => {
    async function loadData() {
      try {
        const [catRes, brandRes] = await Promise.all([
          sellerProductService.getCategories(),
          sellerProductService.getBrands(),
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

    // Tax & GST — only send fields the seller actually filled in.
    // Backend stamps tax_config_updated_by/at only when at least one
    // tax field arrives, so the audit trail stays meaningful.
    if (form.hsnCode.trim()) payload.hsnCode = form.hsnCode.trim();
    if (form.gstRateBps !== '') payload.gstRateBps = Number(form.gstRateBps);
    if (form.supplyTaxability) payload.supplyTaxability = form.supplyTaxability;
    if (form.cessRateBps !== '') payload.cessRateBps = Number(form.cessRateBps);
    if (form.defaultUqcCode) payload.defaultUqcCode = form.defaultUqcCode;
    if (form.taxCategory.trim()) payload.taxCategory = form.taxCategory.trim();
    // Boolean is sent only when the seller flips it off the default
    // (true). Otherwise omit — DB default keeps it true and no audit
    // stamp fires.
    if (form.taxInclusivePricing === false) payload.taxInclusivePricing = false;

    if (form.tags.length > 0) payload.tags = form.tags;

    // Phase 39 (2026-05-21) — bundle category metafield values into
    // the payload so the create call writes them in the same request.
    const metafields = metafieldValuesToPayload(metafieldValues);
    if (metafields.length > 0) payload.metafields = metafields;

    const seo: any = {};
    if (form.seoMetaTitle.trim()) seo.metaTitle = form.seoMetaTitle.trim();
    if (form.seoMetaDescription.trim()) seo.metaDescription = form.seoMetaDescription.trim();
    if (form.seoHandle.trim()) seo.handle = form.seoHandle.trim();
    if (Object.keys(seo).length > 0) payload.seo = seo;

    return payload;
  }

  // ----- Submit handlers -----

  async function handleSave(submitForReview: boolean) {
    if (!validate()) {
      showToast('error', 'Please fix the errors before saving.');
      return;
    }

    setSaving(true);
    try {
      const token = sessionStorage.getItem('accessToken') || '';
      const payload = buildPayload();
      const res = await sellerProductService.createProduct(token, payload);

      if (submitForReview && res.data?.id) {
        try {
          await sellerProductService.submitForReview(token, res.data.id);
          showToast('success', 'Product submitted for review. Your SKU mapping will go live after admin approval.');
        } catch {
          showToast('success', 'Product created as draft. Failed to submit for review.');
        }
      } else {
        showToast('success', 'Product saved as draft.');
      }

      // Navigate after a short delay so toast is visible
      setTimeout(() => router.push('/dashboard/products'), 800);
    } catch (err) {
      if (err instanceof ApiError) {
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

  if (accessBlocked) {
    return (
      <div className="product-form-page">
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
          <h2 style={{ color: '#1f2937', marginBottom: 8 }}>Access Restricted</h2>
          <p>{blockMessage}</p>
          <Link href="/dashboard" style={{ color: 'var(--color-primary)', marginTop: 16, display: 'inline-block' }}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

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

      {/* Section 1: Basic Info */}
      <div className="form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="form-card-title" style={{ marginBottom: 0 }}>BASIC INFORMATION</div>
          <button
            type="button"
            onClick={generateWithAI}
            disabled={aiGenerating || !form.title.trim()}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 600,
              background: aiGenerating ? '#e5e7eb' : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
              color: aiGenerating ? '#6b7280' : '#fff',
              border: 'none', borderRadius: 8, cursor: aiGenerating ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.2s',
            }}
          >
            {aiGenerating ? (
              <>Generating...</>
            ) : (
              <>&#10024; Generate with AI</>
            )}
          </button>
        </div>
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

      {/* Phase 39 (2026-05-21) — category-driven metafield section.
          Renders directly after BASIC INFORMATION so sellers see the
          required fields right after picking a category. */}
      <CategoryMetafieldFormSection
        categoryId={form.categoryId || null}
        values={metafieldValues}
        onChange={setMetafieldValues}
      />

      {/* Section 2: Product Type & Pricing */}
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

      {/* Section 3: Shipping */}
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

      {/* Section: Tax & GST Classification */}
      <div className="form-card">
        <div className="form-card-title">TAX &amp; GST CLASSIFICATION</div>
        <div className="info-box">
          Required for tax-invoice generation. Products without HSN code or
          a GST rate get flagged at audit-readiness review before the
          platform flips to STRICT tax mode — fill these now if you know them.
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">HSN / SAC Code</label>
            <input
              type="text"
              className="form-input"
              value={form.hsnCode}
              onChange={e => updateField('hsnCode', e.target.value)}
              placeholder="e.g. 95069900"
              maxLength={8}
              inputMode="numeric"
            />
            <span className="form-hint">4&ndash;8 digit code per CBIC. Sports goods sit under 9506xx.</span>
          </div>

          <div className="form-group">
            <label className="form-label">GST Rate</label>
            <select
              className="form-select"
              value={form.gstRateBps}
              onChange={e => updateField('gstRateBps', e.target.value)}
            >
              <option value="">Select rate</option>
              <option value="0">0%</option>
              <option value="500">5%</option>
              <option value="1200">12%</option>
              <option value="1800">18%</option>
              <option value="2800">28%</option>
            </select>
            <span className="form-hint">Standard CBIC slabs. Contact admin for non-standard HSN.</span>
          </div>

          <div className="form-group">
            <label className="form-label">Supply Type</label>
            <select
              className="form-select"
              value={form.supplyTaxability}
              onChange={e => updateField('supplyTaxability', e.target.value)}
            >
              <option value="">Select supply type</option>
              <option value="TAXABLE">Taxable (standard)</option>
              <option value="NIL_RATED">Nil-rated</option>
              <option value="EXEMPT">Exempt</option>
              <option value="NON_GST">Non-GST</option>
              <option value="ZERO_RATED">Zero-rated (exports under LUT)</option>
              <option value="OUT_OF_SCOPE">Out of scope</option>
            </select>
            <span className="form-hint">Drives the document type: Tax Invoice vs Bill of Supply.</span>
          </div>

          <div className="form-group">
            <label className="form-label">Unit of Measure (UQC)</label>
            <select
              className="form-select"
              value={form.defaultUqcCode}
              onChange={e => updateField('defaultUqcCode', e.target.value)}
            >
              <option value="">Select unit</option>
              <option value="NOS">NOS &mdash; Numbers</option>
              <option value="PCS">PCS &mdash; Pieces</option>
              <option value="PAR">PAR &mdash; Pair</option>
              <option value="SET">SET &mdash; Set</option>
              <option value="BOX">BOX &mdash; Box</option>
              <option value="KGS">KGS &mdash; Kilograms</option>
              <option value="MTR">MTR &mdash; Metres</option>
              <option value="DOZ">DOZ &mdash; Dozen</option>
            </select>
            <span className="form-hint">Appears on invoice line items per CBIC UQC list.</span>
          </div>

          <div className="form-group">
            <label className="form-label">Tax Category</label>
            <input
              type="text"
              className="form-input"
              value={form.taxCategory}
              onChange={e => updateField('taxCategory', e.target.value)}
              placeholder="e.g. apparel-under-1000, footwear, equipment"
            />
            <span className="form-hint">Optional. Internal grouping for admin bulk operations and reports.</span>
          </div>

          <div className="form-group">
            <label className="form-label">Compensation Cess Rate</label>
            <input
              type="number"
              className="form-input"
              value={form.cessRateBps}
              onChange={e => updateField('cessRateBps', e.target.value)}
              placeholder="0"
              min="0"
              max="10000"
              step="1"
            />
            <span className="form-hint">Basis points (1800 = 18%). Default 0; rare for sports goods.</span>
          </div>

          <div className="form-group full-width">
            <div className="form-checkbox-group">
              <input
                type="checkbox"
                id="taxInclusivePricing"
                checked={form.taxInclusivePricing}
                onChange={e => updateField('taxInclusivePricing', e.target.checked)}
              />
              <label htmlFor="taxInclusivePricing">
                Listed price includes GST (B2C inclusive pricing &mdash; default)
              </label>
            </div>
            <span className="form-hint">
              Uncheck only if your listed prices exclude GST (rare in B2C).
            </span>
          </div>
        </div>
      </div>

      {/* Section 4: Tags */}
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

      {/* Section 5: SEO */}
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

      {/* Section 6: Policy */}
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

      {/* Action Buttons */}
      <div className="form-actions">
        <button
          type="button"
          className="form-btn"
          onClick={() => handleSave(false)}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save as Draft'}
        </button>
        <button
          type="button"
          className="form-btn primary"
          onClick={() => handleSave(true)}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save & Submit for Review'}
        </button>
      </div>
    </div>
  );
}
