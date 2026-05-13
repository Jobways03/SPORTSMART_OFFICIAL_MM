'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaTile } from '@/components/ui/MediaTile';
import type { StorefrontContentMap } from '@/lib/storefront-content';

interface BannerSlide {
  slot: string;
  eyebrow?: string;
  headline: string;
  subhead?: string;
  price?: string;
  priceCaption?: string;
  ctaHref: string;
  ctaLabel?: string;
}

interface BannerPromoProps extends BannerSlide {
  // When true, the caller's slide becomes slide 1 and the hardcoded
  // ADDITIONAL_BANNERS below are appended to give the carousel
  // somewhere to go. Prev/next + dots are wired. Off → single banner.
  withCarouselUI?: boolean;
  // Phase 3 — admin-managed content map. When a slide's slot is in
  // the map, the admin's imageUrl / copy override the hardcoded values.
  content?: StorefrontContentMap;
}

// Companion slides used when withCarouselUI is on. Adding more entries
// here automatically extends the carousel; pagination + auto-advance
// pick them up.
const ADDITIONAL_BANNERS: BannerSlide[] = [
  {
    slot: 'banner-cycling',
    eyebrow: 'Trail ready',
    headline: 'Ride the season out.',
    subhead: 'Bikes, helmets & gear — trail tested.',
    price: '₹1,299',
    priceCaption: 'Onwards',
    ctaHref: '/products?sport=cycling',
  },
  {
    slot: 'banner-gym',
    eyebrow: 'Train smart',
    headline: 'Build the home gym.',
    subhead: 'Strength kit, mats, and recovery gear.',
    price: '₹599',
    priceCaption: 'Onwards',
    ctaHref: '/products?category=gym-equipment',
  },
];

const AUTO_ADVANCE_MS = 7000;

export function BannerPromo({
  withCarouselUI = false,
  ctaLabel = 'Shop now',
  content = {},
  ...rest
}: BannerPromoProps) {
  const callerSlide: BannerSlide = { ...rest, ctaLabel };
  const slides = withCarouselUI
    ? [callerSlide, ...ADDITIONAL_BANNERS]
    : [callerSlide];

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = slides.length;
  const isCarousel = withCarouselUI && total > 1;

  const goTo = useCallback(
    (next: number) => setIndex(((next % total) + total) % total),
    [total],
  );
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);
  const next = useCallback(() => goTo(index + 1), [goTo, index]);

  useEffect(() => {
    if (!isCarousel || paused) return;
    const t = setTimeout(() => goTo(index + 1), AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [index, paused, goTo, isCarousel]);

  const baseSlide = slides[index];
  // Admin override per-slide. Each field falls back to the hardcoded
  // value when the admin hasn't customised it.
  const override = content[baseSlide.slot];
  const slide: BannerSlide = {
    ...baseSlide,
    eyebrow: override?.eyebrow ?? baseSlide.eyebrow,
    headline: override?.headline ?? baseSlide.headline,
    subhead: override?.subhead ?? baseSlide.subhead,
    ctaLabel: override?.ctaLabel ?? baseSlide.ctaLabel,
    ctaHref: override?.ctaHref ?? baseSlide.ctaHref,
    price: override?.price ?? baseSlide.price,
    priceCaption: override?.priceCaption ?? baseSlide.priceCaption,
  };
  const imageSrc = override?.imageUrl ?? undefined;

  return (
    <section className="container-x py-8 sm:py-12">
      <div
        className="relative"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <MediaTile
          key={slide.slot}
          slotName={slide.slot}
          imageSrc={imageSrc}
          aspect="21/9"
          tone="dark"
          align="bottom-left"
          eyebrow={slide.eyebrow}
          eyebrowTone="white"
          headline={slide.headline}
          headlineSize="lg"
          subhead={slide.subhead}
          price={slide.price}
          priceCaption={slide.priceCaption}
          contentClassName="max-w-lg"
        />

        <Link
          key={`${slide.slot}-cta`}
          href={slide.ctaHref}
          className="absolute bottom-6 left-6 sm:bottom-8 sm:left-8 inline-flex items-center gap-2 h-11 px-5 bg-white text-ink-900 font-bold rounded-full shadow-lg hover:bg-ink-100 transition-colors"
        >
          {slide.ctaLabel ?? ctaLabel}
          <ArrowRight className="size-4" />
        </Link>

        {isCarousel && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Previous"
              className="absolute left-4 top-1/2 -translate-y-1/2 size-11 grid place-items-center bg-white/90 hover:bg-white border border-ink-200 transition-colors rounded-full"
            >
              <ChevronLeft className="size-5 text-ink-900" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Next"
              className="absolute right-4 top-1/2 -translate-y-1/2 size-11 grid place-items-center bg-white/90 hover:bg-white border border-ink-200 transition-colors rounded-full"
            >
              <ChevronRight className="size-5 text-ink-900" strokeWidth={2} />
            </button>

            <div className="absolute bottom-5 right-6 flex items-center gap-2 z-10">
              {slides.map((_, i) => (
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
    </section>
  );
}
