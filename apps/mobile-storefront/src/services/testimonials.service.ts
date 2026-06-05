import {apiClient} from '../lib/api-client';

// Customer testimonial cards on HomeScreen. Sourced from the existing
// /storefront/content endpoint (see apps/api/src/modules/content/
// storefront-content/public-storefront-content.controller.ts) which
// returns a slot → block map of every active CMS-managed block.
//
// We adopt a slot-naming convention: any block whose slot key starts
// with `testimonial-` (e.g. testimonial-1, testimonial-bengaluru) is
// surfaced here. Backend stays one shared content table; the mobile
// app picks out the rows it cares about. No new endpoint required.

export interface Testimonial {
  id: string;
  name: string;
  location?: string;
  rating: number;
  text: string;
  verified?: boolean;
  avatarUrl?: string | null;
}

// Storefront content block wire shape (subset).
interface ContentBlockWire {
  slot: string;
  imageUrl: string | null;
  eyebrow: string | null;
  headline: string | null;
  subhead: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  price: string | null;
  active: boolean;
}

interface ContentMapWire {
  blocks: Record<string, ContentBlockWire>;
}

const TESTIMONIAL_SLOT_PREFIX = 'testimonial-';

export const testimonialsService = {
  async list(): Promise<{testimonials: Testimonial[]; total: number}> {
    const res = await apiClient<ContentMapWire>('/storefront/content');
    const blocks = res.data?.blocks ?? {};
    const testimonials = Object.entries(blocks)
      .filter(([slot]) => slot.startsWith(TESTIMONIAL_SLOT_PREFIX))
      .map(([slot, block]) => ({
        id: slot,
        // Content blocks don't carry structured author/rating columns,
        // so we lean on the existing fields:
        //   eyebrow → reviewer name
        //   headline → the quote itself (limited to ~200 chars by admin form)
        //   subhead → "Bengaluru · Verified"
        //   imageUrl → avatar
        // Admin team owns this convention; documented in the
        // storefront-content README on the API side.
        name: block.eyebrow ?? 'Customer',
        location: block.subhead ?? undefined,
        rating: 5,
        text: block.headline ?? '',
        verified: true,
        avatarUrl: block.imageUrl,
      }))
      .filter(t => t.text);
    return {testimonials, total: testimonials.length};
  },
};
