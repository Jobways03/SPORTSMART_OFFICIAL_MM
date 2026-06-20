import { MediaTile } from '@/components/ui/MediaTile';
import type {
  StorefrontContentMap,
  StorefrontSlotDefinition,
} from '@/lib/storefront-content';

interface TileExtras {
  price?: string;
  priceCaption?: string;
  headline?: string;
}

// Per-slot price treatment for the seeded slots. Admin-added slots
// render without price until the admin sets an eyebrow/subhead.
const EXTRAS: Record<string, TileExtras> = {
  'champ-running':    { headline: 'Own Every Step',       price: '₹999',   priceCaption: 'Onwards' },
  'champ-bikes':      { headline: 'Trail Ready Bikes',    price: '₹6,499', priceCaption: 'Onwards' },
  'champ-skating':    { headline: 'Glide With Confidence',price: '₹1,099', priceCaption: 'Onwards' },
  'champ-basketball': { headline: 'Practice Makes Points',price: '₹699',   priceCaption: 'Onwards' },
};

interface Props {
  content?: StorefrontContentMap;
  slots?: StorefrontSlotDefinition[];
}

export function EquippingChampions({ content = {}, slots = [] }: Props) {
  if (slots.length === 0) return null;
  return (
    <section className="container-x py-8 sm:py-12">
      <div className="mb-6 sm:mb-8">
        <div className="text-caption uppercase tracking-[0.18em] text-ink-600 font-semibold">
          Champion-grade gear
        </div>
        <h2 className="mt-1 font-display text-2xl sm:text-3xl text-ink-900 leading-[1.15] tracking-tight">
          Equipping champions
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
