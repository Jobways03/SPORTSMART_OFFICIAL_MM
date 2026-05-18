import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || 'http://localhost:4005';

/**
 * Phase 8 (2026-05-16) — robots.txt for the storefront.
 *
 * Open the public catalog, search, category, and brand pages to
 * crawlers. Block account/cart/checkout/api/login since they're
 * personalised, auth-walled, or transactional — none of which add
 * SEO value and all of which can leak session-stamped URLs into
 * search results if indexed.
 *
 * `disallow` is wildcarded so subpaths like /account/orders/123
 * inherit the block automatically.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: [
          '/account',
          '/account/*',
          '/cart',
          '/checkout',
          '/checkout/*',
          '/login',
          '/register',
          '/forgot-password',
          '/api/',
          '/_next/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
