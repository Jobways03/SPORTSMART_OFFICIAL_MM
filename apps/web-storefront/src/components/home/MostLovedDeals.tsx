import { MediaTile } from '@/components/ui/MediaTile';
import type {
  StorefrontContentMap,
  StorefrontSlotDefinition,
} from '@/lib/storefront-content';

interface DealExtras {
  headline?: string;
  price?: string;
  priceCaption?: string;
}

const EXTRAS: Record<string, DealExtras> = {
  'deal-goggles':   { headline: 'Goggles, Caps & More', price: '₹99',  priceCaption: 'Onwards' },
  'deal-backpacks': { headline: 'Hiking Backpacks',     price: '₹299', priceCaption: 'Onwards' },
  'deal-jackets':   { headline: 'Light Jackets',        price: '₹599', priceCaption: 'Onwards' },
  'deal-carrom':    { headline: 'Carrom Boards',        price: '₹329', priceCaption: 'Onwards' },
};

interface Props {
  content?: StorefrontContentMap;
  slots?: StorefrontSlotDefinition[];
}

export function MostLovedDeals({ content = {}, slots = [] }: Props) {
  if (slots.length === 0) return null;
  return (
    <section className="container-x py-8 sm:py-12">
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-2 text-caption uppercase tracking-[0.18em] font-semibold">
          <span className="text-sale-600">●</span>
          <span className="text-ink-600">Top discounts</span>
        </div>
        <h2 className="mt-1 font-display text-h2 sm:text-h1 text-ink-900 leading-[1.05] tracking-tight">
          Most loved deals. Too good to miss.
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
