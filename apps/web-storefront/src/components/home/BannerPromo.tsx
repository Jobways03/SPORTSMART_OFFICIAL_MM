import Link from 'next/link';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaTile } from '@/components/ui/MediaTile';

interface BannerPromoProps {
  slot: string;
  eyebrow?: string;
  headline: string;
  subhead?: string;
  price?: string;
  priceCaption?: string;
  ctaHref: string;
  ctaLabel?: string;
  withCarouselUI?: boolean;
}

export function BannerPromo({
  slot,
  eyebrow,
  headline,
  subhead,
  price,
  priceCaption,
  ctaHref,
  ctaLabel = 'Shop now',
  withCarouselUI = false,
}: BannerPromoProps) {
  return (
    <section className="container-x py-8 sm:py-12">
      <div className="relative">
        <MediaTile
          slotName={slot}
          aspect="21/9"
          tone="dark"
          align="bottom-left"
          eyebrow={eyebrow}
          eyebrowTone="white"
          headline={headline}
          headlineSize="lg"
          subhead={subhead}
          price={price}
          priceCaption={priceCaption}
          contentClassName="max-w-lg"
        />

        <Link
          href={ctaHref}
          className="absolute bottom-6 left-6 sm:bottom-8 sm:left-8 inline-flex items-center gap-2 h-11 px-5 bg-white text-ink-900 font-bold rounded-full shadow-lg hover:bg-ink-100 transition-colors"
        >
          {ctaLabel}
          <ArrowRight className="size-4" />
        </Link>

        {withCarouselUI && (
          <>
            <button
              type="button"
              aria-label="Previous"
              className="absolute left-4 top-1/2 -translate-y-1/2 size-11 grid place-items-center bg-white/90 hover:bg-white border border-ink-200 transition-colors rounded-full"
            >
              <ChevronLeft className="size-5 text-ink-900" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Next"
              className="absolute right-4 top-1/2 -translate-y-1/2 size-11 grid place-items-center bg-white/90 hover:bg-white border border-ink-200 transition-colors rounded-full"
            >
              <ChevronRight className="size-5 text-ink-900" strokeWidth={2} />
            </button>
          </>
        )}
      </div>
    </section>
  );
}
