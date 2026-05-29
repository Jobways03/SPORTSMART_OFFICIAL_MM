import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors apps/api/src/modules/content/blog-posts/blog-posts.service.ts
// BlogPostDto. The backend `status` field is the BlogPostStatus
// Prisma enum — currently VISIBLE | HIDDEN per the admin controller's
// parseStatus helper.
export type BlogPostStatus = 'VISIBLE' | 'HIDDEN';

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
  status: BlogPostStatus;
  publishedAt: string | null;
  metaTitle: string | null;
  metaDesc: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBlogPostInput {
  title: string;
  slug?: string;
  excerpt?: string | null;
  contentHtml?: string;
  imageUrl?: string | null;
  author?: string | null;
  category?: string;
  tags?: string[];
  status?: BlogPostStatus;
  metaTitle?: string | null;
  metaDesc?: string | null;
}

export type UpdateBlogPostInput = Partial<CreateBlogPostInput>;

export interface BlogPostListResponse {
  items: BlogPost[];
  total: number;
  page: number;
  limit: number;
}

export interface ListBlogPostsParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: BlogPostStatus;
}

export const adminBlogPostsService = {
  list(
    params: ListBlogPostsParams = {},
  ): Promise<ApiResponse<BlogPostListResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    const s = qs.toString();
    return apiClient<BlogPostListResponse>(
      `/admin/blog-posts${s ? `?${s}` : ''}`,
    );
  },

  get(id: string): Promise<ApiResponse<BlogPost>> {
    return apiClient<BlogPost>(`/admin/blog-posts/${id}`);
  },

  create(input: CreateBlogPostInput): Promise<ApiResponse<BlogPost>> {
    return apiClient<BlogPost>('/admin/blog-posts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  update(
    id: string,
    input: UpdateBlogPostInput,
  ): Promise<ApiResponse<BlogPost>> {
    return apiClient<BlogPost>(`/admin/blog-posts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  remove(id: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/blog-posts/${id}`, { method: 'DELETE' });
  },
};
