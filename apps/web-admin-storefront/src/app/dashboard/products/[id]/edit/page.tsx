'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient, ApiError } from '@/lib/api-client';
import RichTextEditor from '@/components/RichTextEditor';

interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  status: string;
  moderationStatus: string;
  hasVariants: boolean;
  basePrice: string | null;
  compareAtPrice: string | null;
  costPrice: string | null;
  baseSku: string | null;
  baseStock: number | null;
  baseBarcode: string | null;
  weight: string | null;
  weightUnit: string | null;
  length: string | null;
  width: string | null;
  height: string | null;
  dimensionUnit: string | null;
  returnPolicy: string | null;
  warrantyInfo: string | null;
  categoryId: string | null;
  brandId: string | null;
  seller: { id: string; sellerName: string; sellerShopName: string; email: string } | null;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  tags: { id: string; tag: string }[];
  seo: { metaTitle: string | null; metaDescription: string | null; handle: string | null } | null;
  images: { id: string; url: string; sortOrder: number; isPrimary: boolean }[];
  variants: any[];
}

const thStyle: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontWeight: 500, color: '#616161', fontSize: 13, borderBottom: '1px solid #e3e3e3' };

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [product, setProduct] = useState<ProductDetail | null>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandName, setBrandName] = useState('');
  const [brandId, setBrandId] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [baseSku, setBaseSku] = useState('');
  const [baseStock, setBaseStock] = useState('');
  const [baseBarcode, setBaseBarcode] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState('kg');
  const [pLength, setPLength] = useState('');
  const [pWidth, setPWidth] = useState('');
  const [pHeight, setPHeight] = useState('');
  const [dimensionUnit, setDimensionUnit] = useState('cm');
  const [returnPolicy, setReturnPolicy] = useState('');
  const [warrantyInfo, setWarrantyInfo] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [handle, setHandle] = useState('');

  // AI generation
  const [aiGenerating, setAiGenerating] = useState(false);
  const generateWithAI = useCallback(async () => {
    if (!title.trim()) return;
    setAiGenerating(true);
    try {
      const token = typeof window !== 'undefined' ? sessionStorage.getItem('adminAccessToken') : null;
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      const res = await fetch(`${API_BASE}/api/v1/ai/generate-product-content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title, category: categoryName, brand: brandName, shortDescription }),
      });
      const json = await res.json();
      if (json.data) {
        setDescription(json.data.description || '');
        setHandle(json.data.slug || '');
        setMetaTitle(json.data.metaTitle || '');
        setMetaDescription(json.data.metaDescription || '');
      }
    } catch { /* */ }
    finally { setAiGenerating(false); }
  }, [title, categoryName, brandName, shortDescription]);

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
    setPLength(p.length || '');
    setPWidth(p.width || '');
    setPHeight(p.height || '');
    setDimensionUnit(p.dimensionUnit || 'cm');
    setReturnPolicy(p.returnPolicy || '');
    setWarrantyInfo(p.warrantyInfo || '');
    setTags(p.tags ? p.tags.map(t => t.tag) : []);
    setMetaTitle(p.seo?.metaTitle || '');
    setMetaDescription(p.seo?.metaDescription || '');
    setHandle(p.seo?.handle || '');
  }, []);

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient<ProductDetail>(`/admin/products/${productId}`);
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

  useEffect(() => { loadProduct(); }, [loadProduct]);

  // Tag helpers
  const addTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput('');
  };
  const removeTag = (tag: string) => setTags(tags.filter(t => t !== tag));
  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
  };

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Product title is required.'); return; }

    setSubmitting(true);
    setError('');
    setSuccess('');

    const payload: Record<string, unknown> = { title: title.trim() };
    payload.shortDescription = shortDescription.trim() || null;
    payload.description = description.trim() || null;
    if (categoryId) payload.categoryId = categoryId;
    else if (categoryName.trim()) payload.categoryName = categoryName.trim();
    if (brandId) payload.brandId = brandId;
    else if (brandName.trim()) payload.brandName = brandName.trim();
    if (basePrice) payload.basePrice = parseFloat(basePrice);
    if (compareAtPrice) payload.compareAtPrice = parseFloat(compareAtPrice); else payload.compareAtPrice = null;
    if (costPrice) payload.costPrice = parseFloat(costPrice); else payload.costPrice = null;
    payload.baseSku = baseSku.trim() || null;
    if (baseStock !== '') payload.baseStock = parseInt(baseStock, 10);
    payload.baseBarcode = baseBarcode.trim() || null;
    if (weight) payload.weight = parseFloat(weight); else payload.weight = null;
    payload.weightUnit = weightUnit || null;
    if (pLength) payload.length = parseFloat(pLength); else payload.length = null;
    if (pWidth) payload.width = parseFloat(pWidth); else payload.width = null;
    if (pHeight) payload.height = parseFloat(pHeight); else payload.height = null;
    payload.dimensionUnit = dimensionUnit || null;
    payload.returnPolicy = returnPolicy.trim() || null;
    payload.warrantyInfo = warrantyInfo.trim() || null;
    payload.tags = tags;
    payload.seo = {
      metaTitle: metaTitle.trim() || null,
      metaDescription: metaDescription.trim() || null,
      handle: handle.trim() || null,
    };

    try {
      const res = await apiClient<ProductDetail>(`/admin/products/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      if (res.data) {
        setProduct(res.data);
        populateForm(res.data);
        setSuccess('Product updated successfully.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { router.replace('/login'); return; }
      setError(err instanceof ApiError ? err.message : 'Failed to update product');
    } finally {
      setSubmitting(false);
    }
  };

  const formatPrice = (price: string | null) => {
    if (!price) return '--';
    const num = parseFloat(price);
    if (isNaN(num)) return price;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  };

  // Styles
  const sectionStyle: React.CSSProperties = { background: '#fff', border: '1px solid #e3e3e3', borderRadius: 10, padding: '20px 24px', marginBottom: 16 };
  const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginBottom: 16 };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 8, outline: 'none', boxSizing: 'border-box' };
  const textareaStyle: React.CSSProperties = { ...inputStyle, minHeight: 80, resize: 'vertical' as const };
  const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 };
  const groupStyle: React.CSSProperties = { marginBottom: 16 };

  if (loading) {
    return <div className="placeholder-page"><p>Loading product...</p></div>;
  }

  if (!product) {
    return (
      <div className="placeholder-page">
        <p style={{ color: '#dc2626' }}>{error || 'Product not found.'}</p>
        <Link href="/dashboard/products" style={{ color: '#008060', fontSize: 14 }}>← Back to Products</Link>
      </div>
    );
  }

  return (
    <div className="placeholder-page" style={{ maxWidth: 900 }}>
      <Link href="/dashboard/products" style={{ color: '#008060', fontSize: 14, textDecoration: 'none', display: 'inline-block', marginBottom: 16 }}>
        ← Back to Products
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Edit Product</h1>
        <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: 12, fontWeight: 500, borderRadius: 20, background: '#16a34a15', color: '#16a34a' }}>
          {product.status}
        </span>
      </div>

      {error && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{error}</div>}
      {success && <div style={{ background: '#dcfce7', color: '#15803d', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{success}</div>}

      {/* Seller info */}
      {product.seller && (
        <div style={{ ...sectionStyle, padding: '12px 24px', background: '#f9fafb' }}>
          <span style={{ fontSize: 13, color: '#616161' }}>Seller: </span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{product.seller.sellerName} ({product.seller.sellerShopName})</span>
          <span style={{ fontSize: 13, color: '#616161' }}> — {product.seller.email}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Basic Info */}
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={sectionTitle}>Basic Information</div>
            <button type="button" onClick={generateWithAI} disabled={aiGenerating || !title.trim()}
              style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: aiGenerating ? '#e5e7eb' : 'linear-gradient(135deg, #8b5cf6, #6366f1)', color: aiGenerating ? '#6b7280' : '#fff', border: 'none', borderRadius: 8, cursor: aiGenerating ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {aiGenerating ? 'Generating...' : '\u2728 Generate with AI'}
            </button>
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Product Title *</label>
            <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} required />
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Short Description</label>
            <textarea style={{ ...textareaStyle, minHeight: 60 }} value={shortDescription} onChange={e => setShortDescription(e.target.value)} />
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Full Description</label>
            <RichTextEditor value={description} onChange={setDescription} placeholder="Enter product description..." minHeight={200} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={groupStyle}>
              <label style={labelStyle}>Category</label>
              <input style={inputStyle} value={categoryName} onChange={e => { setCategoryName(e.target.value); setCategoryId(''); }} placeholder="Type category name" />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Brand</label>
              <input style={inputStyle} value={brandName} onChange={e => { setBrandName(e.target.value); setBrandId(''); }} placeholder="Type brand name" />
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>Pricing & Stock</div>
          <div style={rowStyle}>
            <div style={groupStyle}>
              <label style={labelStyle}>Base Price</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={basePrice} onChange={e => setBasePrice(e.target.value)} />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Compare At Price</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={compareAtPrice} onChange={e => setCompareAtPrice(e.target.value)} />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Cost Price</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={costPrice} onChange={e => setCostPrice(e.target.value)} />
            </div>
          </div>
          <div style={rowStyle}>
            <div style={groupStyle}>
              <label style={labelStyle}>SKU</label>
              <input style={inputStyle} value={baseSku} onChange={e => setBaseSku(e.target.value)} />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Stock</label>
              <input style={inputStyle} type="number" min="0" value={baseStock} onChange={e => setBaseStock(e.target.value)} />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Barcode</label>
              <input style={inputStyle} value={baseBarcode} onChange={e => setBaseBarcode(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Shipping */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>Shipping</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={groupStyle}>
              <label style={labelStyle}>Weight</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Weight Unit</label>
              <select style={inputStyle} value={weightUnit} onChange={e => setWeightUnit(e.target.value)}>
                <option value="kg">kg</option><option value="g">g</option><option value="lb">lb</option><option value="oz">oz</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
            <div style={groupStyle}>
              <label style={labelStyle}>Length</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={pLength} onChange={e => setPLength(e.target.value)} />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Width</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={pWidth} onChange={e => setPWidth(e.target.value)} />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Height</label>
              <input style={inputStyle} type="number" step="0.01" min="0" value={pHeight} onChange={e => setPHeight(e.target.value)} />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>Unit</label>
              <select style={inputStyle} value={dimensionUnit} onChange={e => setDimensionUnit(e.target.value)}>
                <option value="cm">cm</option><option value="in">in</option><option value="m">m</option>
              </select>
            </div>
          </div>
        </div>

        {/* Variants (read-only) */}
        {product.hasVariants && product.variants && product.variants.length > 0 && (
          <div style={sectionStyle}>
            <div style={sectionTitle}>Variants ({product.variants.length})</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={thStyle}>Variant</th>
                    <th style={thStyle}>SKU</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Price</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants.map((v: any) => {
                    const label = (v.optionValues || [])
                      .map((ov: any) => ov.optionValue?.displayValue || ov.optionValue?.value || '')
                      .filter(Boolean)
                      .join(' / ') || v.title || 'Variant';
                    return (
                      <tr key={v.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{label}</td>
                        <td style={{ padding: '10px 12px', color: '#616161' }}>{v.sku || '--'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{formatPrice(v.price)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{v.stock ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Images (read-only) */}
        {product.images && product.images.length > 0 && (
          <div style={sectionStyle}>
            <div style={sectionTitle}>Images ({product.images.length})</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[...product.images].sort((a, b) => a.sortOrder - b.sortOrder).map((img) => (
                <div key={img.id} style={{ position: 'relative', width: 100, height: 100, borderRadius: 8, overflow: 'hidden', border: img.isPrimary ? '2px solid #008060' : '1px solid #e3e3e3' }}>
                  <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  {img.isPrimary && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#008060', color: '#fff', fontSize: 10, textAlign: 'center', padding: '2px 0', fontWeight: 600 }}>
                      Primary
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: tags.length > 0 ? 12 : 0 }}>
            {tags.map(tag => (
              <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 13, background: '#f3f4f6', borderRadius: 6 }}>
                {tag}
                <button type="button" onClick={() => removeTag(tag)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#9ca3af', lineHeight: 1 }}>&times;</button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={handleTagKeyDown} onBlur={addTag} placeholder="Add tag and press Enter" />
          </div>
        </div>

        {/* SEO */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>SEO</div>
          <div style={groupStyle}>
            <label style={labelStyle}>Meta Title</label>
            <input style={inputStyle} value={metaTitle} onChange={e => setMetaTitle(e.target.value)} placeholder="Page title for search engines" />
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Meta Description</label>
            <textarea style={{ ...textareaStyle, minHeight: 60 }} value={metaDescription} onChange={e => setMetaDescription(e.target.value)} placeholder="Description for search engines" />
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>URL Handle</label>
            <input style={inputStyle} value={handle} onChange={e => setHandle(e.target.value)} placeholder="product-url-slug" />
          </div>
        </div>

        {/* Policy */}
        <div style={sectionStyle}>
          <div style={sectionTitle}>Policy</div>
          <div style={groupStyle}>
            <label style={labelStyle}>Return Policy</label>
            <textarea style={{ ...textareaStyle, minHeight: 60 }} value={returnPolicy} onChange={e => setReturnPolicy(e.target.value)} />
          </div>
          <div style={groupStyle}>
            <label style={labelStyle}>Warranty Information</label>
            <textarea style={{ ...textareaStyle, minHeight: 60 }} value={warrantyInfo} onChange={e => setWarrantyInfo(e.target.value)} />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8, marginBottom: 40 }}>
          <Link href="/dashboard/products" style={{ padding: '10px 20px', fontSize: 14, fontWeight: 500, border: '1px solid #d1d5db', borderRadius: 8, color: '#374151', textDecoration: 'none', display: 'inline-block' }}>
            Cancel
          </Link>
          <button type="submit" disabled={submitting} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 600, background: '#008060', color: '#fff', border: 'none', borderRadius: 8, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
