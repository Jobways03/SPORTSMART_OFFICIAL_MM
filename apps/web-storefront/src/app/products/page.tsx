import type { Metadata } from 'next';
import { ProductsClient } from './ProductsClient';
import type { ProductCardData } from '@/components/ui/ProductCard';

// Phase 192 (#1) — this is now a SERVER component. It pre-fetches the first
// page of products (so crawlers get real HTML + JSON-LD), sets canonical /
// robots metadata, and hands the data to the interactive client component.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

type SP = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function buildApiQuery(sp: SP): string {
  const params = new URLSearchParams();
  params.set('limit', '20');
  const page = first(sp.page);
  if (page) params.set('page', page);
  for (const key of ['search', 'sport', 'tag', 'categoryId', 'brandId', 'brand', 'collection', 'sortBy', 'minPrice', 'maxPrice'] as const) {
    const val = first(sp[key]);
    if (val) params.set(key, val);
  }
  for (const [k, v] of Object.entries(sp)) {
    const m = k.match(/^filter\[(\w+)\]$/);
    const val = first(v);
    if (m && val) params.set(k, val);
  }
  return params.toString();
}

interface FetchResult {
  products: ProductCardData[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

// `fetch` with no-store could be heavy; the API is itself cached, and Next
// dedupes identical fetch() calls within one request (generateMetadata + the
// page share this call). Fail-soft: any error → null → client fetches as before.
async function fetchProducts(sp: SP): Promise<FetchResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/storefront/products?${buildApiQuery(sp)}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data ?? null;
  } catch {
    return null;
  }
}

function isFilteredView(sp: SP): boolean {
  // Phase 195 (#14) — a search/sport query is an ephemeral SERP: noindex it
  // so spun parameter combinations don't create infinite indexable URLs
  // (duplicate-content / crawl-budget waste). The SearchAction box still
  // routes here; Google's sitelinks searchbox doesn't need the target
  // indexed.
  if (first(sp.search) || first(sp.sport) || first(sp.tag)) return true;
  if (first(sp.sortBy) || first(sp.minPrice) || first(sp.maxPrice)) return true;
  if (first(sp.page) && first(sp.page) !== '1') return true;
  return Object.keys(sp).some((k) => /^filter\[/.test(k));
}

function canonicalPath(sp: SP): string {
  // #10 — canonical drops sort/filter/price/page so the many filter combos
  // collapse onto the indexable category/brand/search page.
  const params = new URLSearchParams();
  for (const key of ['categoryId', 'brandId', 'brand', 'collection', 'sport', 'search'] as const) {
    const val = first(sp[key]);
    if (val) params.set(key, val);
  }
  const qs = params.toString();
  return qs ? `/products?${qs}` : '/products';
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams;
  const result = await fetchProducts(sp);
  const empty = !result || result.products.length === 0;
  const filtered = isFilteredView(sp);
  const search = first(sp.search) || first(sp.sport);
  const title = search ? `${search} — SPORTSMART` : 'Shop all products — SPORTSMART';
  return {
    title,
    description: 'Browse sports gear, apparel and equipment on SPORTSMART.',
    alternates: { canonical: canonicalPath(sp) },
    // #14 — don't index filtered/sorted permutations or empty result pages;
    // still follow links so crawlers reach the canonical/category pages.
    robots: empty || filtered ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const result = await fetchProducts(sp);
  const products = result?.products ?? [];

  // #9 — server-rendered JSON-LD ItemList for product rich results.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: products.slice(0, 20).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.title,
        url: `/products/${p.slug}`,
        ...(p.primaryImageUrl ? { image: p.primaryImageUrl } : {}),
        ...(p.price != null
          ? { offers: { '@type': 'Offer', price: String(p.price), priceCurrency: 'INR' } }
          : {}),
      },
    })),
  };

  return (
    <>
      {products.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <ProductsClient initialData={result ?? undefined} />
    </>
  );
}
