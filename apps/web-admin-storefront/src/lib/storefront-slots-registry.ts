/**
 * Section metadata for storefront content.
 *
 * Sections are fixed (their grid / aspect ratio / tone live in the
 * storefront's home components). The *slots within each section* are
 * admin-editable — they're fetched at runtime from
 * `/api/v1/admin/storefront-slots`. To add a new section, add an entry
 * here AND wire a new home component on the storefront side.
 */
export interface SlotDefinition {
  slot: string;
  label: string;
  description?: string;
  aspect: '1/1' | '5/2' | '21/9' | '16/9';
  isSystem?: boolean;
  id?: string;
}

export interface SlotSection {
  sectionKey: string;
  title: string;
  description?: string;
  aspect: '1/1' | '5/2' | '21/9' | '16/9';
}

export const STOREFRONT_SECTIONS: SlotSection[] = [
  {
    sectionKey: 'hero',
    title: 'Hero',
    description: 'The full-width carousel at the top of the homepage.',
    aspect: '5/2',
  },
  {
    sectionKey: 'sport-tiles-strip',
    title: 'Sport tiles strip',
    description: 'The 8-tile row right under the hero — one per sport.',
    aspect: '1/1',
  },
  {
    sectionKey: 'equipping-champions',
    title: 'Equipping Champions',
    description: 'Four hero tiles below the sport strip.',
    aspect: '1/1',
  },
  {
    sectionKey: 'most-loved-deals',
    title: 'Most Loved Deals',
    description: 'Four deal tiles.',
    aspect: '1/1',
  },
  {
    sectionKey: 'banner-promo',
    title: 'Banner promo',
    description: 'The wide carousel below Most Loved Deals.',
    aspect: '21/9',
  },
  {
    sectionKey: 'unite-play',
    title: 'Unite & Play',
    description: 'Four team-sport tiles.',
    aspect: '1/1',
  },
  {
    sectionKey: 'partner-promos',
    title: 'Partner promos',
    description: 'Four featured-brand promo tiles.',
    aspect: '1/1',
  },
  {
    sectionKey: 'brand-chips',
    title: 'Brand chips',
    description: 'Small brand tiles in the partner row.',
    aspect: '1/1',
  },
];

/**
 * Backwards-compat: legacy code imports `STOREFRONT_SLOT_SECTIONS`
 * expecting `slots: SlotDefinition[]` on each entry. That data is now
 * server-side; this export remains so existing imports compile but
 * returns an empty `slots` array — callers that need slots must fetch
 * them from `/admin/storefront-slots`.
 */
export const STOREFRONT_SLOT_SECTIONS = STOREFRONT_SECTIONS.map((s) => ({
  ...s,
  slots: [] as SlotDefinition[],
}));
