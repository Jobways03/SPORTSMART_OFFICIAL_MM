'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ArrowUpRight } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import {
  ProductCard,
  ProductCardSkeleton,
  type ProductCardData,
} from '@/components/ui/ProductCard';

interface ApiResponse {
  products: ProductCardData[];
}

interface Props {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  query: string;
  ctaHref?: string;
  ctaLabel?: string;
  limit?: number;
}

export function HorizontalProductCarousel({
  title,
  eyebrow,
  subtitle,
  query,
  ctaHref = '/products',
  ctaLabel = 'See all',
  limit = 10,
}: Props) {
  const [products, setProducts] = useState<ProductCardData[] | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    apiClient<ApiResponse>(`/storefront/products?${query}&limit=${limit}`)
      .then((res) => setProducts(res.data?.products ?? []))
      .catch(() => setProducts([]));
  }, [query, limit]);

  const scrollBy = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const cardWidth = el.clientWidth / Math.max(1, getVisibleCount(el.clientWidth));
    el.scrollBy({ left: dir * cardWidth * 2, behavior: 'smooth' });
  };

  return (
    <section className="container-x py-10 sm:py-14">
      <div className="grid lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
        <div className="flex flex-col">
          {eyebrow && (
            <div className="text-caption uppercase tracking-[0.18em] text-ink-600 font-semibold">
              {eyebrow}
            </div>
          )}
          <h2 className="mt-1 font-display text-h1 sm:text-5xl leading-[1.05] tracking-tight text-ink-900">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-3 text-body text-ink-600 leading-relaxed max-w-[240px]">
              {subtitle}
            </p>
          )}

          <div className="mt-6 flex items-center gap-2">
            <button
              type="button"
              aria-label="Scroll left"
              onClick={() => scrollBy(-1)}
              className="size-11 grid place-items-center border border-ink-300 hover:border-ink-900 hover:bg-ink-50 transition-colors rounded-full"
            >
              <ChevronLeft className="size-4 text-ink-900" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Scroll right"
              onClick={() => scrollBy(1)}
              className="size-11 grid place-items-center border border-ink-300 hover:border-ink-900 hover:bg-ink-50 transition-colors rounded-full"
            >
              <ChevronRight className="size-4 text-ink-900" strokeWidth={2} />
            </button>
          </div>

          <Link
            href={ctaHref}
            className="mt-6 inline-flex items-center gap-1 text-body font-semibold text-ink-900 hover:text-accent-dark"
          >
            {ctaLabel}
            <ArrowUpRight className="size-4" />
          </Link>
        </div>

        <div className="min-w-0">
          {products === null ? (
            <div className="flex gap-4 overflow-hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="w-[calc(50%-8px)] sm:w-[calc(33.33%-12px)] lg:w-[calc(25%-12px)] shrink-0">
                  <ProductCardSkeleton />
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16 border border-ink-200">
              <div className="text-body-lg text-ink-600">No products to show yet.</div>
            </div>
          ) : (
            <div
              ref={trackRef}
              className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1 snap-x snap-mandatory scroll-smooth"
              style={{ scrollbarWidth: 'thin' }}
            >
              {products.map((p) => (
                <div
                  key={p.id}
                  className="w-[calc(50%-8px)] sm:w-[calc(33.33%-12px)] lg:w-[calc(25%-12px)] shrink-0 snap-start"
                >
                  <ProductCard product={p} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function getVisibleCount(width: number) {
  if (width >= 1024) return 4;
  if (width >= 640) return 3;
  return 2;
}
