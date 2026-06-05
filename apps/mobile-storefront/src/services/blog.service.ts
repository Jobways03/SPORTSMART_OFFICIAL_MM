import {apiClient, ApiResponse} from '../lib/api-client';

// Public storefront blog. Mirrors the web storefront's blog-posts.service +
// /blogs and /blogs/[slug] pages. Content ships as HTML (contentHtml).

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentHtml: string;
  imageUrl: string | null;
  author: string | null;
  category: string;
  tags: string[];
  publishedAt: string | null;
  metaTitle: string | null;
  metaDesc: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlogPostListResponse {
  items: BlogPost[];
  total: number;
  page: number;
  limit: number;
}

export const blogService = {
  list(
    params: {page?: number; limit?: number} = {},
  ): Promise<ApiResponse<BlogPostListResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return apiClient<BlogPostListResponse>(
      `/storefront/blog-posts${q ? `?${q}` : ''}`,
    );
  },

  getBySlug(slug: string): Promise<ApiResponse<BlogPost>> {
    return apiClient<BlogPost>(
      `/storefront/blog-posts/${encodeURIComponent(slug)}`,
    );
  },
};
