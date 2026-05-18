import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const SITE_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || 'http://localhost:4005';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Phase 8 (2026-05-16) — server-side SEO wrapper for the product page.
 *
 * The product page itself is a heavy client component (state-driven
 * variant picker, image gallery, dynamic pricing). Converting it
 * wholesale to a server component would be a multi-day refactor —
 * but the SEO needs (per-page title, OG image, canonical URL, JSON-LD
 * product schema) are all met if this server-side layout fetches the
 * product once and emits the metadata + structured-data markup.
 *
 * The client `page.tsx` keeps its existing fetch + state machine.
 * Two fetches (one server, one client) is acceptable: the server one
 * is cached by `revalidate`, the client one is the source of truth
 * for variant interactions. Both hit the same API.
 */
export const revalidate = 1800; // re-cache server metadata every 30 min

interface ProductForMeta {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  description: string | null;
  brand?: { name?: string | null } | null;
  category?: { name?: string | null } | null;
  basePrice?: number | string | null;
  baseCompareAtPrice?: number | string | null;
  images?: Array<{ url: string; altText?: string | null }>;
  variants?: Array<{ sku?: string | null; price?: number | string | null; totalAvailableStock?: number }>;
  averageRating?: number | null;
  reviewCount?: number | null;
}

async function fetchProduct(slug: string): Promise<ProductForMeta | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(`${API_URL}/storefront/products/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
      next: { revalidate: 1800 },
      headers: { accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: ProductForMeta };
    return json?.data ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) {
    return {
      title: 'Product not found',
      robots: { index: false, follow: false },
    };
  }

  const description =
    (product.shortDescription || product.description || '')
      .replace(/<[^>]+>/g, '')
      .slice(0, 160)
      .trim() ||
    `Shop ${product.title} on SPORTSMART. Free shipping across India.`;

  const ogImage = product.images?.[0]?.url;

  return {
    title: product.title,
    description,
    alternates: {
      canonical: `/products/${product.slug}`,
    },
    openGraph: {
      type: 'website',
      title: product.title,
      description,
      url: `${SITE_URL}/products/${product.slug}`,
      images: ogImage ? [{ url: ogImage, alt: product.title }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: product.title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

/**
 * Build the Schema.org Product JSON-LD payload. Google's rich-result
 * crawler reads this to power Product / Offer rich snippets. Keep
 * the shape stable — once it's been indexed, breaking the offers
 * block (e.g. dropping `priceCurrency`) can drop rich results for
 * weeks while Google re-crawls.
 */
function buildProductJsonLd(product: ProductForMeta, slug: string) {
  const price = product.basePrice != null ? String(product.basePrice) : undefined;
  const image = product.images?.map((i) => i.url).filter(Boolean);

  // AggregateRating is optional but worth including when at least 1
  // review exists. Below that threshold Google suppresses the rich
  // result anyway, and an empty `ratingValue` is worse than nothing.
  const aggregateRating =
    product.reviewCount && product.reviewCount > 0 && product.averageRating
      ? {
          '@type': 'AggregateRating',
          ratingValue: Number(product.averageRating).toFixed(1),
          reviewCount: product.reviewCount,
        }
      : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: (product.shortDescription || product.description || '').replace(/<[^>]+>/g, '').slice(0, 5000),
    image: image && image.length > 0 ? image : undefined,
    sku: product.variants?.[0]?.sku ?? undefined,
    brand: product.brand?.name ? { '@type': 'Brand', name: product.brand.name } : undefined,
    category: product.category?.name ?? undefined,
    url: `${SITE_URL}/products/${slug}`,
    offers: price
      ? {
          '@type': 'Offer',
          url: `${SITE_URL}/products/${slug}`,
          priceCurrency: 'INR',
          price,
          availability:
            (product.variants ?? []).some((v) => (v.totalAvailableStock ?? 0) > 0)
              ? 'https://schema.org/InStock'
              : 'https://schema.org/OutOfStock',
        }
      : undefined,
    aggregateRating,
  };
}

/** Breadcrumb JSON-LD for "Home › Category › Product". */
function buildBreadcrumbJsonLd(product: ProductForMeta, slug: string) {
  const items: Array<{ '@type': string; position: number; name: string; item: string }> = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
  ];
  if (product.category?.name) {
    items.push({
      '@type': 'ListItem',
      position: 2,
      name: product.category.name,
      item: `${SITE_URL}/search?category=${encodeURIComponent(product.category.name)}`,
    });
  }
  items.push({
    '@type': 'ListItem',
    position: items.length + 1,
    name: product.title,
    item: `${SITE_URL}/products/${slug}`,
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items,
  };
}

export default async function ProductLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await fetchProduct(slug);

  // When the product is missing the page's own client-side fetch will
  // surface the "not found" UX. We still render children to avoid
  // breaking SSR; we just skip the structured-data emission.
  if (!product) {
    return <>{children}</>;
  }

  const productLd = buildProductJsonLd(product, slug);
  const crumbLd = buildBreadcrumbJsonLd(product, slug);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
      {/* eslint-disable-next-line react/no-danger */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbLd) }}
      />
      {children}
    </>
  );
}
