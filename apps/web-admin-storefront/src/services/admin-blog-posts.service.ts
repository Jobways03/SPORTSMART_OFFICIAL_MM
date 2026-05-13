import { apiClient, ApiResponse, API_BASE } from '@/lib/api-client';

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

export const adminBlogPostsService = {
  list(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: BlogPostStatus | '';
  } = {}): Promise<ApiResponse<BlogPostListResponse>> {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    const q = qs.toString();
    return apiClient(`/admin/blog-posts${q ? `?${q}` : ''}`);
  },

  getOne(id: string): Promise<ApiResponse<BlogPost>> {
    return apiClient(`/admin/blog-posts/${encodeURIComponent(id)}`);
  },

  create(body: CreateBlogPostInput): Promise<ApiResponse<BlogPost>> {
    return apiClient('/admin/blog-posts', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  update(id: string, body: UpdateBlogPostInput): Promise<ApiResponse<BlogPost>> {
    return apiClient(`/admin/blog-posts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  },

  remove(id: string): Promise<ApiResponse<null>> {
    return apiClient(`/admin/blog-posts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async uploadImage(id: string, file: File): Promise<ApiResponse<BlogPost>> {
    const form = new FormData();
    form.append('image', file);
    const token =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('adminAccessToken')
        : null;
    const res = await fetch(
      `${API_BASE}/api/v1/admin/blog-posts/${encodeURIComponent(id)}/upload`,
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      },
    );
    const json = await res.json();
    if (!res.ok) {
      const err = json?.message ?? `Upload failed (${res.status})`;
      throw new Error(Array.isArray(err) ? err.join(', ') : err);
    }
    return json;
  },
};
