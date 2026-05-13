import { MediaTile } from '@/components/ui/MediaTile';
import type {
  StorefrontContentMap,
  StorefrontSlotDefinition,
} from '@/lib/storefront-content';

interface TileExtras {
  headline?: string;
  price?: string;
  priceCaption?: string;
}

const EXTRAS: Record<string, TileExtras> = {
  'play-swim':       { headline: 'Chlorine-Resistant Swimwear', price: '₹499', priceCaption: 'Onwards' },
  'play-volleyball': { headline: 'Serve. Spike. Play.',         price: '₹299', priceCaption: 'Onwards' },
  'play-polo':       { headline: 'Athletic Polo Tees',          price: '₹299', priceCaption: 'Onwards' },
  'play-hockey':     { headline: 'Field Hockey Essentials',     price: '₹299', priceCaption: 'Onwards' },
};

interface Props {
  content?: StorefrontContentMap;
  slots?: StorefrontSlotDefinition[];
}

export function UnitePlay({ content = {}, slots = [] }: Props) {
  if (slots.length === 0) return null;
  return (
    <section className="container-x py-8 sm:py-12">
      <div className="mb-6 sm:mb-8">
        <div className="text-caption uppercase tracking-[0.18em] text-ink-600 font-semibold">
          Multi-sport
        </div>
        <h2 className="mt-1 font-display text-h2 sm:text-h1 text-ink-900 leading-[1.05] tracking-tight">
          Unite & play. Shop sports gear.
        </h2>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {slots.map((s) => {
          const override = content[s.slotKey];
          const extras = EXTRAS[s.slotKey];
          const fallbackHref = s.defaultHref ?? '/products';
          return (
            <MediaTile
              key={s.id}
              slotName={s.slotKey}
              imageSrc={override?.imageUrl ?? undefined}
              href={override?.ctaHref || fallbackHref}
              aspect="1/1"
              tone="dark"
              align="bottom-left"
              headline={override?.headline ?? extras?.headline ?? s.label}
              headlineSize="md"
              subhead={override?.subhead ?? undefined}
              price={override?.price ?? extras?.price}
              priceCaption={override?.priceCaption ?? extras?.priceCaption}
            />
          );
        })}
      </div>
    </section>
  );
}
