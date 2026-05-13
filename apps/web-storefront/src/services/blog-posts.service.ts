import { apiClient, ApiResponse } from '@/lib/api-client';

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

export const blogPostsService = {
  list(params: { page?: number; limit?: number } = {}): Promise<
    ApiResponse<BlogPostListResponse>
  > {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return apiClient(`/storefront/blog-posts${q ? `?${q}` : ''}`);
  },

  getBySlug(slug: string): Promise<ApiResponse<BlogPost>> {
    return apiClient(`/storefront/blog-posts/${encodeURIComponent(slug)}`);
  },
};
