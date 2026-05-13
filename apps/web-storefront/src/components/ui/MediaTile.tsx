import Link from 'next/link';
import { Image as ImageIcon } from 'lucide-react';

type Tone = 'gray' | 'dark' | 'sale' | 'gold' | 'teal' | 'navy' | 'peach';
type Align = 'top-left' | 'center' | 'bottom-left';

/**
 * Demo fallback: when a tile has no `imageSrc` (which is the default
 * for every hardcoded slot until an admin uploads real product imagery
 * via Storefront Content → Cloudinary), serve a curated, sport-themed
 * Unsplash photo per slot. Each URL below was verified to return 200.
 *
 * Replace any tile with a real Cloudinary URL by passing `imageSrc`
 * directly to <MediaTile>.
 */
const UNSPLASH = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=1400&q=80&auto=format&fit=crop`;

const SLOT_IMAGES: Record<string, string> = {
  // Hero slides — broad athletic / fitness shots
  'hero-slide-1': UNSPLASH('1571019613454-1cb2f99b2d8b'),
  'hero-slide-2': UNSPLASH('1517649763962-0c623066013b'),
  'hero-slide-3': UNSPLASH('1554068865-24cecd4e34b8'),

  // Sport tiles strip — one specific photo per discipline
  'sport-running':   UNSPLASH('1542291026-7eec264c27ff'),
  'sport-cricket':   UNSPLASH('1531415074968-036ba1b575da'),
  'sport-football':  UNSPLASH('1530549387789-4c1017266635'),
  'sport-badminton': UNSPLASH('1571902943202-507ec2618e8f'),
  'sport-tennis':    UNSPLASH('1622279457486-62dcc4a431d6'),
  'sport-skating':   UNSPLASH('1518608774889-b04d2abe7702'),
  'sport-cycling':   UNSPLASH('1517649763962-0c623066013b'),
  'sport-gym':       UNSPLASH('1518611012118-696072aa579a'),

  // Equipping champions
  'champ-running':    UNSPLASH('1554068865-24cecd4e34b8'),
  'champ-bikes':      UNSPLASH('1547347298-4074fc3086f0'),
  'champ-skating':    UNSPLASH('1530143584546-02191bc84eb5'),
  'champ-basketball': UNSPLASH('1546519638-68e109498ffc'),

  // Most loved deals
  'deal-goggles':   UNSPLASH('1564769662533-4f00a87b4056'),
  'deal-backpacks': UNSPLASH('1551698618-1dfe5d97d256'),
  'deal-jackets':   UNSPLASH('1599481238640-4c1288750d7a'),
  'deal-carrom':    UNSPLASH('1565992441121-4367c2967103'),

  // Banner promo
  'banner-tennis':  UNSPLASH('1531315396756-905d68d21b56'),
  'banner-cycling': UNSPLASH('1517649763962-0c623066013b'),
  'banner-gym':     UNSPLASH('1518611012118-696072aa579a'),

  // Unite & play
  'play-swim':       UNSPLASH('1564769662533-4f00a87b4056'),
  'play-volleyball': UNSPLASH('1530143311094-34d807799e8f'),
  'play-polo':       UNSPLASH('1599566150163-29194dcaad36'),
  'play-hockey':     UNSPLASH('1486218119243-13883505764c'),

  // Partner brand promo strip
  'promo-flexnest':  UNSPLASH('1556909114-f6e7ad7d3136'),
  'promo-powermax':  UNSPLASH('1576678927484-cc907957088c'),
  'promo-coleman':   UNSPLASH('1502904550040-7534597429ae'),
  'promo-lifelong':  UNSPLASH('1518604666860-9ed391f76460'),

  // Brand chips — use a uniform athletic neutral so the logo+CTA reads
  // without competing with photography
  'brand-adidas':    UNSPLASH('1517344884509-a0c97ec11bcc'),
  'brand-intex':     UNSPLASH('1517344884509-a0c97ec11bcc'),
  'brand-garmin':    UNSPLASH('1517344884509-a0c97ec11bcc'),
  'brand-flexnest':  UNSPLASH('1517344884509-a0c97ec11bcc'),
  'brand-seasummit': UNSPLASH('1517344884509-a0c97ec11bcc'),
  'brand-coros':     UNSPLASH('1517344884509-a0c97ec11bcc'),
  'brand-wtb':       UNSPLASH('1517344884509-a0c97ec11bcc'),
  'brand-lifestraw': UNSPLASH('1517344884509-a0c97ec11bcc'),
};

// Generic sport fallback for any slot not in SLOT_IMAGES yet.
const GENERIC_FALLBACK = UNSPLASH('1517649763962-0c623066013b');

function fallbackImageForSlot(slotName: string): string {
  return SLOT_IMAGES[slotName.toLowerCase()] ?? GENERIC_FALLBACK;
}

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
  // Demo: every tile gets a stable seeded picsum image when no real
  // imageSrc is supplied. Admin uploads via Storefront Content will
  // override by passing a real URL through imageSrc.
  const effectiveImageSrc = imageSrc ?? fallbackImageForSlot(slotName);

  // After fallback, every tile has an image — text reads on dark.
  const isDarkBg = true;
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
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{
        aspectRatio: aspect,
        backgroundImage: `url(${effectiveImageSrc})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: '#0F1115',
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-black/0"
      />
      {!imageSrc && (
        // Subtle dev-only badge so admins know the tile is using a
        // generic placeholder, not a real product image. Disappears
        // the moment a real imageSrc lands.
        <div className="absolute top-3 right-3 inline-flex items-center gap-1.5 px-2 py-1 bg-black/40 backdrop-blur-sm text-[10px] font-mono uppercase tracking-wider text-white/80 z-10 rounded-full">
          <ImageIcon className="size-3" strokeWidth={2} />
          placeholder
        </div>
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
