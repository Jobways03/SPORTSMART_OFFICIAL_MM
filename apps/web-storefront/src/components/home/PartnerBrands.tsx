import Link from 'next/link';
import { Image as ImageIcon } from 'lucide-react';

const PROMOS = [
  {
    slot: 'promo-flexnest',
    brand: 'Flexnest',
    discount: 'Upto 60% OFF',
    href: '/products?brand=flexnest',
  },
  {
    slot: 'promo-powermax',
    brand: 'PowerMax',
    discount: '50% OFF',
    href: '/products?brand=powermax',
  },
  {
    slot: 'promo-coleman',
    brand: 'Coleman',
    discount: 'Upto 50% OFF',
    href: '/products?brand=coleman',
  },
  {
    slot: 'promo-lifelong',
    brand: 'Lifelong',
    discount: 'Upto 60% OFF',
    href: '/products?brand=lifelong',
  },
];

const BRANDS = [
  { slot: 'brand-adidas', name: 'Adidas', off: 'Upto 50% OFF' },
  { slot: 'brand-intex', name: 'Intex', off: 'Upto 20% OFF' },
  { slot: 'brand-garmin', name: 'Garmin' },
  { slot: 'brand-flexnest', name: 'Flexnest', off: 'Upto 50% OFF' },
  { slot: 'brand-seasummit', name: 'Sea to Summit', off: 'Upto 25% OFF' },
  { slot: 'brand-coros', name: 'Coros', off: 'Upto 15% OFF' },
  { slot: 'brand-wtb', name: 'WTB', off: 'Upto 15% OFF' },
  { slot: 'brand-lifestraw', name: 'Lifestraw', off: 'Upto 10% OFF' },
];

export function PartnerBrands() {
  return (
    <section className="container-x py-10 sm:py-14">
      <h2 className="font-display text-h2 sm:text-h1 text-ink-900 mb-6">
        Explore partner brands
      </h2>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-10">
        {PROMOS.map((p) => (
          <Link
            key={p.slot}
            href={p.href}
            className="group relative overflow-hidden aspect-square rounded-2xl bg-gradient-to-br from-ink-100 via-ink-200 to-ink-300"
          >
            <div
              aria-hidden
              className="absolute inset-3 border-2 border-dashed border-ink-400/40 rounded-xl"
            />
            <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2 py-1 bg-white/85 backdrop-blur-sm border border-ink-300 text-[10px] font-mono uppercase tracking-wider text-ink-700 rounded-full">
              <ImageIcon className="size-3" strokeWidth={2} />
              {p.slot}
            </div>

            <div className="relative h-full flex flex-col items-center justify-center p-6 text-center">
              <div className="font-display text-2xl sm:text-3xl text-ink-900">
                {p.brand}
              </div>
              <div className="mt-3 inline-flex items-center h-7 px-3 bg-sale text-white text-caption font-bold uppercase tracking-wider rounded-full">
                {p.discount}
              </div>
            </div>
          </Link>
        ))}
      </div>

      <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
        {BRANDS.map((b) => (
          <li key={b.slot}>
            <Link
              href={`/products?brand=${encodeURIComponent(b.name)}`}
              className="group block"
            >
              <div
                className="relative overflow-hidden aspect-square rounded-2xl bg-gradient-to-br from-ink-100 via-ink-200 to-ink-300"
              >
                <div
                  aria-hidden
                  className="absolute inset-2 border-2 border-dashed border-ink-400/40 rounded-xl"
                />
                <div className="absolute top-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/85 backdrop-blur-sm border border-ink-300 text-[9px] font-mono uppercase tracking-wider text-ink-700 rounded-full">
                  <ImageIcon className="size-2.5" strokeWidth={2} />
                  {b.slot}
                </div>

                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[88%] text-center">
                  <div className="text-body font-bold text-ink-900 truncate">
                    {b.name}
                  </div>
                  {b.off && (
                    <div className="text-[10px] uppercase tracking-wider text-ink-700 font-semibold mt-0.5">
                      {b.off}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
