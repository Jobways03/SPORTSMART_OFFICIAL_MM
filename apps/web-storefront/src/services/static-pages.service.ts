import { apiClient, ApiResponse } from '@/lib/api-client';

/**
 * Phase 49 (2026-05-21) — storefront client for the public static-page
 * endpoint. The endpoint returns only published, non-soft-deleted
 * pages — drafts 404 (no leak that a slug exists).
 */
export interface StaticPage {
  id: string;
  slug: string;
  title: string;
  body: string;
  metaTitle: string | null;
  metaDesc: string | null;
  canonicalUrl: string | null;
  ogImage: string | null;
  noIndex: boolean;
  published: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export const staticPagesService = {
  getBySlug(slug: string): Promise<ApiResponse<StaticPage>> {
    return apiClient(`/storefront/content/pages/${encodeURIComponent(slug)}`);
  },
};
