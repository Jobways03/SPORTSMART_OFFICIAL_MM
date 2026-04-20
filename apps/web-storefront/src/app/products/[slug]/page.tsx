'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { apiClient } from '@/lib/api-client';
import { sanitizeProductHtml } from '@/lib/sanitize';

interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
}

interface OptionValue {
  optionName: string;
  optionType: string;
  value: string;
  displayValue: string;
  // Legacy nested format (fallback)
  optionValue?: {
    id: string;
    value: string;
    optionDefinition: {
      id: string;
      name: string;
    };
  };
}

interface Variant {
  id: string;
  masterSku: string;
  title: string;
  platformPrice: number | null;
  price: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  sku: string;
  totalAvailableStock: number;
  totalStock: number;
  stock: number;
  inStock: boolean;
  weight: number | null;
  optionValues: OptionValue[];
  images: ProductImage[];
}

interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  productCode: string | null;
  shortDescription: string | null;
  description: string | null;
  platformPrice: number | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  hasVariants: boolean;
  totalStock: number;
  totalAvailableStock: number;
  baseStock: number | null;
  inStock: boolean;
  baseSku: string | null;
  weight: number | null;
  weightUnit: string | null;
  dimensions: {
    length?: number | null;
    width?: number | null;
    height?: number | null;
    unit?: string | null;
  } | null;
  returnPolicy: string | null;
  warrantyInfo: string | null;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  images: ProductImage[];
  variants: Variant[];
  tags: { tag: string }[];
}

export default function ProductDetailPage() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [addingToCart, setAddingToCart] = useState(false);
  const [cartMessage, setCartMessage] = useState('');

  // Pincode checker state
  const [pincode, setPincode] = useState('');
  const [pincodeChecking, setPincodeChecking] = useState(false);
  const [pincodeResult, setPincodeResult] = useState<{
    serviceable: boolean;
    estimatedDays?: { min: number; max: number };
    message?: string;
  } | null>(null);
  const [pincodeError, setPincodeError] = useState('');

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    apiClient<ProductDetail>(`/storefront/products/${slug}`)
      .then((res) => {
        if (res.data) {
          setProduct(res.data);
          if (res.data.hasVariants && res.data.variants.length > 0) {
            setSelectedVariant(res.data.variants[0]);
          }
        }
      })
      .catch(() => setError('Product not found'))
      .finally(() => setLoading(false));
  }, [slug]);

  // Reset image index when variant changes
  useEffect(() => {
    setSelectedImage(0);
  }, [selectedVariant]);

  // Restore last checked pincode from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('lastCheckedPincode');
      if (saved && /^\d{6}$/.test(saved)) {
        setPincode(saved);
      }
    } catch {
      // Storage unavailable
    }
  }, []);

  const formatPrice = (price: number | null | undefined) => {
    if (price == null) return '--';
    return `\u20B9${Number(price).toLocaleString('en-IN')}`;
  };

  const getDiscount = (price: number | null | undefined, compare: number | null | undefined) => {
    if (!price || !compare || compare <= price) return null;
    return Math.round(((compare - price) / compare) * 100);
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading product...</span>
        </div>
      </>
    );
  }

  if (error || !product) {
    return (
      <>
        <Navbar />
        <div className="products-empty">
          <h3>Product not found</h3>
          <p>This product may no longer be available.</p>
          <Link href="/" style={{ marginTop: 16, display: 'inline-block' }}>Back to Shop</Link>
        </div>
      </>
    );
  }

  // Use platformPrice where available, fallback to basePrice
  const getVariantPrice = (v: Variant): number => {
    return v.platformPrice ?? v.price;
  };
  const getVariantStock = (v: Variant): number => {
    return v.totalAvailableStock ?? v.totalStock ?? v.stock ?? 0;
  };

  const currentPrice = selectedVariant
    ? getVariantPrice(selectedVariant)
    : (product.platformPrice ?? product.basePrice);
  const currentCompare = selectedVariant ? selectedVariant.compareAtPrice : product.compareAtPrice;
  const discount = getDiscount(currentPrice, currentCompare);
  const currentStock = selectedVariant
    ? getVariantStock(selectedVariant)
    : (product.totalAvailableStock ?? product.totalStock ?? product.baseStock ?? 0);
  const currentSku = selectedVariant ? (selectedVariant.masterSku || selectedVariant.sku) : product.baseSku;
  const isInStock = selectedVariant
    ? (selectedVariant.inStock ?? currentStock > 0)
    : (product.inStock ?? currentStock > 0);

  // Group variant option values by option name
  const optionGroups: Record<string, { name: string; values: { id: string; value: string }[] }> = {};
  if (product.hasVariants) {
    for (const variant of product.variants) {
      for (const ov of variant.optionValues) {
        // Support flat format from storefront API: { optionName, value, displayValue }
        const optName = ov.optionName || ov.optionValue?.optionDefinition?.name;
        const optVal = ov.displayValue || ov.value || ov.optionValue?.value;
        const optId = ov.optionValue?.id || `${optName}-${optVal}`;
        if (!optName || !optVal) continue;
        if (!optionGroups[optName]) {
          optionGroups[optName] = { name: optName, values: [] };
        }
        const exists = optionGroups[optName].values.some(v => v.id === optId);
        if (!exists) {
          optionGroups[optName].values.push({ id: optId, value: optVal });
        }
      }
    }
  }

  // Determine if an option is Color (for rendering color chips)
  const isColorOption = (name: string) => {
    return /color|colour/i.test(name);
  };

  // Map common color names to hex
  const colorMap: Record<string, string> = {
    red: '#dc2626', blue: '#2563eb', green: '#16a34a', black: '#111827',
    white: '#ffffff', yellow: '#eab308', orange: '#ea580c', purple: '#9333ea',
    pink: '#ec4899', grey: '#6b7280', gray: '#6b7280', navy: '#1e3a5f',
    brown: '#92400e', beige: '#d4a574', maroon: '#800000', teal: '#0d9488',
    cyan: '#06b6d4', indigo: '#4f46e5', lime: '#84cc16', gold: '#d97706',
    silver: '#94a3b8', coral: '#f97316', salmon: '#f87171', olive: '#65a30d',
  };

  const getColorHex = (value: string): string | null => {
    const lower = value.toLowerCase().trim();
    // Check exact match
    if (colorMap[lower]) return colorMap[lower];
    // Check if the value contains a color name
    for (const [name, hex] of Object.entries(colorMap)) {
      if (lower.includes(name)) return hex;
    }
    // Check if it's a hex code
    if (/^#[0-9a-f]{3,6}$/i.test(lower)) return lower;
    return null;
  };

  const handleAddToCart = async (buyNow = false) => {
    try {
      const token = sessionStorage.getItem('accessToken');
      if (!token) {
        router.push('/login');
        return;
      }
    } catch {
      router.push('/login');
      return;
    }
    setAddingToCart(true);
    setCartMessage('');
    try {
      await apiClient('/customer/cart/items', {
        method: 'POST',
        body: JSON.stringify({
          productId: product.id,
          variantId: selectedVariant?.id || undefined,
          quantity: 1,
        }),
      });
      window.dispatchEvent(new Event('cart-updated'));
      if (buyNow) {
        router.push('/cart');
      } else {
        setCartMessage('Added to cart!');
        setTimeout(() => setCartMessage(''), 2000);
      }
    } catch (err: any) {
      setCartMessage(err?.message || 'Failed to add to cart');
    } finally {
      setAddingToCart(false);
    }
  };

  const handleCheckPincode = async () => {
    if (!/^\d{6}$/.test(pincode)) {
      setPincodeError('Please enter a valid 6-digit pincode');
      setPincodeResult(null);
      return;
    }
    setPincodeError('');
    setPincodeResult(null);
    setPincodeChecking(true);

    // Save to sessionStorage
    try {
      sessionStorage.setItem('lastCheckedPincode', pincode);
    } catch {
      // Storage unavailable
    }

    try {
      const params = new URLSearchParams({
        productId: product.id,
        pincode,
      });
      if (selectedVariant) {
        params.set('variantId', selectedVariant.id);
      }
      const body = await apiClient<any>(
        `/storefront/serviceability/check?${params}`,
      );
      if (body.data) {
        setPincodeResult({
          serviceable: body.data.serviceable,
          estimatedDays: body.data.estimatedDays,
          message: body.data.message,
        });
      } else {
        setPincodeResult({
          serviceable: false,
          message: body.message || 'Unable to check serviceability',
        });
      }
    } catch (err: any) {
      setPincodeError(err?.message || 'Failed to check delivery availability');
    } finally {
      setPincodeChecking(false);
    }
  };

  // Collect images: if a variant is selected and has images, show those;
  // otherwise show product-level images, then fall back to all variant images
  const selectedVariantImages = selectedVariant?.images?.length ? selectedVariant.images : null;
  const allVariantImages = (product.variants || [])
    .flatMap(v => v.images || [])
    .filter((img, idx, arr) => arr.findIndex(i => i.url === img.url) === idx);
  const images = selectedVariantImages
    ? selectedVariantImages
    : product.images.length > 0
      ? product.images
      : allVariantImages.length > 0
        ? allVariantImages
        : null;

  // Build dimensions string
  const getDimensionsString = () => {
    if (!product.dimensions) return null;
    const { length, width, height, unit } = product.dimensions;
    const parts: string[] = [];
    if (length) parts.push(`L: ${length}`);
    if (width) parts.push(`W: ${width}`);
    if (height) parts.push(`H: ${height}`);
    if (parts.length === 0) return null;
    return parts.join(' x ') + (unit ? ` ${unit}` : ' cm');
  };

  return (
    <>
      <Navbar />
      <div className="product-detail">
        <Link href="/" className="product-detail-back">
          &#8592; Back to Shop
        </Link>

        <div className="product-detail-grid">
          {/* Images */}
          <div className="product-detail-images">
            <div className="product-detail-main-image">
              {images ? (
                <img
                  src={images[selectedImage]?.url}
                  alt={images[selectedImage]?.altText || product.title}
                />
              ) : (
                <span style={{ fontSize: 80, color: '#d1d5db' }}>&#128722;</span>
              )}
            </div>
            {images && images.length > 1 && (
              <div className="product-detail-thumbs">
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className={`product-detail-thumb${idx === selectedImage ? ' active' : ''}`}
                    onClick={() => setSelectedImage(idx)}
                  >
                    <img src={img.url} alt={img.altText || product.title} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="product-detail-info">
            <h1>{product.title}</h1>

            {/* Product Code */}
            {product.productCode && (
              <div className="product-detail-code">
                Product Code: {product.productCode}
              </div>
            )}

            <div className="product-detail-meta">
              {product.brand && <span>{product.brand.name}</span>}
              {product.brand && product.category && <span className="dot">|</span>}
              {product.category && <span>{product.category.name}</span>}
            </div>

            {/* Fulfillment label - T7 & T8: Replace seller info */}
            <div className="fulfillment-label">
              <span className="fulfillment-icon">&#9989;</span>
              Fulfilled by SPORTSMART Partner Network
            </div>

            <div className="product-detail-price">
              <span className="current">{formatPrice(currentPrice)}</span>
              {currentCompare && Number(currentCompare) > Number(currentPrice) && (
                <span className="compare">{formatPrice(currentCompare)}</span>
              )}
              {discount && (
                <span className="discount">{discount}% off</span>
              )}
            </div>

            {/* Stock indicator */}
            <div className={`stock-indicator ${isInStock ? 'in-stock' : 'out-of-stock'}`}>
              <span className="stock-dot"></span>
              {isInStock
                ? currentStock <= 5
                  ? `In Stock (Only ${currentStock} left!)`
                  : 'In Stock'
                : 'Out of Stock'
              }
            </div>

            {/* Variant Options - moved above cart buttons */}
            {Object.keys(optionGroups).length > 0 && (
              <div className="product-detail-variants">
                {Object.entries(optionGroups).map(([key, group]) => (
                  <div key={key} className="variant-group">
                    <h3>{group.name}</h3>
                    <div className="variant-options">
                      {group.values.map((val) => {
                        // Helper: get option identifier from an ov entry (supports flat + nested)
                        const getOvId = (ov: OptionValue) => ov.optionValue?.id || `${ov.optionName}-${ov.displayValue || ov.value}`;
                        const getOvName = (ov: OptionValue) => ov.optionName || ov.optionValue?.optionDefinition?.name || '';
                        const ovMatchesVal = (ov: OptionValue) => getOvId(ov) === val.id;

                        const isSelected = selectedVariant?.optionValues.some(ovMatchesVal);
                        const colorHex = isColorOption(group.name) ? getColorHex(val.value) : null;

                        const hasStock = product.variants.some(v =>
                          v.optionValues.some(ovMatchesVal) &&
                          getVariantStock(v) > 0
                        );

                        const selectVariant = () => {
                          const otherSelectedIds: string[] = [];
                          if (selectedVariant) {
                            for (const ov of selectedVariant.optionValues) {
                              if (getOvName(ov) !== group.name) {
                                otherSelectedIds.push(getOvId(ov));
                              }
                            }
                          }
                          const match = product.variants.find(v =>
                            v.optionValues.some(ovMatchesVal) &&
                            otherSelectedIds.every(otherId =>
                              v.optionValues.some(ov2 => getOvId(ov2) === otherId)
                            )
                          ) || product.variants.find(v =>
                            v.optionValues.some(ovMatchesVal)
                          );
                          if (match) setSelectedVariant(match);
                        };

                        if (colorHex) {
                          return (
                            <button
                              key={val.id}
                              className={`variant-color-chip${isSelected ? ' selected' : ''}${!hasStock ? ' out-of-stock' : ''}`}
                              title={val.value}
                              onClick={selectVariant}
                            >
                              <span
                                className="color-swatch"
                                style={{
                                  backgroundColor: colorHex,
                                  border: colorHex === '#ffffff' ? '1px solid #d1d5db' : 'none',
                                }}
                              />
                              <span className="color-label">{val.value}</span>
                            </button>
                          );
                        }

                        return (
                          <button
                            key={val.id}
                            className={`variant-option-btn${isSelected ? ' selected' : ''}${!hasStock ? ' out-of-stock' : ''}`}
                            onClick={selectVariant}
                          >
                            {val.value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add to Cart / Buy Now */}
            <div className="product-detail-actions">
              <button
                className="btn-add-to-cart"
                onClick={() => handleAddToCart(false)}
                disabled={addingToCart || !isInStock}
              >
                {!isInStock ? 'Out of Stock' : addingToCart ? 'Adding...' : 'Add to Cart'}
              </button>
              {isInStock && (
                <button
                  className="btn-buy-now"
                  onClick={() => handleAddToCart(true)}
                  disabled={addingToCart}
                >
                  Buy Now
                </button>
              )}
            </div>
            {cartMessage && (
              <div className={`cart-message ${cartMessage.includes('Added') ? 'success' : 'error'}`}>
                {cartMessage}
              </div>
            )}

            {/* Tags */}
            {product.tags.length > 0 && (
              <div className="product-detail-tags">
                {product.tags.map((t, idx) => (
                  <span key={`${t.tag}-${idx}`} className="product-tag">{t.tag}</span>
                ))}
              </div>
            )}

            {/* Description */}
            {(product.shortDescription || product.description) && (
              <div className="product-detail-description">
                <h3>Description</h3>
                {product.description ? (
                  <div
                    className="description-content"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeProductHtml(product.description),
                    }}
                  />
                ) : (
                  <p>{product.shortDescription}</p>
                )}
              </div>
            )}

            {/* Product Details Table */}
            <div className="product-detail-specs">
              <h3>Product Details</h3>
              <table className="specs-table">
                <tbody>
                  {product.brand && (
                    <tr><td>Brand</td><td>{product.brand.name}</td></tr>
                  )}
                  {product.category && (
                    <tr><td>Category</td><td>{product.category.name}</td></tr>
                  )}
                  {product.productCode && (
                    <tr><td>Product Code</td><td>{product.productCode}</td></tr>
                  )}
                  {currentSku && (
                    <tr><td>SKU</td><td>{currentSku}</td></tr>
                  )}
                  {product.weight && (
                    <tr><td>Weight</td><td>{Number(product.weight)} {product.weightUnit || 'kg'}</td></tr>
                  )}
                  {getDimensionsString() && (
                    <tr><td>Dimensions</td><td>{getDimensionsString()}</td></tr>
                  )}
                  {product.returnPolicy && (
                    <tr><td>Return Policy</td><td>{product.returnPolicy}</td></tr>
                  )}
                  {product.warrantyInfo && (
                    <tr><td>Warranty</td><td>{product.warrantyInfo}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
