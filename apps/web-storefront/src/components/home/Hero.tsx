import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaTile } from '@/components/ui/MediaTile';

const HERO_SLIDES = [
  {
    slot: 'hero-slide-1',
    headline: 'Gym essentials kit.',
    subhead: 'Treadmills, ellipticals & more.',
    price: '₹9,999',
    priceCaption: 'Onwards',
    cta: { label: 'Shop now', href: '/products?category=gym-equipment' },
  },
];

export function Hero() {
  const slide = HERO_SLIDES[0];

  return (
    <section aria-label="Featured offer" className="bg-white">
      <div className="container-x py-4 sm:py-6">
        <div className="relative">
          <MediaTile
            slotName={slide.slot}
            aspect="5/2"
            tone="dark"
            align="bottom-left"
            headline={slide.headline}
            headlineSize="md"
            subhead={slide.subhead}
            price={slide.price}
            priceCaption={slide.priceCaption}
            cta={slide.cta}
            contentClassName="max-w-lg"
          />

          <button
            type="button"
            aria-label="Previous slide"
            className="absolute left-4 top-1/2 -translate-y-1/2 size-11 grid place-items-center bg-white/90 hover:bg-white border border-ink-200 transition-colors z-10 rounded-full"
          >
            <ChevronLeft className="size-5 text-ink-900" strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            className="absolute right-4 top-1/2 -translate-y-1/2 size-11 grid place-items-center bg-white/90 hover:bg-white border border-ink-200 transition-colors z-10 rounded-full"
          >
            <ChevronRight className="size-5 text-ink-900" strokeWidth={2} />
          </button>

          <div className="absolute bottom-5 right-6 flex items-center gap-2 z-10">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`h-1.5 transition-all rounded-full ${
                  i === 0 ? 'w-8 bg-white' : 'w-1.5 bg-white/50'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
