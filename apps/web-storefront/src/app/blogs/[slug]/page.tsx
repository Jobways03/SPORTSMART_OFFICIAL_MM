'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { blogPostsService, type BlogPost } from '@/services/blog-posts.service';

export default function BlogDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    blogPostsService
      .getBySlug(slug)
      .then((res) => {
        if (cancelled) return;
        setPost(res.data ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load post');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <StorefrontShell>
      <article className="container-wide py-8 sm:py-12 max-w-3xl mx-auto">
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
          <Link href="/" className="hover:text-ink-900">
            Home
          </Link>
          {' / '}
          <Link href="/blogs" className="hover:text-ink-900">
            Blog
          </Link>
          {post && (
            <>
              {' / '}
              <span>{post.title}</span>
            </>
          )}
        </div>

        {loading ? (
          <div className="space-y-6">
            <div className="h-12 bg-ink-100 animate-pulse rounded" />
            <div className="aspect-[16/9] bg-ink-100 animate-pulse rounded-2xl" />
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-4 bg-ink-100 animate-pulse rounded" />
              ))}
            </div>
          </div>
        ) : err ? (
          <div className="py-24 text-center">
            <h1 className="font-display text-h2 text-ink-900">Post not found</h1>
            <p className="mt-3 text-body-lg text-ink-600">{err}</p>
            <Link
              href="/blogs"
              className="mt-6 inline-flex items-center h-11 px-5 bg-ink-900 text-white font-medium hover:bg-ink-800 rounded-full"
            >
              Back to blog
            </Link>
          </div>
        ) : post ? (
          <>
            <header className="mb-6">
              <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
                {post.category}
                {post.publishedAt && (
                  <>
                    <span className="mx-2">·</span>
                    {new Date(post.publishedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </>
                )}
                {post.author && (
                  <>
                    <span className="mx-2">·</span>
                    {post.author}
                  </>
                )}
              </div>
              <h1 className="font-display text-3xl sm:text-4xl text-ink-900 leading-tight tracking-tight">
                {post.title}
              </h1>
              {post.excerpt && (
                <p className="mt-4 text-body-lg text-ink-600">{post.excerpt}</p>
              )}
            </header>

            {post.imageUrl && (
              <div
                className="aspect-[16/9] rounded-2xl bg-ink-100 mb-8"
                style={{
                  background: `#0F1115 url(${post.imageUrl}) center/cover no-repeat`,
                }}
              />
            )}

            {post.contentHtml ? (
              <div
                className="blog-content prose prose-lg max-w-none"
                dangerouslySetInnerHTML={{ __html: post.contentHtml }}
              />
            ) : (
              <p className="text-body text-ink-600">No content.</p>
            )}

            {post.tags.length > 0 && (
              <div className="mt-10 pt-6 border-t border-ink-200 flex flex-wrap gap-2">
                {post.tags.map((t) => (
                  <span
                    key={t}
                    className="text-caption uppercase tracking-wider text-ink-600 border border-ink-200 rounded-full px-3 py-1"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-12">
              <Link
                href="/blogs"
                className="inline-flex items-center h-11 px-5 border border-ink-300 hover:border-ink-900 text-body font-medium rounded-full"
              >
                ← Back to blog
              </Link>
            </div>
          </>
        ) : null}
      </article>

      <style jsx global>{`
        .blog-content h1, .blog-content h2, .blog-content h3, .blog-content h4 {
          font-family: var(--font-display, inherit);
          color: #0F1115;
          line-height: 1.2;
          margin-top: 1.5em;
          margin-bottom: 0.5em;
        }
        .blog-content h2 { font-size: 1.75rem; }
        .blog-content h3 { font-size: 1.4rem; }
        .blog-content p { margin: 0.75em 0; color: #1f2937; line-height: 1.7; }
        .blog-content ul, .blog-content ol { margin: 0.75em 0; padding-left: 1.5em; }
        .blog-content li { margin: 0.4em 0; }
        .blog-content a { color: #2563EB; text-decoration: underline; }
        .blog-content img { max-width: 100%; height: auto; border-radius: 12px; margin: 1em 0; }
        .blog-content blockquote {
          border-left: 4px solid #2563EB;
          padding-left: 1em;
          color: #4b5563;
          font-style: italic;
          margin: 1em 0;
        }
        .blog-content pre {
          background: #1e1e2e;
          color: #cdd6f4;
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
        }
        .blog-content code {
          background: #f1f2f4;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.9em;
        }
      `}</style>
    </StorefrontShell>
  );
}
