'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { ProductCard, type ProductCardData } from '@/components/ui/ProductCard';

/**
 * Phase 193 (#2) — "You might also like" — same-category/brand, in-stock,
 * approved products. Self-contained: fetches independently and renders
 * nothing when there are no related products.
 */
export function RelatedProducts({ slug }: { slug: string }) {
  const [items, setItems] = useState<ProductCardData[]>([]);

  useEffect(() => {
    let alive = true;
    apiClient<{ products: ProductCardData[] }>(
      `/storefront/products/${encodeURIComponent(slug)}/related?limit=8`,
    )
      .then((res) => {
        if (alive) setItems(res.data?.products ?? []);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (items.length === 0) return null;

  return (
    <section className="mt-16" aria-label="Related products">
      <h2 className="font-semibold text-2xl text-ink-900 mb-6">You might also like</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-10">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
