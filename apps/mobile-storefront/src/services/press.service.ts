import {apiClient} from '../lib/api-client';

// "As featured in" press logos. Sourced from the same /storefront/content
// endpoint as testimonials, with a different slot-name convention:
// blocks whose slot key starts with `press-` (e.g. press-india-today,
// press-yourstory) are surfaced here. One CMS, multiple list-shaped
// surfaces — no new endpoint needed.

export interface PressLogo {
  id: string;
  name: string;
  logoUrl?: string | null;
  url?: string;
}

interface ContentBlockWire {
  slot: string;
  imageUrl: string | null;
  eyebrow: string | null;
  headline: string | null;
  ctaHref: string | null;
}

interface ContentMapWire {
  blocks: Record<string, ContentBlockWire>;
}

const PRESS_SLOT_PREFIX = 'press-';

export const pressService = {
  async list(): Promise<{press: PressLogo[]}> {
    const res = await apiClient<ContentMapWire>('/storefront/content');
    const blocks = res.data?.blocks ?? {};
    const press = Object.entries(blocks)
      .filter(([slot]) => slot.startsWith(PRESS_SLOT_PREFIX))
      .map(([slot, block]) => ({
        id: slot,
        // eyebrow holds the publication name ("INDIA TODAY"),
        // imageUrl is the logo, ctaHref is the article link if any.
        name: block.eyebrow ?? block.headline ?? '',
        logoUrl: block.imageUrl,
        url: block.ctaHref ?? undefined,
      }))
      .filter(p => p.name);
    return {press};
  },
};
