import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

const SPORTS = [
  { name: 'Cricket', slug: 'cricket', kit: 'Bats · Pads · Helmets' },
  { name: 'Football', slug: 'football', kit: 'Boots · Jerseys · Balls' },
  { name: 'Running', slug: 'running', kit: 'Shoes · Apparel · Tracking' },
  { name: 'Badminton', slug: 'badminton', kit: 'Rackets · Shuttles · Shoes' },
  { name: 'Tennis', slug: 'tennis', kit: 'Rackets · Strings · Apparel' },
  { name: 'Yoga', slug: 'yoga', kit: 'Mats · Blocks · Activewear' },
];

export function CategoryGrid() {
  return (
    <section className="container-x py-16 sm:py-24">
      <div className="flex items-end justify-between gap-4 mb-8">
        <div>
          <h2 className="font-display text-h1 sm:text-5xl text-ink-900 leading-none">
            Shop by sport
          </h2>
          <p className="mt-2 text-body-lg text-ink-600">
            Hand-picked gear for every game.
          </p>
        </div>
        <Link
          href="/products"
          className="hidden sm:inline-flex items-center gap-1 text-body font-medium text-ink-900 hover:text-accent"
        >
          View all
          <ArrowUpRight className="size-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {SPORTS.map((sport, idx) => (
          <Link
            key={sport.slug}
            href={`/products?sport=${sport.slug}`}
            className="group relative aspect-[4/5] sm:aspect-[5/4] bg-ink-900 text-white overflow-hidden flex items-end p-6"
          >
            <div
              aria-hidden
              className="absolute inset-0 opacity-30 transition-opacity group-hover:opacity-50"
              style={{
                background: `linear-gradient(${idx % 2 === 0 ? '135deg' : '45deg'}, ${
                  idx % 3 === 0 ? '#3FA1AE' : idx % 3 === 1 ? '#DC2626' : '#FACC15'
                } 0%, transparent 70%)`,
              }}
            />
            <div
              aria-hidden
              className="absolute right-4 top-4 font-display text-[120px] sm:text-[160px] leading-none text-white/5 select-none pointer-events-none"
            >
              {String(idx + 1).padStart(2, '0')}
            </div>

            <div className="relative">
              <div className="text-caption uppercase tracking-[0.2em] text-ink-300">
                {sport.kit}
              </div>
              <div className="mt-1 font-display text-4xl sm:text-5xl leading-none">
                {sport.name}
              </div>
              <div className="mt-3 inline-flex items-center gap-1 text-body font-medium border-b border-white/40 pb-0.5 group-hover:border-white">
                Shop {sport.name.toLowerCase()}
                <ArrowUpRight className="size-3.5" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
