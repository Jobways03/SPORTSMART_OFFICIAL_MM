'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { apiClient } from '@/lib/api-client';

interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
}

interface OptionValue {
  optionValue: {
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
  price: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  sku: string;
  stock: number;
  weight: number | null;
  optionValues: OptionValue[];
  images: ProductImage[];
}

interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  hasVariants: boolean;
  baseStock: number | null;
  baseSku: string | null;
  weight: number | null;
  weightUnit: string | null;
  returnPolicy: string | null;
  warrantyInfo: string | null;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  seller: { sellerShopName: string } | null;
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

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    apiClient<ProductDetail>(`/catalog/products/${slug}`)
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

  const formatPrice = (price: number | null | undefined) => {
    if (price == null) return '--';
    return `₹${Number(price).toLocaleString('en-IN')}`;
  };

  const getDiscount = (price: number | null | undefined, compare: number | null | undefined) => {
    if (!price || !compare || compare <= price) return null;
    return Math.round(((compare - price) / compare) * 100);
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="products-loading">Loading product...</div>
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

  const currentPrice = selectedVariant ? selectedVariant.price : product.basePrice;
  const currentCompare = selectedVariant ? selectedVariant.compareAtPrice : product.compareAtPrice;
  const discount = getDiscount(currentPrice, currentCompare);
  const currentStock = selectedVariant ? selectedVariant.stock : (product.baseStock ?? 0);
  const currentSku = selectedVariant ? selectedVariant.sku : product.baseSku;

  // Group variant option values by option name
  const optionGroups: Record<string, { name: string; values: { id: string; value: string }[] }> = {};
  if (product.hasVariants) {
    for (const variant of product.variants) {
      for (const ov of variant.optionValues) {
        const optName = ov.optionValue.optionDefinition.name;
        if (!optionGroups[optName]) {
          optionGroups[optName] = { name: optName, values: [] };
        }
        const exists = optionGroups[optName].values.some(v => v.id === ov.optionValue.id);
        if (!exists) {
          optionGroups[optName].values.push({ id: ov.optionValue.id, value: ov.optionValue.value });
        }
      }
    }
  }

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

  const images = product.images.length > 0 ? product.images : null;

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

            <div className="product-detail-meta">
              {product.brand && <span>{product.brand.name}</span>}
              {product.brand && product.category && <span className="dot">|</span>}
              {product.category && <span>{product.category.name}</span>}
              {product.seller && (
                <>
                  <span className="dot">|</span>
                  <span>Sold by {product.seller.sellerShopName}</span>
                </>
              )}
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

            {currentStock > 0 ? (
              <div style={{ fontSize: 13, color: '#16a34a', fontWeight: 500, marginBottom: 12 }}>
                In Stock {currentStock <= 5 && `(Only ${currentStock} left)`}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#dc2626', fontWeight: 500, marginBottom: 12 }}>
                Out of Stock
              </div>
            )}

            {currentStock > 0 && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <button
                  onClick={() => handleAddToCart(false)}
                  disabled={addingToCart}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    fontSize: 14,
                    fontWeight: 600,
                    border: '2px solid #111',
                    background: '#fff',
                    color: '#111',
                    borderRadius: 8,
                    cursor: addingToCart ? 'not-allowed' : 'pointer',
                    opacity: addingToCart ? 0.6 : 1,
                  }}
                >
                  {addingToCart ? 'Adding...' : 'Add to Cart'}
                </button>
                <button
                  onClick={() => handleAddToCart(true)}
                  disabled={addingToCart}
                  style={{
                    flex: 1,
                    padding: '12px 20px',
                    fontSize: 14,
                    fontWeight: 600,
                    border: 'none',
                    background: '#111',
                    color: '#fff',
                    borderRadius: 8,
                    cursor: addingToCart ? 'not-allowed' : 'pointer',
                    opacity: addingToCart ? 0.6 : 1,
                  }}
                >
                  Buy Now
                </button>
              </div>
            )}
            {cartMessage && (
              <div style={{
                fontSize: 13,
                color: cartMessage.includes('Added') ? '#16a34a' : '#dc2626',
                fontWeight: 500,
                marginBottom: 12,
              }}>
                {cartMessage}
              </div>
            )}

            {/* Variant Options */}
            {Object.keys(optionGroups).length > 0 && (
              <div className="product-detail-variants">
                {Object.entries(optionGroups).map(([key, group]) => (
                  <div key={key} style={{ marginBottom: 14 }}>
                    <h3>{group.name}</h3>
                    <div className="variant-options">
                      {group.values.map((val) => {
                        const isSelected = selectedVariant?.optionValues.some(
                          ov => ov.optionValue.id === val.id
                        );
                        return (
                          <button
                            key={val.id}
                            className={`variant-option-btn${isSelected ? ' selected' : ''}`}
                            onClick={() => {
                              // Keep selected values from OTHER option groups
                              const otherSelectedIds: string[] = [];
                              if (selectedVariant) {
                                for (const ov of selectedVariant.optionValues) {
                                  if (ov.optionValue.optionDefinition.name !== group.name) {
                                    otherSelectedIds.push(ov.optionValue.id);
                                  }
                                }
                              }
                              // Find variant matching clicked value + other selected values
                              const match = product.variants.find(v =>
                                v.optionValues.some(ov => ov.optionValue.id === val.id) &&
                                otherSelectedIds.every(otherId =>
                                  v.optionValues.some(ov => ov.optionValue.id === otherId)
                                )
                              ) || product.variants.find(v =>
                                v.optionValues.some(ov => ov.optionValue.id === val.id)
                              );
                              if (match) setSelectedVariant(match);
                            }}
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

            {/* Tags */}
            {product.tags.length > 0 && (
              <div className="product-detail-tags">
                {product.tags.map((t) => (
                  <span key={t.tag} className="product-tag">{t.tag}</span>
                ))}
              </div>
            )}

            {/* Description */}
            {(product.shortDescription || product.description) && (
              <div className="product-detail-description">
                <h3>Description</h3>
                <p>{product.description || product.shortDescription}</p>
              </div>
            )}

            {/* Specs */}
            <div className="product-detail-specs">
              <h3>Details</h3>
              <table className="specs-table">
                <tbody>
                  {currentSku && (
                    <tr><td>SKU</td><td>{currentSku}</td></tr>
                  )}
                  {product.brand && (
                    <tr><td>Brand</td><td>{product.brand.name}</td></tr>
                  )}
                  {product.category && (
                    <tr><td>Category</td><td>{product.category.name}</td></tr>
                  )}
                  {product.weight && (
                    <tr><td>Weight</td><td>{Number(product.weight)} {product.weightUnit || 'kg'}</td></tr>
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
