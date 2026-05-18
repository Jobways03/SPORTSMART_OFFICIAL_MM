import Link from 'next/link';
import { Compass, Home, Search } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';

/**
 * Phase 8 (2026-05-16) — global 404 for the customer storefront.
 *
 * App Router renders `/_next` debug pages for missing routes when no
 * `not-found.tsx` exists. This file gives 404s the same shell as the
 * rest of the site — navbar, footer, brand voice — so a typo in a
 * product URL still feels like part of SportSmart rather than a
 * broken page. Server component (no `'use client'`) so SEO crawlers
 * can render the friendly text.
 */
export default function NotFound() {
  return (
    <StorefrontShell>
      <div className="container-x py-16 sm:py-24">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto size-14 grid place-items-center bg-accent-soft text-accent-dark rounded-2xl mb-5">
            <Compass className="size-7" strokeWidth={1.75} />
          </div>
          <p className="font-display text-display text-ink-900 leading-none">
            404
          </p>
          <h1 className="mt-2 font-display text-h2 text-ink-900">
            Page not found
          </h1>
          <p className="mt-2 text-body text-ink-600">
            The page you&apos;re looking for doesn&apos;t exist or has been
            moved. Try the homepage or use search to find what you need.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 bg-ink-900 text-white font-semibold rounded-full hover:bg-ink-800"
            >
              <Home className="size-4" strokeWidth={2} />
              Back to home
            </Link>
            <Link
              href="/search"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 bg-white text-ink-900 border border-ink-300 font-semibold rounded-full hover:border-ink-900"
            >
              <Search className="size-4" strokeWidth={2} />
              Browse products
            </Link>
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
