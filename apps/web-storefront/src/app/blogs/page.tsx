'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { blogPostsService, type BlogPost } from '@/services/blog-posts.service';

export default function BlogsPage() {
  const [items, setItems] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    blogPostsService
      .list({ limit: 24 })
      .then((res) => {
        if (cancelled) return;
        setItems(res.data?.items ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : 'Failed to load posts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <StorefrontShell>
      <div className="container-wide py-8 sm:py-12">
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
          <Link href="/" className="hover:text-ink-900">
            Home
          </Link>
          {' / '}
          <span>Blog</span>
        </div>

        <h1 className="font-display text-2xl sm:text-3xl text-ink-900 leading-tight tracking-tight">
          BLOG
        </h1>

        {err && (
          <p className="mt-6 text-sale-600">{err}</p>
        )}

        {loading ? (
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-[4/3] bg-ink-100 animate-pulse rounded-2xl"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-12 py-24 text-center border border-ink-200 rounded-2xl bg-white">
            <h2 className="font-display text-h2 text-ink-900">No posts yet</h2>
            <p className="mt-3 text-body-lg text-ink-600">
              Check back soon — we're cooking up some stories.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((p) => (
              <BlogCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </div>
    </StorefrontShell>
  );
}

function BlogCard({ post }: { post: BlogPost }) {
  return (
    <Link
      href={`/blogs/${post.slug}`}
      className="group block bg-white border border-ink-200 rounded-2xl overflow-hidden hover:shadow-lg transition-shadow"
    >
      <div
        className="aspect-[4/3] bg-ink-100"
        style={{
          background: post.imageUrl
            ? `#0F1115 url(${post.imageUrl}) center/cover no-repeat`
            : 'linear-gradient(135deg, #1f2937, #4b5563)',
        }}
      />
      <div className="p-5">
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-2">
          {post.category}
          {post.publishedAt && (
            <>
              <span className="mx-2">·</span>
              {new Date(post.publishedAt).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </>
          )}
        </div>
        <h2 className="font-display text-xl text-ink-900 leading-tight group-hover:text-sale-600 transition-colors">
          {post.title}
        </h2>
        {post.excerpt && (
          <p className="mt-3 text-body text-ink-600 line-clamp-3">
            {post.excerpt}
          </p>
        )}
        <div className="mt-4 inline-flex items-center gap-2 text-caption uppercase tracking-wider text-ink-900 border-b border-ink-900 pb-1">
          Read more
        </div>
      </div>
    </Link>
  );
}
