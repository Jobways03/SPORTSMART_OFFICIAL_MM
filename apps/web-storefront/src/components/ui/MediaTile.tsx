import Link from 'next/link';
import { Image as ImageIcon } from 'lucide-react';

type Tone = 'gray' | 'dark' | 'sale' | 'gold' | 'teal' | 'navy' | 'peach';
type Align = 'top-left' | 'center' | 'bottom-left';

interface MediaTileProps {
  imageSrc?: string | null;
  slotName: string;
  aspect?: string;
  tone?: Tone;
  align?: Align;

  eyebrow?: string;
  eyebrowTone?: 'sale' | 'gold' | 'white';
  headline?: string;
  headlineSize?: 'sm' | 'md' | 'lg' | 'xl';
  subhead?: string;
  price?: string;
  priceCaption?: string;
  cta?: { label: string; href: string };

  href?: string;
  className?: string;
  contentClassName?: string;
}

const TONE_BG: Record<Tone, string> = {
  gray: 'bg-gradient-to-br from-ink-100 via-ink-200 to-ink-300',
  dark: 'bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900',
  sale: 'bg-gradient-to-br from-sale-soft via-sale-light to-sale',
  gold: 'bg-gradient-to-br from-gold-soft via-gold-light to-gold',
  teal: 'bg-gradient-to-br from-accent-soft via-accent-light to-accent',
  navy: 'bg-gradient-to-br from-navy-soft via-navy-light to-navy',
  peach: 'bg-gradient-to-br from-peach via-peach-dark to-peach-deep',
};

const HEADLINE_SIZE = {
  sm: 'text-[clamp(20px,2.2vw,32px)]',
  md: 'text-[clamp(28px,3vw,44px)]',
  lg: 'text-[clamp(36px,4vw,60px)]',
  xl: 'text-[clamp(48px,6vw,96px)]',
};

export function MediaTile({
  imageSrc,
  slotName,
  aspect = '1/1',
  tone = 'gray',
  align = 'bottom-left',
  eyebrow,
  eyebrowTone = 'white',
  headline,
  headlineSize = 'md',
  subhead,
  price,
  priceCaption,
  cta,
  href,
  className = '',
  contentClassName = '',
}: MediaTileProps) {
  const isDarkBg = tone === 'dark' || tone === 'navy' || tone === 'sale' || imageSrc;
  const baseTextColor = isDarkBg ? 'text-white' : 'text-ink-900';
  const mutedTextColor = isDarkBg ? 'text-white/85' : 'text-ink-600';

  const eyebrowClasses = {
    sale: 'bg-sale text-white',
    gold: 'bg-gold text-ink-900',
    white: 'bg-white text-ink-900',
  }[eyebrowTone];

  const alignClasses = {
    'top-left': 'justify-start items-start text-left',
    'center': 'justify-center items-center text-center',
    'bottom-left': 'justify-end items-start text-left',
  }[align];

  const inner = (
    <div
      className={`relative overflow-hidden rounded-2xl ${imageSrc ? '' : TONE_BG[tone]} ${className}`}
      style={{
        aspectRatio: aspect,
        ...(imageSrc
          ? {
              backgroundImage: `url(${imageSrc})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : {}),
      }}
    >
      {!imageSrc && (
        <>
          <div
            aria-hidden
            className="absolute inset-3 border-2 border-dashed border-ink-400/40 rounded-xl"
          />
          <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2 py-1 bg-white/85 backdrop-blur-sm border border-ink-300 text-[10px] font-mono uppercase tracking-wider text-ink-700 z-10 rounded-full">
            <ImageIcon className="size-3" strokeWidth={2} />
            {slotName}
          </div>
        </>
      )}

      {imageSrc && (
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-black/0"
        />
      )}

      <div
        className={`relative h-full flex flex-col p-5 sm:p-7 lg:p-9 gap-3 ${alignClasses} ${contentClassName}`}
      >
        {eyebrow && (
          <span
            className={`inline-flex items-center h-6 px-2.5 ${eyebrowClasses} text-[10px] uppercase tracking-[0.18em] font-bold rounded-full`}
          >
            {eyebrow}
          </span>
        )}

        {headline && (
          <h3
            className={`font-display ${HEADLINE_SIZE[headlineSize]} leading-[0.95] tracking-tight ${baseTextColor}`}
          >
            {headline}
          </h3>
        )}

        {subhead && (
          <p className={`text-body sm:text-body-lg leading-snug ${mutedTextColor}`}>
            {subhead}
          </p>
        )}

        {price && (
          <div className="flex items-baseline gap-2 tabular">
            <span className={`font-display text-3xl sm:text-4xl ${baseTextColor}`}>
              {price}
            </span>
            {priceCaption && (
              <span className={`text-caption ${mutedTextColor}`}>{priceCaption}</span>
            )}
          </div>
        )}

        {cta && (
          <Link
            href={cta.href}
            className={`mt-1 inline-flex items-center gap-2 h-10 px-5 font-semibold text-body transition-colors rounded-full ${
              isDarkBg
                ? 'bg-white text-ink-900 hover:bg-ink-100'
                : 'bg-ink-900 text-white hover:bg-ink-800'
            }`}
          >
            {cta.label}
          </Link>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="group block focus-visible:outline-none">
        {inner}
      </Link>
    );
  }
  return inner;
}
