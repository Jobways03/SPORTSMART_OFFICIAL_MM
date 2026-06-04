'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { wishlistService } from '@/services/wishlist.service';

export interface ProductCardData {
  id: string;
  title: string;
  slug: string;
  primaryImageUrl: string | null;
  imageUrls?: string[];
  categoryName: string | null;
  brandName: string | null;
  // Phase 192 (#5) — money arrives as a string from the API (Decimal-as-
  // string discipline); the card coerces with Number() at the format edge.
  price: number | string | null;
  basePrice?: number | string | null;
  compareAtPrice: number | string | null;
  priceRange?: { min: string; max: string } | null;
  totalAvailableStock: number;
  sellerCount: number;
}

// ───────────────────────────────────────────────────────────────────────
// Phase 202 (#1/#8/#15) — shared wishlist client store.
//
// Pre-202 the heart toggled local component state and called nothing, so
// nothing persisted and a refresh wiped the state (the "#20 UX trap").
// This module-level store is the single source of truth on the client:
//   - it holds the set of wishlisted productIds + the row id per product
//     (needed to call DELETE/move-to-cart),
//   - it is seeded ONCE per page from GET /customer/wishlist/ids (#8) so a
//     grid of cards does ONE fetch, not one-per-card (the N+1 trap),
//   - every mutation notifies subscribers (cards + PDP heart) AND fires a
//     `wishlist-updated` window event the Navbar badge listens to (#15).
//
// Kept inside this owned file (no new shared module) so it can be imported
// by the PDP and Navbar without widening the change surface.
// ───────────────────────────────────────────────────────────────────────

type WishlistSnapshot = {
  // productId -> wishlist row id (the id needed for remove / move-to-cart)
  itemIdByProduct: Map<string, string>;
};

let snapshot: WishlistSnapshot = { itemIdByProduct: new Map() };
const listeners = new Set<() => void>();
let seeded = false;
let seeding: Promise<void> | null = null;

function emit() {
  // New object identity so useSyncExternalStore re-renders.
  snapshot = { itemIdByProduct: new Map(snapshot.itemIdByProduct) };
  for (const l of listeners) l();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('wishlist-updated'));
  }
}

function hasToken(): boolean {
  try {
    return !!sessionStorage.getItem('accessToken');
  } catch {
    return false;
  }
}

export const wishlistStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return snapshot;
  },
  isWishlisted(productId: string) {
    return snapshot.itemIdByProduct.has(productId);
  },
  itemId(productId: string) {
    return snapshot.itemIdByProduct.get(productId) ?? null;
  },
  count() {
    return snapshot.itemIdByProduct.size;
  },
  /** Seed from the server exactly once per page load (idempotent). */
  async seedOnce(): Promise<void> {
    if (seeded) return;
    if (seeding) {
      await seeding;
      return;
    }
    if (!hasToken()) {
      seeded = true;
      return;
    }
    seeding = (async () => {
      try {
        const res = await wishlistService.ids();
        const map = new Map<string, string>();
        for (const id of res.data?.productIds ?? []) {
          // The ids endpoint returns productIds only; the row id is
          // resolved lazily on first toggle (add returns it; remove needs
          // it). Seed with an empty sentinel so the heart renders filled.
          map.set(id, map.get(id) ?? '');
        }
        snapshot = { itemIdByProduct: map };
        emit();
      } catch {
        // Non-fatal — hearts just start empty.
      } finally {
        seeded = true;
        seeding = null;
      }
    })();
    await seeding;
  },
  /** Record an added product + its row id (from the add response). */
  markAdded(productId: string, itemId: string) {
    snapshot.itemIdByProduct.set(productId, itemId);
    emit();
  },
  /** Forget a product (after remove / move-to-cart). */
  markRemoved(productId: string) {
    snapshot.itemIdByProduct.delete(productId);
    emit();
  },
  /** Reset on logout. */
  reset() {
    seeded = false;
    seeding = null;
    snapshot = { itemIdByProduct: new Map() };
    emit();
  },
};

/**
 * Hook: subscribe to the shared store and seed it once. Returns the
 * wishlisted flag for a product plus a toggle that calls the API with
 * optimistic UI and a login redirect on 401 (#1).
 */
export function useWishlistToggle(productId: string) {
  const router = useRouter();
  const snap = useSyncExternalStore(
    wishlistStore.subscribe,
    wishlistStore.getSnapshot,
    wishlistStore.getSnapshot,
  );
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void wishlistStore.seedOnce();
  }, []);

  const wishlisted = snap.itemIdByProduct.has(productId);

  // Return the user to where they were after logging in (#1).
  const loginRedirect = () => {
    const here =
      typeof window !== 'undefined'
        ? window.location.pathname + window.location.search
        : '/products';
    router.push(`/login?redirect=${encodeURIComponent(here)}`);
  };

  const toggle = async (variantId?: string) => {
    if (pending) return;
    if (!hasToken()) {
      loginRedirect();
      return;
    }
    setPending(true);
    const wasWishlisted = wishlistStore.isWishlisted(productId);
    // Capture the original row id up front so a failed remove can be
    // rolled back to the exact prior state (markRemoved below would
    // otherwise erase it before the catch runs).
    const originalItemId = wishlistStore.itemId(productId);
    try {
      if (wasWishlisted) {
        // Optimistic remove.
        wishlistStore.markRemoved(productId);
        if (originalItemId) {
          await wishlistService.remove(originalItemId);
        } else {
          // Row id unknown (seeded sentinel) — reconcile from the list.
          const list = await wishlistService.list(1, 100);
          const match = list.data?.items.find((i) => i.productId === productId);
          if (match) await wishlistService.remove(match.id);
        }
      } else {
        // Optimistic add (sentinel id until the response lands).
        wishlistStore.markAdded(productId, '');
        const res = await wishlistService.add({ productId, variantId });
        if (res.data?.id) wishlistStore.markAdded(productId, res.data.id);
      }
    } catch (err: unknown) {
      // Roll back the optimistic change to the exact prior state.
      if (wasWishlisted) wishlistStore.markAdded(productId, originalItemId ?? '');
      else wishlistStore.markRemoved(productId);
      const status = (err as { status?: number })?.status;
      if (status === 401) loginRedirect();
    } finally {
      setPending(false);
    }
  };

  return { wishlisted, pending, toggle };
}

// Phase 192 (#12) — request a sized, auto-format/quality variant from
// Cloudinary; a no-op for non-Cloudinary URLs (S3 etc.).
function sizedImage(url: string, width: number): string {
  const marker = '/image/upload/';
  const i = url.indexOf(marker);
  if (i === -1) return url;
  return `${url.slice(0, i + marker.length)}w_${width},q_auto,f_auto/${url.slice(i + marker.length)}`;
}

const formatINR = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export function ProductCard({ product }: { product: ProductCardData }) {
  // Phase 202 (#1) — heart is now wired to the wishlist API via the
  // shared store; it persists and survives a refresh.
  const { wishlisted, pending, toggle } = useWishlistToggle(product.id);
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
                    src={sizedImage(url, 600)}
                    srcSet={`${sizedImage(url, 300)} 300w, ${sizedImage(url, 600)} 600w`}
                    sizes="(max-width: 768px) 50vw, 300px"
                    alt={product.title}
                    loading="lazy"
                    decoding="async"
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

      {/* Wishlist heart — visible on hover on desktop, always on touch.
          Phase 202 (#1) — persists via the wishlist API. */}
      <button
        type="button"
        aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
        aria-pressed={wishlisted}
        disabled={pending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void toggle();
        }}
        className={`absolute right-2 top-2 z-10 size-9 grid place-items-center bg-white/95 backdrop-blur-[2px] transition-opacity rounded-full disabled:cursor-wait ${
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
