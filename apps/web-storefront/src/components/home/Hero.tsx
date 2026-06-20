'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaTile } from '@/components/ui/MediaTile';
import type {
  StorefrontContentMap,
  StorefrontSlotDefinition,
} from '@/lib/storefront-content';

/**
 * Per-slot extras the storefront still hard-codes — these define copy /
 * price treatment that aren't part of the generic content-block schema.
 * When the admin adds a brand-new hero slot from the dashboard, we don't
 * have entries here; the slide simply renders without price / caption /
 * CTA until the admin fills in those fields via the content editor.
 */
interface HeroSlideExtras {
  headline: string;
  subhead: string;
  price?: string;
  priceCaption?: string;
  cta?: { label: string; href: string };
}

const SLIDE_DEFAULTS: Record<string, HeroSlideExtras> = {
  'hero-slide-1': {
    headline: 'Gym essentials kit.',
    subhead: 'Treadmills, ellipticals & more.',
    price: '₹9,999',
    priceCaption: 'Onwards',
    cta: { label: 'Shop now', href: '/products?category=gym-equipment' },
  },
  'hero-slide-2': {
    headline: 'Run further. Train smarter.',
    subhead: 'Performance shoes, trackers & apparel.',
    price: '₹2,499',
    priceCaption: 'Onwards',
    cta: { label: 'Shop running', href: '/products?sport=running' },
  },
  'hero-slide-3': {
    headline: 'Ride season is here.',
    subhead: 'Road, trail, and city bikes — geared up.',
    price: '₹6,499',
    priceCaption: 'Onwards',
    cta: { label: 'Shop cycling', href: '/products?sport=cycling' },
  },
};

// Auto-advance cadence. Pauses when the user mouses over the slider so
// they can read a slide they actually wanted to dwell on.
const AUTO_ADVANCE_MS = 6000;

interface HeroProps {
  content?: StorefrontContentMap;
  slots?: StorefrontSlotDefinition[];
}

export function Hero({ content = {}, slots = [] }: HeroProps) {
  const [index, setIndex] = useState(0);
  const total = slots.length;
  const [paused, setPaused] = useState(false);

  const goTo = useCallback(
    (next: number) => {
      if (total === 0) return;
      const wrapped = ((next % total) + total) % total;
      setIndex(wrapped);
    },
    [total],
  );

  const prev = useCallback(() => goTo(index - 1), [goTo, index]);
  const next = useCallback(() => goTo(index + 1), [goTo, index]);

  useEffect(() => {
    if (paused || total < 2) return;
    const t = setTimeout(() => goTo(index + 1), AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [index, paused, goTo, total]);

  // Reset to a valid index if slots shrink (e.g. admin deletes a slot
  // while the carousel was on the last slide).
  useEffect(() => {
    if (index >= total && total > 0) setIndex(0);
  }, [index, total]);

  if (total === 0) return null;

  const slotDef = slots[Math.min(index, total - 1)];
  const slotKey = slotDef.slotKey;
  const defaults = SLIDE_DEFAULTS[slotKey];
  const override = content[slotKey];

  const headline = override?.headline ?? defaults?.headline ?? slotDef.label;
  const subhead = override?.subhead ?? defaults?.subhead;
  const fallbackHref = defaults?.cta?.href ?? slotDef.defaultHref ?? '/products';
  const fallbackLabel = defaults?.cta?.label ?? 'Shop now';
  const cta =
    override?.ctaLabel || override?.ctaHref
      ? {
          label: override.ctaLabel ?? fallbackLabel,
          href: override.ctaHref ?? fallbackHref,
        }
      : defaults?.cta;
  const imageSrc = override?.imageUrl ?? undefined;

  return (
    <section aria-label="Featured offer" className="bg-white">
      <div className="container-x py-4 sm:py-6">
        <div
          className="relative"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <MediaTile
            key={slotKey}
            slotName={slotKey}
            imageSrc={imageSrc}
            aspect="5/2"
            aspectClassName="aspect-[4/5] sm:aspect-[16/9] md:aspect-[5/2]"
            tone="dark"
            align="bottom-left"
            headline={headline}
            headlineSize="md"
            subhead={subhead}
            price={override?.price ?? defaults?.price}
            priceCaption={override?.priceCaption ?? defaults?.priceCaption}
            cta={cta}
            contentClassName="max-w-lg"
          />

          {total > 1 && (
            <>
              <button
                type="button"
                onClick={prev}
                aria-label="Previous slide"
                className="absolute left-4 top-1/2 -translate-y-1/2 size-11 grid place-items-center bg-white/90 hover:bg-white border border-ink-200 transition-colors z-10 rounded-full"
              >
                <ChevronLeft className="size-5 text-ink-900" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Next slide"
                className="absolute right-4 top-1/2 -translate-y-1/2 size-11 grid place-items-center bg-white/90 hover:bg-white border border-ink-200 transition-colors z-10 rounded-full"
              >
                <ChevronRight className="size-5 text-ink-900" strokeWidth={2} />
              </button>

              <div className="absolute bottom-5 right-6 flex items-center gap-2 z-10">
                {slots.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => goTo(i)}
                    aria-label={`Go to slide ${i + 1}`}
                    aria-current={i === index}
                    className={`h-1.5 transition-all rounded-full ${
                      i === index ? 'w-8 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
