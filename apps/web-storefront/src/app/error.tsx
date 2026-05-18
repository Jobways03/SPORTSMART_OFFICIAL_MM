'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RotateCw, Home } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';

/**
 * Phase 8 (2026-05-16) — root error boundary for the customer storefront.
 *
 * Before this file existed, an unhandled exception anywhere under
 * `/app/**` rendered Next.js's debug overlay in production. The
 * overlay leaks stack traces, source paths, and request internals —
 * not the kind of thing a customer should see when payment cards
 * fail or an API hiccups during checkout.
 *
 * The shell wrap keeps the navbar + footer so the user never feels
 * stranded; the digest line gives support a reference id to look up
 * the actual error in server logs.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Storefront error:', error);
  }, [error]);

  return (
    <StorefrontShell>
      <div className="container-x py-16 sm:py-24">
        <div className="mx-auto max-w-xl bg-white border border-ink-200 rounded-2xl p-8 sm:p-10 text-center">
          <div className="mx-auto size-14 grid place-items-center bg-red-50 text-danger rounded-2xl mb-5">
            <AlertCircle className="size-7" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-h2 text-ink-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-body text-ink-600">
            We hit an unexpected error while loading this page. You can try
            again, or head back to the homepage and start fresh.
          </p>
          {error.digest && (
            <p className="mt-4 font-mono text-caption text-ink-500">
              Reference: {error.digest}
            </p>
          )}
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 bg-ink-900 text-white font-semibold rounded-full hover:bg-ink-800"
            >
              <RotateCw className="size-4" strokeWidth={2} />
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 bg-white text-ink-900 border border-ink-300 font-semibold rounded-full hover:border-ink-900"
            >
              <Home className="size-4" strokeWidth={2} />
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}
