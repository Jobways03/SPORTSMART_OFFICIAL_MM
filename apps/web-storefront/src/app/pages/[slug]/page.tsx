'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import {
  staticPagesService,
  type StaticPage,
} from '@/services/static-pages.service';

/**
 * Phase 49 (2026-05-21) — storefront consumer for CMS-managed static
 * pages (Terms, Privacy, Refund Policy, Shipping, About, …).
 *
 * The API has shipped admin CRUD for these pages since pre-Phase-49
 * but no storefront route consumed it — meaning legal pages didn't
 * exist on the public site (DPDP / consumer-protection compliance
 * gap). This route closes that.
 *
 * Body is already sanitized server-side via sanitizeCmsBody before
 * persist, so we render with dangerouslySetInnerHTML at the render
 * boundary. The sanitizer rejects <script>, javascript: URLs, event
 * handlers, etc.
 */
export default function StaticPageView() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<StaticPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    staticPagesService
      .getBySlug(slug)
      .then((res) => {
        if (cancelled) return;
        setPage(res.data ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load page');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Phase 49 — minimal head tag wiring. Next.js app-router prefers
  // generateMetadata() for SSR — this client component approach
  // keeps the route fetch-on-mount for parity with the blog detail
  // page; a future PR can promote to a server component + dynamic
  // metadata.
  useEffect(() => {
    if (!page) return;
    document.title = page.metaTitle || page.title;
    const ensureMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('name', name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };
    if (page.metaDesc) ensureMeta('description', page.metaDesc);
    if (page.noIndex) ensureMeta('robots', 'noindex, nofollow');
    if (page.canonicalUrl) {
      let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        document.head.appendChild(canonical);
      }
      canonical.setAttribute('href', page.canonicalUrl);
    }
  }, [page]);

  return (
    <StorefrontShell>
      <article className="container-wide py-8 sm:py-12 max-w-3xl mx-auto">
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
          <Link href="/" className="hover:text-ink-900">
            Home
          </Link>
          {page && (
            <>
              {' / '}
              <span>{page.title}</span>
            </>
          )}
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="h-12 bg-ink-100 animate-pulse rounded" />
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-4 bg-ink-100 animate-pulse rounded" />
              ))}
            </div>
          </div>
        ) : err || !page ? (
          <div className="py-24 text-center">
            <h1 className="font-display text-h2 text-ink-900">Page not found</h1>
            <p className="mt-3 text-body-lg text-ink-600">
              {err ?? 'This page is not available right now.'}
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex items-center h-11 px-5 bg-ink-900 text-white font-medium hover:bg-ink-800 rounded-full"
            >
              Back home
            </Link>
          </div>
        ) : (
          <>
            <header className="mb-6">
              <h1 className="font-display text-3xl sm:text-4xl text-ink-900 leading-tight tracking-tight">
                {page.title}
              </h1>
              {page.publishedAt && (
                <p className="mt-2 text-caption text-ink-600">
                  Last updated{' '}
                  {new Date(page.publishedAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
              )}
            </header>

            <div
              className="static-page-content prose prose-lg max-w-none"
              dangerouslySetInnerHTML={{ __html: page.body }}
            />
          </>
        )}
      </article>

      <style jsx global>{`
        .static-page-content h1,
        .static-page-content h2,
        .static-page-content h3,
        .static-page-content h4 {
          font-family: var(--font-sans, inherit);
          color: #0f1115;
          line-height: 1.2;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }
        .static-page-content h2 { font-size: 1.75rem; }
        .static-page-content h3 { font-size: 1.4rem; }
        .static-page-content p { margin: 0.75em 0; color: #1f2937; line-height: 1.7; }
        .static-page-content ul, .static-page-content ol { margin: 0.75em 0; padding-left: 1.5em; }
        .static-page-content li { margin: 0.4em 0; }
        .static-page-content a { color: #2563eb; text-decoration: underline; }
        .static-page-content img { max-width: 100%; height: auto; border-radius: 12px; margin: 1em 0; }
        .static-page-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 1em 0;
        }
        .static-page-content th, .static-page-content td {
          border: 1px solid #e5e7eb;
          padding: 8px 12px;
          text-align: left;
        }
        .static-page-content th {
          background: #f9fafb;
          font-weight: 600;
        }
      `}</style>
    </StorefrontShell>
  );
}
