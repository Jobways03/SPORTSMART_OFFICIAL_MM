import {apiClient} from '../lib/api-client';

// Editorial / blog cards rendered on HomeScreen. Sourced from the
// existing /storefront/blog-posts endpoint (see
// apps/api/src/modules/content/blog-posts/public-blog-posts.controller.ts).
// We translate the BlogPostDto wire shape into a slimmer
// EditorialStory shape so HomeScreen doesn't depend on backend fields
// it never renders (status, metaTitle, contentHtml, tags, etc.).

export interface EditorialStory {
  id: string;
  slug: string;
  tag: string;
  title: string;
  subtitle?: string;
  minutesRead?: number;
  coverImageUrl?: string | null;
  url?: string;
  publishedAt?: string;
}

// Backend wire shape (subset — only the fields we map from).
interface BlogPostDtoWire {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentHtml: string;
  imageUrl: string | null;
  category: string;
  publishedAt: string | null;
}

interface BlogListWire {
  items: BlogPostDtoWire[];
  total: number;
  page: number;
  limit: number;
}

// Rough words-per-minute estimate from raw HTML length. ~5 chars per
// word, ~225 words/min reading speed → ~1125 chars/min. Round up to
// the nearest minute so even short posts read "1 min".
function estimateMinutes(html: string): number {
  const chars = html?.length ?? 0;
  return Math.max(1, Math.ceil(chars / 1125));
}

export const editorialService = {
  async list(limit = 6): Promise<EditorialStory[]> {
    const res = await apiClient<BlogListWire>(
      `/storefront/blog-posts?limit=${limit}`,
    );
    const items = res.data?.items ?? [];
    return items.map(p => ({
      id: p.id,
      slug: p.slug,
      tag: (p.category || 'STORY').toUpperCase(),
      title: p.title,
      subtitle: p.excerpt ?? undefined,
      minutesRead: estimateMinutes(p.contentHtml),
      coverImageUrl: p.imageUrl,
      publishedAt: p.publishedAt ?? undefined,
    }));
  },
};
