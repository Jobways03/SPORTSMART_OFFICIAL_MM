'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';

export interface ProductCardData {
  id: string;
  title: string;
  slug: string;
  primaryImageUrl: string | null;
  imageUrls?: string[];
  categoryName: string | null;
  brandName: string | null;
  price: number | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  totalAvailableStock: number;
  sellerCount: number;
}

const formatINR = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export function ProductCard({ product }: { product: ProductCardData }) {
  const [wishlisted, setWishlisted] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Build a deduped, ordered list of images: primary first, then any extras.
  const images = useMemo(() => {
    const out: string[] = [];
    if (product.primaryImageUrl) out.push(product.primaryImageUrl);
    for (const u of product.imageUrls ?? []) {
      if (u && !out.includes(u)) out.push(u);
    }
    return out;
  }, [product.primaryImageUrl, product.imageUrls]);

  const startCycle = () => {
    if (images.length <= 1) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActiveImage((i) => (i + 1) % images.length);
    }, 2000);
  };
  const stopCycle = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    setActiveImage(0);
  };

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const displayPrice = product.price ?? product.basePrice ?? null;
  const showCompare =
    product.compareAtPrice != null &&
    displayPrice != null &&
    Number(product.compareAtPrice) > Number(displayPrice);
  const discount = showCompare
    ? Math.round(
        ((Number(product.compareAtPrice) - Number(displayPrice)) /
          Number(product.compareAtPrice)) *
          100,
      )
    : null;

  const lowStock = product.totalAvailableStock > 0 && product.totalAvailableStock <= 5;
  const outOfStock = product.totalAvailableStock <= 0;

  return (
    <div
      className="group relative"
      onMouseEnter={startCycle}
      onMouseLeave={stopCycle}
      onFocus={startCycle}
      onBlur={stopCycle}
    >
      <Link
        href={`/products/${product.slug}`}
        className="block focus-visible:outline-none"
      >
        <div className="relative aspect-square overflow-hidden bg-ink-100 rounded-2xl">
          {images.length > 0 ? (
            <div
              className="flex h-full"
              style={{
                width: `${images.length * 100}%`,
                transform: `translateX(-${(activeImage * 100) / images.length}%)`,
                transition: 'transform 1100ms cubic-bezier(0.45, 0, 0.15, 1)',
              }}
            >
              {images.map((url, idx) => (
                <div
                  key={url}
                  className="h-full shrink-0"
                  style={{ width: `${100 / images.length}%` }}
                  aria-hidden={idx !== activeImage}
                >
                  <img
                    src={url}
                    alt={product.title}
                    loading="lazy"
                    className="size-full object-contain p-4"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-ink-400">
              <span className="font-display text-5xl">SM</span>
            </div>
          )}

          {/* Position dots when there's more than one image */}
          {images.length > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {images.map((_, idx) => (
                <span
                  key={idx}
                  className={`h-1 transition-all ${
                    idx === activeImage ? 'w-5 bg-ink-900' : 'w-2 bg-ink-400'
                  }`}
                />
              ))}
            </div>
          )}

          {outOfStock && (
            <div className="absolute inset-0 grid place-items-center bg-white/75 backdrop-blur-[2px]">
              <span className="px-3 h-7 inline-flex items-center bg-ink-900 text-white text-caption uppercase tracking-wider font-semibold rounded-full">
                Out of stock
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Wishlist heart — visible on hover on desktop, always on touch */}
      <button
        type="button"
        aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
        aria-pressed={wishlisted}
        onClick={(e) => {
          e.preventDefault();
          setWishlisted((v) => !v);
        }}
        className={`absolute right-2 top-2 z-10 size-9 grid place-items-center bg-white/95 backdrop-blur-[2px] transition-opacity rounded-full ${
          wishlisted
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
      >
        <Heart
          className={`size-4 transition-colors ${
            wishlisted ? 'fill-sale text-sale' : 'text-ink-700'
          }`}
          strokeWidth={1.75}
        />
      </button>

      {/* Body — tight Myntra-style spacing */}
      <div className="mt-2.5">
        <Link
          href={`/products/${product.slug}`}
          className="block focus-visible:outline-none"
        >
          {product.brandName && (
            <div className="text-body font-semibold text-ink-900 truncate">
              {product.brandName}
            </div>
          )}
          <div className="text-body text-ink-600 truncate">
            {product.title}
          </div>

          <div className="mt-1.5 flex items-baseline gap-1.5 tabular flex-wrap">
            <span className="text-body font-semibold text-ink-900">
              {displayPrice != null ? formatINR(Number(displayPrice)) : '--'}
            </span>
            {showCompare && (
              <>
                <span className="text-caption text-ink-500 line-through">
                  {formatINR(Number(product.compareAtPrice))}
                </span>
                {discount && (
                  <span className="text-caption font-semibold text-sale">
                    ({discount}% OFF)
                  </span>
                )}
              </>
            )}
          </div>

          {!outOfStock && lowStock && (
            <div className="mt-1 text-caption font-semibold text-sale">
              Only {product.totalAvailableStock} left!
            </div>
          )}
        </Link>
      </div>
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div>
      <div className="aspect-square bg-ink-100 animate-pulse rounded-2xl" />
      <div className="mt-2.5 space-y-1.5">
        <div className="h-4 w-20 bg-ink-100 animate-pulse" />
        <div className="h-3 w-full bg-ink-100 animate-pulse" />
        <div className="h-4 w-1/2 bg-ink-100 animate-pulse" />
      </div>
    </div>
  );
}
