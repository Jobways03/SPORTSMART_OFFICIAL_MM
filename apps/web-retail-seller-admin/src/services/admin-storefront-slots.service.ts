import { apiClient, ApiResponse } from '@/lib/api-client';

// Mirrors apps/api/src/modules/content/storefront-slots/
// storefront-slots.service.ts → SlotDefinitionDto. Slots are the
// registry of named placeholders within fixed storefront sections —
// each is paired with a StorefrontContentBlock (via the slotKey) to
// provide actual content. Sections themselves are code-defined.
export interface SlotDefinition {
  id: string;
  sectionKey: string;
  slotKey: string;
  label: string;
  position: number;
  defaultHref: string | null;
  isSystem: boolean;
}

export interface CreateSlotInput {
  sectionKey: string;
  // Optional — backend derives a unique key from the label if omitted.
  slotKey?: string;
  label: string;
  defaultHref?: string;
  position?: number;
}

export interface SlotListResponse {
  items: SlotDefinition[];
}

export const adminStorefrontSlotsService = {
  list(): Promise<ApiResponse<SlotListResponse>> {
    return apiClient<SlotListResponse>('/admin/storefront-slots');
  },

  create(input: CreateSlotInput): Promise<ApiResponse<SlotDefinition>> {
    return apiClient<SlotDefinition>('/admin/storefront-slots', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  remove(id: string): Promise<ApiResponse<unknown>> {
    return apiClient(`/admin/storefront-slots/${id}`, {
      method: 'DELETE',
    });
  },
};

// Keep this in sync with StorefrontSlotsService.ALLOWED_SECTIONS on
// the API side. Hard-coded here because new sections require code
// changes to the storefront homepage anyway (each carries its own
// grid/aspect/tone), so a deploy-time list is the right shape.
export const ALLOWED_SECTIONS: Array<{
  key: string;
  label: string;
  description: string;
}> = [
  {
    key: 'hero',
    label: 'Hero',
    description: 'Top-of-home hero — large image + headline tile(s).',
  },
  {
    key: 'sport-tiles-strip',
    label: 'Sport tiles strip',
    description:
      'Horizontally scrolling sport-category tiles below the hero.',
  },
  {
    key: 'equipping-champions',
    label: 'Equipping champions',
    description: 'Athlete / brand spotlight rail.',
  },
  {
    key: 'most-loved-deals',
    label: 'Most-loved deals',
    description: 'Curated deal tiles, mid-home.',
  },
  {
    key: 'banner-promo',
    label: 'Banner promo',
    description: 'Wide single-image promo strip.',
  },
  {
    key: 'unite-play',
    label: 'Unite & play',
    description: 'Community / events block.',
  },
  {
    key: 'partner-promos',
    label: 'Partner promos',
    description: 'Co-branded promotional tiles.',
  },
  {
    key: 'brand-chips',
    label: 'Brand chips',
    description: 'Brand-shortcut chips near the footer.',
  },
];
