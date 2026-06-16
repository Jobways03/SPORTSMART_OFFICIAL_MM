'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sellerProductService } from '@/services/product.service';
import { apiClient, ApiError } from '@/lib/api-client';
import { validateAmount, filterAmount, filterInteger } from '@/lib/validators';
import '../product-form.css';
import { RichTextEditor, useModal } from '@sportsmart/ui';
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
  const { confirmDialog } = useModal();
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
  // Phase 249 (#4) — the generationLogId returned by the AI generate
  // endpoint (meta.generationLogId), captured only when the seller
  // actually accepts the generated draft. Echoed back on product save
  // so the backend stamps AI provenance + flips the log to ACCEPTED.
  // Cleared after a successful save (consumed) or null when untracked.
  const [aiGenerationLogId, setAiGenerationLogId] = useState<string | null>(null);

  const generateWithAI = useCallback(async () => {
    if (!form.title.trim()) {
      setToast({ type: 'error', message: 'Enter a product title first to generate content with AI.' });
      return;
    }
    // Data-loss guard: if the seller already wrote content into any of
    // the fields AI would overwrite, confirm before clobbering it. Uses
    // confirmDialog from useModal — the same modal the rest of the
    // dashboard (and the edit page) uses.
    const hasExistingContent =
      form.description.trim() !== '' ||
      form.seoHandle.trim() !== '' ||
      form.seoMetaTitle.trim() !== '' ||
      form.seoMetaDescription.trim() !== '';
    if (hasExistingContent) {
      if (!(await confirmDialog('You already have content in some fields. Overwrite it with the AI-generated version?'))) return;
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
        // meta is a sibling of data on the raw apiClient response envelope.
        // Captured only here — after the confirm guard passed and we applied
        // the result — so the id is threaded only when the seller accepted.
        setAiGenerationLogId((json as any).meta?.generationLogId ?? null);
        setSeoHandleEdited(true);
        setToast({ type: 'success', message: '✨ AI-generated — review for accuracy before saving.' });
      } else {
        setToast({ type: 'error', message: json.message || 'AI generation failed.' });
      }
    } catch {
      setToast({ type: 'error', message: 'AI generation failed. Check your connection.' });
    } finally {
      setAiGenerating(false);
    }
  }, [form.title, form.categoryName, form.categoryId, form.brandName, form.brandId, form.shortDescription, form.description, form.seoHandle, form.seoMetaTitle, form.seoMetaDescription, categories, brands, confirmDialog]);

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
      // Price is money into the catalog — finite, > 0, <= 10,000,000, at
      // most 2 decimal places (canonical validateAmount).
      const priceErr = validateAmount(form.basePrice, { min: 0.01, label: 'Price' });
      if (priceErr) {
        errs.basePrice = priceErr;
      }
      if (form.baseStock === '' || isNaN(Number(form.baseStock)) || Number(form.baseStock) < 0) {
        errs.baseStock = 'Stock is required and must be 0 or more';
      }
    }
    // Sellers cannot mint taxonomy — a typed value that didn't resolve to an
    // existing category/brand id would be rejected by the backend with a 400,
    // so block it here with actionable guidance instead.
    if (!form.categoryId && form.categoryName?.trim()) {
      errs.category = 'Select an existing category from the list';
    }
    if (!form.brandId && form.brandName?.trim()) {
      errs.brand = 'Select an existing brand from the list';
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

    // Send ids only — the seller DTO rejects free-text categoryName/brandName
    // (Phase 30 anti-injection). A typed-but-unmatched value is blocked in
    // validate(), so it never reaches here.
    if (form.categoryId) payload.categoryId = form.categoryId;
    if (form.brandId) payload.brandId = form.brandId;
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

    // Tax & GST (HSN, rate, supply type, cess, UQC, tax category) is set
    // by a super-admin only — never sent from the seller form.

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
      // Phase 249 (#4) — thread the AI generation log id onto the create
      // so the backend stamps provenance + marks the generation ACCEPTED.
      // Allowlisted on SellerCreateProductDto; backend CAS-guards double-accept.
      if (aiGenerationLogId) payload.aiGenerationLogId = aiGenerationLogId;
      const res = await sellerProductService.createProduct(token, payload);
      // Consumed — clear so a later save (or resubmit) doesn't re-send it.
      setAiGenerationLogId(null);

      if (submitForReview && res.data?.id) {
        try {
          await sellerProductService.submitForReview(token, res.data.id);
          showToast('success', 'Product submitted for review. Your SKU mapping will go live after admin approval.');
          setTimeout(() => router.push('/dashboard/products'), 800);
        } catch (submitErr) {
          // The product WAS created as a draft, but submit-for-review failed
          // (e.g. a variant product with no variants yet). Be honest — show the
          // real reason instead of a green "success", and route the seller to
          // the draft's edit page where they can fix it and resubmit.
          const reason = submitErr instanceof ApiError ? submitErr.message : 'Submit for review failed.';
          showToast('error', `Saved as draft, but not submitted: ${reason}`);
          setTimeout(() => router.push(`/dashboard/products/${res.data!.id}/edit`), 1500);
        }
      } else {
        showToast('success', 'Product saved as draft.');
        setTimeout(() => router.push('/dashboard/products'), 800);
      }
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
        <div className="form-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="form-card-title">Basic information</div>
            <div className="form-card-subtitle">Name, category, brand, and product descriptions.</div>
          </div>
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
              placeholder="Select a category"
            />
            <datalist id="category-list">
              {categories.map(cat => (
                <option key={cat.id} value={cat.name} />
              ))}
            </datalist>
            <span className="form-hint">Select an existing category</span>
            {errors.category && <span className="form-error">{errors.category}</span>}
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
              placeholder="Select a brand"
            />
            <datalist id="brand-list">
              {brands.map(b => (
                <option key={b.id} value={b.name} />
              ))}
            </datalist>
            <span className="form-hint">Select an existing brand</span>
            {errors.brand && <span className="form-error">{errors.brand}</span>}
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
        <div className="form-card-head">
          <div className="form-card-title">Product type &amp; pricing</div>
          <div className="form-card-subtitle">How this product is sold and priced.</div>
        </div>

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
                  onChange={e => updateField('basePrice', filterAmount(e.target.value))}
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
                  onChange={e => updateField('compareAtPrice', filterAmount(e.target.value))}
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
                  onChange={e => updateField('costPrice', filterAmount(e.target.value))}
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
                onChange={e => updateField('baseStock', filterInteger(e.target.value))}
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
        <div className="form-card-head">
          <div className="form-card-title">Shipping</div>
          <div className="form-card-subtitle">Package weight and dimensions used for delivery.</div>
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Weight</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                className="form-input"
                style={{ flex: 1 }}
                value={form.weight}
                onChange={e => updateField('weight', filterAmount(e.target.value))}
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
                onChange={e => updateField('length', filterAmount(e.target.value))}
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
                onChange={e => updateField('width', filterAmount(e.target.value))}
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
                onChange={e => updateField('height', filterAmount(e.target.value))}
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

      {/* Tax & GST classification is managed by a super-admin per product
          (HSN, GST rate, supply type, cess, UQC) — not editable by sellers. */}

      {/* Section 4: Tags */}
      <div className="form-card">
        <div className="form-card-head">
          <div className="form-card-title">Tags</div>
          <div className="form-card-subtitle">Keywords that help buyers find this product.</div>
        </div>
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
        <div className="form-card-head">
          <div className="form-card-title">Search engine optimization</div>
          <div className="form-card-subtitle">How this product appears in search results.</div>
        </div>
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
        <div className="form-card-head">
          <div className="form-card-title">Policies</div>
          <div className="form-card-subtitle">Returns, warranty, and other buyer-facing policies.</div>
        </div>
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
