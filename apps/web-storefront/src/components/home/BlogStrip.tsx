import Link from 'next/link';

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  imageUrl: string | null;
}

const API_HOST = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/**
 * Server component — fetches the 3 most-recent visible posts at render
 * time and renders the homepage Blog section. Hides itself entirely if
 * there are no posts so the homepage doesn't show an empty section.
 */
export async function BlogStrip() {
  let posts: BlogPost[] = [];
  try {
    const res = await fetch(`${API_HOST}/api/v1/storefront/blog-posts?limit=4`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { items?: BlogPost[] };
      };
      posts = json?.data?.items ?? [];
    }
  } catch {
    // Public endpoint — if it's down, swallow so the rest of the page
    // still renders.
    posts = [];
  }
  if (posts.length === 0) return null;

  return (
    <section aria-label="Blog" className="container-wide py-10 sm:py-14">
      <div className="flex items-end justify-between mb-6 sm:mb-8 gap-4">
        <div>
          <div className="text-caption uppercase tracking-[0.18em] text-ink-600 font-semibold">
            Latest reads
          </div>
          <h2 className="mt-1 font-display text-h2 sm:text-h1 text-ink-900 leading-[1.05] tracking-tight">
            From the blog
          </h2>
        </div>
        <Link
          href="/blogs"
          className="shrink-0 text-caption uppercase tracking-[0.15em] font-semibold text-ink-900 border-b border-ink-900 pb-1 hover:text-sale-600 hover:border-sale-600 transition-colors"
        >
          Visit blog →
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {posts.map((p) => (
          <Link
            key={p.id}
            href={`/blogs/${p.slug}`}
            className="group block bg-white border border-ink-200 rounded-2xl overflow-hidden hover:shadow-xl hover:border-ink-300 transition-all"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-ink-100">
              <div
                className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.04]"
                style={{
                  background: p.imageUrl
                    ? `#0F1115 url(${p.imageUrl}) center/cover no-repeat`
                    : 'linear-gradient(135deg, #1f2937, #4b5563)',
                }}
              />
            </div>
            <div className="p-4 sm:p-5">
              <h3 className="font-display text-lg sm:text-xl text-ink-900 leading-tight tracking-tight group-hover:text-sale-600 transition-colors line-clamp-2">
                {p.title}
              </h3>
              {p.excerpt && (
                <p className="mt-2 text-body text-ink-600 leading-relaxed line-clamp-2">
                  {p.excerpt}
                </p>
              )}
              <div className="mt-4 inline-flex items-center gap-2 text-caption uppercase tracking-[0.15em] font-semibold text-ink-900 border-b border-ink-900 pb-1 group-hover:text-sale-600 group-hover:border-sale-600 transition-colors">
                Read more →
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
