'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldCheck,
  Truck,
  RotateCcw,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { PriceTag } from '@/components/ui/PriceTag';
import { Badge } from '@/components/ui/Badge';
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
  optionValue?: {
    id: string;
    value: string;
    optionDefinition: { id: string; name: string };
  };
}

interface Variant {
  id: string;
  masterSku: string;
  title: string;
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
  price: number | null;
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

const COLOR_MAP: Record<string, string> = {
  red: '#dc2626', blue: '#2563eb', green: '#16a34a', black: '#111827',
  white: '#ffffff', yellow: '#eab308', orange: '#ea580c', purple: '#9333ea',
  pink: '#ec4899', grey: '#6b7280', gray: '#6b7280', navy: '#1e3a5f',
  brown: '#92400e', beige: '#d4a574', maroon: '#800000', teal: '#0d9488',
  cyan: '#06b6d4', indigo: '#4f46e5', lime: '#84cc16', gold: '#d97706',
  silver: '#94a3b8', coral: '#f97316', salmon: '#f87171', olive: '#65a30d',
};

const isColorOption = (name: string) => /color|colour/i.test(name);
const getColorHex = (value: string): string | null => {
  const lower = value.toLowerCase().trim();
  if (COLOR_MAP[lower]) return COLOR_MAP[lower];
  for (const [name, hex] of Object.entries(COLOR_MAP)) {
    if (lower.includes(name)) return hex;
  }
  if (/^#[0-9a-f]{3,6}$/i.test(lower)) return lower;
  return null;
};

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
  const [showFullDescription, setShowFullDescription] = useState(false);

  const [pincode, setPincode] = useState('');
  const [pincodeChecking, setPincodeChecking] = useState(false);
  const [pincodeResult, setPincodeResult] = useState<{
    serviceable: boolean;
    estimatedDays?: number;
    deliveryEstimate?: string;
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

  useEffect(() => setSelectedImage(0), [selectedVariant]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('lastCheckedPincode');
      if (saved && /^\d{6}$/.test(saved)) setPincode(saved);
    } catch {}
  }, []);

  const getVariantStock = (v: Variant) => v.totalAvailableStock ?? v.totalStock ?? v.stock ?? 0;

  const optionGroups = useMemo(() => {
    const groups: Record<string, { name: string; values: { id: string; value: string }[] }> = {};
    if (product?.hasVariants) {
      for (const variant of product.variants) {
        for (const ov of variant.optionValues) {
          const name = ov.optionName || ov.optionValue?.optionDefinition?.name;
          const val = ov.displayValue || ov.value || ov.optionValue?.value;
          const id = ov.optionValue?.id || `${name}-${val}`;
          if (!name || !val) continue;
          if (!groups[name]) groups[name] = { name, values: [] };
          if (!groups[name].values.some((v) => v.id === id)) {
            groups[name].values.push({ id, value: val });
          }
        }
      }
    }
    return groups;
  }, [product]);

  const handleAddToCart = async (buyNow = false) => {
    try {
      const token = sessionStorage.getItem('accessToken');
      if (!token) return router.push('/login');
    } catch {
      return router.push('/login');
    }
    if (!product) return;
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
        setCartMessage('Added to cart');
        setTimeout(() => setCartMessage(''), 2200);
      }
    } catch (err: any) {
      setCartMessage(err?.message || 'Failed to add to cart');
    } finally {
      setAddingToCart(false);
    }
  };

  const handleCheckPincode = async () => {
    if (!product) return;
    if (!/^\d{6}$/.test(pincode)) {
      setPincodeError('Enter a valid 6-digit pincode');
      setPincodeResult(null);
      return;
    }
    setPincodeError('');
    setPincodeResult(null);
    setPincodeChecking(true);
    try {
      sessionStorage.setItem('lastCheckedPincode', pincode);
    } catch {}
    try {
      const params = new URLSearchParams({ productId: product.id, pincode });
      if (selectedVariant) params.set('variantId', selectedVariant.id);
      const body = await apiClient<any>(`/storefront/serviceability/check?${params}`);
      if (body.data) {
        setPincodeResult({
          serviceable: body.data.serviceable,
          estimatedDays: body.data.estimatedDays,
          deliveryEstimate: body.data.deliveryEstimate,
          message: body.data.message,
        });
      } else {
        setPincodeResult({ serviceable: false, message: body.message || 'Unable to check' });
      }
    } catch (err: any) {
      setPincodeError(err?.message || 'Failed to check delivery availability');
    } finally {
      setPincodeChecking(false);
    }
  };

  if (loading) {
    return (
      <StorefrontShell>
        <div className="container-x py-16">
          <div className="grid lg:grid-cols-2 gap-12">
            <div className="aspect-square bg-ink-100 animate-pulse" />
            <div className="space-y-4">
              <div className="h-4 w-24 bg-ink-100 animate-pulse" />
              <div className="h-10 w-3/4 bg-ink-100 animate-pulse" />
              <div className="h-6 w-32 bg-ink-100 animate-pulse" />
              <div className="h-12 w-40 bg-ink-100 animate-pulse mt-8" />
            </div>
          </div>
        </div>
      </StorefrontShell>
    );
  }

  if (error || !product) {
    return (
      <StorefrontShell>
        <div className="container-x py-24 text-center">
          <h1 className="font-display text-h1 text-ink-900">Product not found</h1>
          <p className="mt-3 text-body-lg text-ink-600">This product may no longer be available.</p>
          <Link
            href="/products"
            className="mt-8 inline-flex items-center h-11 px-6 bg-ink-900 text-white font-medium hover:bg-ink-800"
          >
            Browse all products
          </Link>
        </div>
      </StorefrontShell>
    );
  }

  const currentPrice = selectedVariant ? selectedVariant.price : (product.price ?? product.basePrice);
  const currentCompare = selectedVariant ? selectedVariant.compareAtPrice : product.compareAtPrice;
  const currentStock = selectedVariant
    ? getVariantStock(selectedVariant)
    : (product.totalAvailableStock ?? product.totalStock ?? product.baseStock ?? 0);
  const currentSku = selectedVariant ? (selectedVariant.masterSku || selectedVariant.sku) : product.baseSku;
  const isInStock = selectedVariant
    ? (selectedVariant.inStock ?? currentStock > 0)
    : (product.inStock ?? currentStock > 0);

  const selectedVariantImages = selectedVariant?.images?.length ? selectedVariant.images : null;
  const allVariantImages = (product.variants || [])
    .flatMap((v) => v.images || [])
    .filter((img, idx, arr) => arr.findIndex((i) => i.url === img.url) === idx);
  const images = selectedVariantImages
    ? selectedVariantImages
    : product.images.length > 0
      ? product.images
      : allVariantImages.length > 0
        ? allVariantImages
        : null;

  const dimensions = (() => {
    if (!product.dimensions) return null;
    const { length, width, height, unit } = product.dimensions;
    const parts: string[] = [];
    if (length) parts.push(`L: ${length}`);
    if (width) parts.push(`W: ${width}`);
    if (height) parts.push(`H: ${height}`);
    if (parts.length === 0) return null;
    return parts.join(' × ') + (unit ? ` ${unit}` : ' cm');
  })();

  return (
    <StorefrontShell>
      <div className="container-x py-6 sm:py-10">
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-6">
          <Link href="/" className="hover:text-ink-900">Home</Link>
          {' / '}
          <Link href="/products" className="hover:text-ink-900">Shop</Link>
          {product.category && (
            <>
              {' / '}
              <Link href={`/products?categoryId=${product.category.id}`} className="hover:text-ink-900">
                {product.category.name}
              </Link>
            </>
          )}
          {' / '}
          <span className="text-ink-900">{product.title}</span>
        </div>

        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16">
          {/* Image gallery */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="aspect-square bg-ink-100 overflow-hidden">
              {images ? (
                <img
                  src={images[selectedImage]?.url}
                  alt={images[selectedImage]?.altText || product.title}
                  className="size-full object-contain"
                />
              ) : (
                <div className="size-full grid place-items-center text-ink-400 font-display text-6xl">
                  SM
                </div>
              )}
            </div>
            {images && images.length > 1 && (
              <div className="mt-4 grid grid-cols-5 gap-2">
                {images.map((img, idx) => (
                  <button
                    key={img.id}
                    onClick={() => setSelectedImage(idx)}
                    className={`aspect-square overflow-hidden border transition-colors ${
                      idx === selectedImage ? 'border-ink-900' : 'border-ink-200 hover:border-ink-500'
                    }`}
                  >
                    <img
                      src={img.url}
                      alt={img.altText || product.title}
                      className="size-full object-contain bg-ink-100"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div>
            {product.brand && (
              <div className="text-caption uppercase tracking-[0.18em] text-ink-600 font-semibold">
                {product.brand.name}
              </div>
            )}
            <h1 className="mt-2 font-display text-4xl sm:text-5xl text-ink-900 leading-[1.05]">
              {product.title}
            </h1>
            {product.productCode && (
              <div className="mt-3 text-caption text-ink-500 tabular">
                Product code · {product.productCode}
              </div>
            )}

            <div className="mt-6">
              <PriceTag price={currentPrice} compareAt={currentCompare} size="lg" />
            </div>
            <div className="mt-1 text-caption text-ink-600">Inclusive of all taxes</div>

            <div className="mt-5 flex items-center gap-2">
              {isInStock ? (
                currentStock <= 5 ? (
                  <Badge tone="warning" size="md">Only {currentStock} left</Badge>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-body text-success">
                    <span className="size-1.5 rounded-full bg-success" />
                    In stock
                  </span>
                )
              ) : (
                <Badge tone="ink" size="md">Out of stock</Badge>
              )}
            </div>

            {/* Variant pickers */}
            {Object.keys(optionGroups).length > 0 && (
              <div className="mt-8 space-y-6">
                {Object.entries(optionGroups).map(([key, group]) => (
                  <div key={key}>
                    <h3 className="text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                      {group.name}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {group.values.map((val) => {
                        const getOvId = (ov: OptionValue) =>
                          ov.optionValue?.id || `${ov.optionName}-${ov.displayValue || ov.value}`;
                        const getOvName = (ov: OptionValue) =>
                          ov.optionName || ov.optionValue?.optionDefinition?.name || '';
                        const ovMatchesVal = (ov: OptionValue) => getOvId(ov) === val.id;
                        const isSelected = selectedVariant?.optionValues.some(ovMatchesVal);
                        const colorHex = isColorOption(group.name) ? getColorHex(val.value) : null;
                        const hasStock = product.variants.some(
                          (v) => v.optionValues.some(ovMatchesVal) && getVariantStock(v) > 0,
                        );

                        const selectVariant = () => {
                          const otherSelectedIds: string[] = [];
                          if (selectedVariant) {
                            for (const ov of selectedVariant.optionValues) {
                              if (getOvName(ov) !== group.name) otherSelectedIds.push(getOvId(ov));
                            }
                          }
                          const match =
                            product.variants.find(
                              (v) =>
                                v.optionValues.some(ovMatchesVal) &&
                                otherSelectedIds.every((id) =>
                                  v.optionValues.some((ov2) => getOvId(ov2) === id),
                                ),
                            ) || product.variants.find((v) => v.optionValues.some(ovMatchesVal));
                          if (match) setSelectedVariant(match);
                        };

                        if (colorHex) {
                          return (
                            <button
                              key={val.id}
                              onClick={selectVariant}
                              title={val.value}
                              className={`relative size-10 rounded-full border-2 transition-all ${
                                isSelected
                                  ? 'border-ink-900 ring-2 ring-ink-900 ring-offset-2'
                                  : 'border-ink-200 hover:border-ink-500'
                              } ${!hasStock ? 'opacity-40' : ''}`}
                              style={{
                                backgroundColor: colorHex,
                                borderColor:
                                  colorHex === '#ffffff' && !isSelected ? '#D4D0C7' : undefined,
                              }}
                            >
                              <span className="sr-only">{val.value}</span>
                            </button>
                          );
                        }

                        return (
                          <button
                            key={val.id}
                            onClick={selectVariant}
                            disabled={!hasStock}
                            className={`min-w-12 h-11 px-4 border text-body font-medium transition-colors ${
                              isSelected
                                ? 'bg-ink-900 text-white border-ink-900'
                                : 'bg-white text-ink-900 border-ink-300 hover:border-ink-900'
                            } ${!hasStock ? 'opacity-40 line-through cursor-not-allowed' : ''}`}
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

            {/* Pincode checker */}
            <div className="mt-8 border border-ink-200 p-5">
              <div className="text-caption uppercase tracking-wider font-semibold text-ink-700 mb-2">
                Delivery
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Enter pincode"
                  value={pincode}
                  onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="flex-1 h-11 px-3 border border-ink-300 hover:border-ink-500 focus:border-ink-900 focus:outline-none text-body bg-white tabular"
                />
                <button
                  onClick={handleCheckPincode}
                  disabled={pincodeChecking}
                  className="h-11 px-5 border border-ink-900 text-ink-900 font-medium hover:bg-ink-900 hover:text-white disabled:opacity-50 transition-colors"
                >
                  {pincodeChecking ? 'Checking…' : 'Check'}
                </button>
              </div>
              {pincodeError && (
                <p className="mt-2 text-caption text-danger flex items-center gap-1">
                  <AlertCircle className="size-3" /> {pincodeError}
                </p>
              )}
              {pincodeResult && (
                <div
                  className={`mt-3 flex items-start gap-2 text-body ${
                    pincodeResult.serviceable ? 'text-success' : 'text-danger'
                  }`}
                >
                  {pincodeResult.serviceable ? (
                    <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
                  ) : (
                    <XCircle className="size-4 mt-0.5 shrink-0" />
                  )}
                  <span>
                    {pincodeResult.serviceable
                      ? (pincodeResult.deliveryEstimate
                          ?? (pincodeResult.estimatedDays != null
                              ? `Delivery in ${pincodeResult.estimatedDays} day${pincodeResult.estimatedDays === 1 ? '' : 's'}`
                              : 'Delivery available'))
                      : pincodeResult.message ?? 'Not deliverable here'}
                  </span>
                </div>
              )}
            </div>

            {/* CTA */}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                onClick={() => handleAddToCart(false)}
                disabled={addingToCart || !isInStock}
                className="h-12 border border-ink-900 text-ink-900 font-semibold hover:bg-ink-900 hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-ink-900 transition-colors"
              >
                {!isInStock ? 'Out of stock' : addingToCart ? 'Adding…' : 'Add to cart'}
              </button>
              <button
                onClick={() => handleAddToCart(true)}
                disabled={addingToCart || !isInStock}
                className="h-12 bg-ink-900 text-white font-semibold hover:bg-ink-800 disabled:opacity-50 transition-colors"
              >
                Buy now
              </button>
            </div>
            {cartMessage && (
              <div
                className={`mt-3 text-body inline-flex items-center gap-1.5 ${
                  cartMessage.toLowerCase().includes('added') ? 'text-success' : 'text-danger'
                }`}
              >
                {cartMessage.toLowerCase().includes('added') ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <AlertCircle className="size-4" />
                )}
                {cartMessage}
              </div>
            )}

            {/* Trust strip */}
            <div className="mt-8 grid grid-cols-3 gap-3 border-y border-ink-200 py-4">
              <div className="flex items-start gap-2">
                <Truck className="size-4 mt-0.5 text-ink-700 shrink-0" strokeWidth={1.75} />
                <div className="text-caption text-ink-700 leading-tight">Free shipping over ₹999</div>
              </div>
              <div className="flex items-start gap-2">
                <RotateCcw className="size-4 mt-0.5 text-ink-700 shrink-0" strokeWidth={1.75} />
                <div className="text-caption text-ink-700 leading-tight">7-day easy returns</div>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="size-4 mt-0.5 text-ink-700 shrink-0" strokeWidth={1.75} />
                <div className="text-caption text-ink-700 leading-tight">100% authentic</div>
              </div>
            </div>

            {/* Description */}
            {(product.shortDescription || product.description) && (
              <section className="mt-10">
                <h2 className="font-display text-h2 text-ink-900 mb-4">Description</h2>
                {product.description ? (
                  <div
                    className={`prose-storefront text-body-lg text-ink-700 leading-relaxed ${
                      showFullDescription ? '' : 'max-h-64 overflow-hidden relative'
                    }`}
                    dangerouslySetInnerHTML={{ __html: sanitizeProductHtml(product.description) }}
                  />
                ) : (
                  <p className="text-body-lg text-ink-700">{product.shortDescription}</p>
                )}
                {product.description && !showFullDescription && (
                  <button
                    onClick={() => setShowFullDescription(true)}
                    className="mt-3 inline-flex items-center gap-1 text-caption uppercase tracking-wider font-semibold text-accent-dark hover:gap-1.5 transition-all"
                  >
                    Read more <ChevronDown className="size-3" />
                  </button>
                )}
              </section>
            )}

            {/* Specs */}
            <section className="mt-10">
              <h2 className="font-display text-h2 text-ink-900 mb-4">Product details</h2>
              <dl className="border-t border-ink-200">
                {[
                  product.brand && ['Brand', product.brand.name],
                  product.category && ['Category', product.category.name],
                  product.productCode && ['Product code', product.productCode],
                  currentSku && ['SKU', currentSku],
                  product.weight && ['Weight', `${product.weight} ${product.weightUnit || 'kg'}`],
                  dimensions && ['Dimensions', dimensions],
                  product.returnPolicy && ['Return policy', product.returnPolicy],
                  product.warrantyInfo && ['Warranty', product.warrantyInfo],
                ]
                  .filter(Boolean)
                  .map((row) => {
                    const [label, value] = row as [string, string];
                    return (
                      <div
                        key={label}
                        className="grid grid-cols-[160px_1fr] py-3 border-b border-ink-200 text-body"
                      >
                        <dt className="text-ink-600">{label}</dt>
                        <dd className="text-ink-900">{value}</dd>
                      </div>
                    );
                  })}
              </dl>
            </section>

            {product.tags.length > 0 && (
              <div className="mt-8 flex flex-wrap gap-2">
                {product.tags.map((t, idx) => (
                  <span
                    key={`${t.tag}-${idx}`}
                    className="inline-flex items-center h-7 px-3 border border-ink-300 text-caption text-ink-700"
                  >
                    {t.tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
