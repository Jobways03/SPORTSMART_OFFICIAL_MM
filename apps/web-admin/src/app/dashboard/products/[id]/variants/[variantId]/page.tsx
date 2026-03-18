'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { adminProductsService } from '@/services/admin-products.service';
import { ApiError } from '@/lib/api-client';
import '../../../product-form.css';

export default function AdminVariantDetailPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;
  const variantId = params.variantId as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [variant, setVariant] = useState<any>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [compareAtPrice, setCompareAtPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [stock, setStock] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState('g');

  const loadVariant = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Get full product to find this variant
      const res = await adminProductsService.getProduct(productId);
      if (res.data) {
        const v = (res.data as any).variants?.find((v: any) => v.id === variantId);
        if (v) {
          setVariant(v);
          populateForm(v);
        } else {
          setError('Variant not found.');
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load variant.');
    } finally {
      setLoading(false);
    }
  }, [productId, variantId, router]);

  function populateForm(v: any) {
    setTitle(v.title || '');
    setPrice(v.price ?? '');
    setCompareAtPrice(v.compareAtPrice ?? '');
    setCostPrice(v.costPrice ?? '');
    setSku(v.sku || '');
    setBarcode(v.barcode || '');
    setStock(v.stock != null ? String(v.stock) : '');
    setWeight(v.weight ?? '');
    setWeightUnit(v.weightUnit || 'g');
  }

  useEffect(() => {
    loadVariant();
  }, [loadVariant]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    const payload: Record<string, unknown> = {};
    if (title !== (variant?.title || '')) payload.title = title || null;
    payload.price = price ? parseFloat(price) : 0;
    payload.compareAtPrice = compareAtPrice ? parseFloat(compareAtPrice) : null;
    payload.costPrice = costPrice ? parseFloat(costPrice) : null;
    payload.sku = sku.trim() || null;
    payload.barcode = barcode.trim() || null;
    payload.stock = stock ? parseInt(stock, 10) : 0;
    if (weight) payload.weight = parseFloat(weight);
    else payload.weight = null;
    payload.weightUnit = weightUnit;

    try {
      const res = await adminProductsService.updateVariant(productId, variantId, payload);
      if (res.data) {
        setVariant(res.data);
        populateForm(res.data);
      }
      setSuccess('Variant updated successfully.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to update variant.');
    } finally {
      setSaving(false);
    }
  };

  // Build variant label from option values
  const getVariantLabel = () => {
    if (!variant) return '';
    const ovs = (variant.optionValues || []).map((ov: any) => {
      if (ov.optionValue) return ov.optionValue.displayValue || ov.optionValue.value;
      return ov.displayValue || ov.value || '';
    });
    return ovs.join(' / ') || variant.title || 'Variant';
  };

  if (loading) {
    return (
      <div className="product-form-page">
        <div className="product-form-loading">Loading variant...</div>
      </div>
    );
  }

  return (
    <div className="product-form-page">
      <Link href={`/dashboard/products/${productId}/edit`} className="product-form-back">
        &#8592; Back to Product
      </Link>

      <div className="product-form-header">
        <h1>Edit Variant</h1>
      </div>

      {error && <div className="product-form-alert error">{error}</div>}
      {success && <div className="product-form-alert success">{success}</div>}

      {/* Variant Info (option values - read only) */}
      {variant && variant.optionValues && variant.optionValues.length > 0 && (
        <div className="product-form-section">
          <h2>Variant Info</h2>
          <div className="option-chips" style={{ marginBottom: 0 }}>
            {variant.optionValues.map((ov: any, i: number) => {
              const label = ov.optionValue
                ? `${ov.optionValue.optionDefinition?.name || 'Option'}: ${ov.optionValue.displayValue || ov.optionValue.value}`
                : `${ov.optionName || 'Option'}: ${ov.displayValue || ov.value}`;
              return <span key={i} className="option-chip">{label}</span>;
            })}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Title (for manual variants) */}
        <div className="product-form-section">
          <h2>Details</h2>
          <div className="form-group">
            <label>Variant Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Optional variant title" />
          </div>
        </div>

        {/* Pricing */}
        <div className="product-form-section">
          <h2>Pricing</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Price</label>
              <input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Compare At Price</label>
              <input type="number" step="0.01" min="0" value={compareAtPrice} onChange={e => setCompareAtPrice(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Cost Price</label>
              <input type="number" step="0.01" min="0" value={costPrice} onChange={e => setCostPrice(e.target.value)} placeholder="0.00" />
            </div>
          </div>
        </div>

        {/* Inventory */}
        <div className="product-form-section">
          <h2>Inventory</h2>
          <div className="form-row">
            <div className="form-group">
              <label>SKU</label>
              <input type="text" value={sku} onChange={e => setSku(e.target.value)} placeholder="Stock Keeping Unit" />
            </div>
            <div className="form-group">
              <label>Barcode</label>
              <input type="text" value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="UPC, EAN, etc." />
            </div>
            <div className="form-group">
              <label>Stock</label>
              <input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} placeholder="0" />
            </div>
          </div>
        </div>

        {/* Shipping */}
        <div className="product-form-section">
          <h2>Shipping</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Weight</label>
              <input type="number" step="0.01" min="0" value={weight} onChange={e => setWeight(e.target.value)} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Weight Unit</label>
              <select value={weightUnit} onChange={e => setWeightUnit(e.target.value)}>
                <option value="g">g</option>
                <option value="kg">kg</option>
                <option value="lb">lb</option>
                <option value="oz">oz</option>
              </select>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="product-form-actions">
          <Link href={`/dashboard/products/${productId}/edit`} className="product-form-btn" style={{ textDecoration: 'none' }}>
            Cancel
          </Link>
          <button type="submit" className="product-form-btn product-form-btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
