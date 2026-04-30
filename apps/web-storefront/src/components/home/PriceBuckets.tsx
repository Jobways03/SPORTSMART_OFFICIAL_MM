import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const BUCKETS = [
  { under: 499, href: '/products?priceMax=499', tone: 'sale' },
  { under: 999, href: '/products?priceMax=999', tone: 'navy' },
  { under: 1499, href: '/products?priceMax=1499', tone: 'accent' },
  { under: 1999, href: '/products?priceMax=1999', tone: 'gold' },
] as const;

const TONE_CARD = {
  sale: 'bg-gradient-to-br from-sale to-sale-dark text-white',
  navy: 'bg-gradient-to-br from-navy to-navy-light text-white',
  accent: 'bg-gradient-to-br from-accent to-accent-dark text-white',
  gold: 'bg-gradient-to-br from-gold to-gold-dark text-ink-900',
} as const;

const formatINR = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export function PriceBuckets() {
  return (
    <section className="container-x py-8 sm:py-12">
      <h2 className="font-display text-h2 sm:text-h1 text-ink-900 mb-6">
        Pick what you love, at your price!
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {BUCKETS.map((b) => {
          const isGold = b.tone === 'gold';
          return (
            <Link
              key={b.under}
              href={b.href}
              className={`group relative overflow-hidden aspect-square rounded-2xl ${TONE_CARD[b.tone]} transition-transform hover:scale-[1.01]`}
            >
              <span
                aria-hidden
                className={`absolute -right-8 -bottom-12 font-brush text-[clamp(140px,20vw,280px)] leading-none italic ${
                  isGold ? 'text-ink-900/15' : 'text-white/15'
                } pointer-events-none`}
              >
                ₹
              </span>

              <div className="relative h-full flex flex-col justify-between p-6 sm:p-8">
                <div>
                  <div
                    className={`text-caption uppercase tracking-[0.2em] font-bold ${
                      isGold ? 'text-ink-900/70' : 'text-white/80'
                    }`}
                  >
                    Under
                  </div>
                  <div className="mt-2 font-display text-[clamp(40px,5.5vw,72px)] leading-none tabular">
                    {formatINR(b.under)}
                  </div>
                </div>

                <div
                  className={`inline-flex items-center gap-1.5 self-start h-9 px-4 text-body font-semibold ${
                    isGold
                      ? 'bg-ink-900 text-white'
                      : 'bg-white text-ink-900'
                  } rounded-full transition-transform group-hover:translate-x-1`}
                >
                  Explore now
                  <ArrowRight className="size-3.5" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
