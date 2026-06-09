import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || 'http://localhost:4005';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Phase 8 (2026-05-16) — sitemap.xml for the storefront.
 *
 * Next.js evaluates this file at build (and revalidates at runtime
 * per the `revalidate` export below) and outputs a real
 * `sitemap.xml`. We list:
 *
 *   • static landing pages — homepage, account-creation funnels
 *   • product catalog        — fetched from the API's public sitemap
 *     endpoint so the list stays in lockstep with the catalog
 *
 * Best-effort: a transient API failure produces a sitemap that still
 * has the static pages — better than no sitemap at all. The fetch
 * has a 10s timeout so the build can't hang on a stuck backend.
 */
export const revalidate = 3600; // re-generate once an hour at most

interface ApiProductForSitemap {
  slug: string;
  updatedAt?: string;
}

async function fetchProducts(): Promise<ApiProductForSitemap[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`${API_URL}/api/v1/storefront/sitemap/products?limit=10000`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: ApiProductForSitemap[] };
    return Array.isArray(json?.data) ? json.data : [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1.0 },
    { url: `${SITE_URL}/search`, changeFrequency: 'daily', priority: 0.7 },
  ];

  const products = await fetchProducts();
  const productEntries: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${SITE_URL}/products/${p.slug}`,
    lastModified: p.updatedAt ? new Date(p.updatedAt) : undefined,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [...staticEntries, ...productEntries];
}
