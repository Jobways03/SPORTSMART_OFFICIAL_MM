import Link from 'next/link';
import { SPORTS } from '@/data/navMenu';

/**
 * Generic athlete-in-motion silhouette used as a decorative motif next to
 * each sport name. Same icon for every sport, intentional — keeps the strip
 * coherent. Could be swapped for sport-specific glyphs later.
 */
const RunMotif = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="20" cy="6.5" r="2" />
    <path d="M21 11l-2.5 5 3 3v5" />
    <path d="M18.5 16l-5 1-2 4" />
    <path d="M10 14l-2 4" />
    <path d="M21 14l4 2" />
  </svg>
);

export function SportStrip() {
  // Doubled list creates a long marquee track. CSS animation pulls left.
  const items = [...SPORTS, ...SPORTS];

  return (
    <section
      aria-label="Shop by sport"
      className="bg-ink-100 border-y border-ink-200 overflow-hidden"
    >
      <div className="relative flex animate-marquee gap-12 py-5 whitespace-nowrap">
        {items.map((s, idx) => (
          <Link
            key={`${s.slug}-${idx}`}
            href={`/products?sport=${s.slug}`}
            className="group flex items-center gap-3 text-ink-900 hover:text-accent-dark transition-colors shrink-0"
          >
            <RunMotif className="size-7 text-ink-700 group-hover:text-accent-dark transition-colors" />
            <span className="font-display text-3xl tracking-wide leading-none">
              {s.name.toUpperCase()}
            </span>
            <span className="size-1.5 bg-ink-400 rounded-full" />
          </Link>
        ))}
      </div>
    </section>
  );
}
