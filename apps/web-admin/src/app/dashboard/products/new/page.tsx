'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import '../product-form.css';
import RichTextEditor from '@/components/RichTextEditor';

interface CategoryOption {
  id: string;
  name: string;
}

interface BrandOption {
  id: string;
  name: string;
}

export default function CreateProductPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Categories & Brands
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [brands, setBrands] = useState<BrandOption[]>([]);

  // Form fields
  const [sellerEmail, setSellerEmail] = useState('');
  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryName, setCategoryName] = useState('');
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
      // Silently fail, dropdowns will be empty
    }
  }, []);

  useEffect(() => {
    loadCatalogData();
  }, [loadCatalogData]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sellerEmail.trim()) {
      setError('Seller email is required.');
      return;
    }
    if (!title.trim()) {
      setError('Product title is required.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    const payload: Record<string, unknown> = {
      sellerEmail: sellerEmail.trim(),
      title: title.trim(),
    };

    if (shortDescription.trim()) payload.shortDescription = shortDescription.trim();
    if (description.trim()) payload.description = description.trim();
    if (categoryId) payload.categoryId = categoryId;
    else if (categoryName.trim()) payload.categoryName = categoryName.trim();
    if (brandId) payload.brandId = brandId;
    else if (brandName.trim()) payload.brandName = brandName.trim();
    if (basePrice) payload.basePrice = parseFloat(basePrice);
    if (compareAtPrice) payload.compareAtPrice = parseFloat(compareAtPrice);
    if (costPrice) payload.costPrice = parseFloat(costPrice);
    if (baseSku.trim()) payload.baseSku = baseSku.trim();
    if (baseStock) payload.baseStock = parseInt(baseStock, 10);
    if (baseBarcode.trim()) payload.baseBarcode = baseBarcode.trim();
    if (weight) payload.weight = parseFloat(weight);
    if (weightUnit) payload.weightUnit = weightUnit;
    if (length) payload.length = parseFloat(length);
    if (width) payload.width = parseFloat(width);
    if (height) payload.height = parseFloat(height);
    if (dimensionUnit) payload.dimensionUnit = dimensionUnit;
    if (returnPolicy.trim()) payload.returnPolicy = returnPolicy.trim();
    if (warrantyInfo.trim()) payload.warrantyInfo = warrantyInfo.trim();
    if (tags.length > 0) payload.tags = tags;

    const seo: Record<string, string> = {};
    if (metaTitle.trim()) seo.metaTitle = metaTitle.trim();
    if (metaDescription.trim()) seo.metaDescription = metaDescription.trim();
    if (handle.trim()) seo.handle = handle.trim();
    if (Object.keys(seo).length > 0) payload.seo = seo;

    try {
      const res = await adminProductsService.createProduct(payload);
      if (res.data) {
        setSuccess('Product created successfully.');
        setTimeout(() => {
          router.push(`/dashboard/products/${res.data!.id}/edit`);
        }, 1000);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to create product');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="product-form-page">
      <Link href="/dashboard/products" className="product-form-back">
        &#8592; Back to Products
      </Link>

      <div className="product-form-header">
        <h1>Create Product</h1>
      </div>

      {error && <div className="product-form-alert error">{error}</div>}
      {success && <div className="product-form-alert success">{success}</div>}

      <form onSubmit={handleSubmit}>
        {/* Seller Email */}
        <div className="product-form-section">
          <h2>Seller</h2>
          <div className="form-group">
            <label>Seller Email <span className="required">*</span></label>
            <input
              type="email"
              placeholder="seller@example.com"
              value={sellerEmail}
              onChange={e => setSellerEmail(e.target.value)}
              required
            />
            <div className="field-hint">The product will be created under this seller&apos;s account.</div>
          </div>
        </div>

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
            {submitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
