import { MediaTile } from '@/components/ui/MediaTile';
import type {
  StorefrontContentMap,
  StorefrontSlotDefinition,
} from '@/lib/storefront-content';

interface PromoExtras {
  discount?: string;
}
interface BrandExtras {
  off?: string;
}

const PROMO_EXTRAS: Record<string, PromoExtras> = {
  'promo-flexnest': { discount: 'Upto 60% OFF' },
  'promo-powermax': { discount: '50% OFF' },
  'promo-coleman':  { discount: 'Upto 50% OFF' },
  'promo-lifelong': { discount: 'Upto 60% OFF' },
};

const BRAND_EXTRAS: Record<string, BrandExtras> = {
  'brand-adidas':    { off: 'Upto 50% OFF' },
  'brand-intex':     { off: 'Upto 20% OFF' },
  'brand-flexnest':  { off: 'Upto 50% OFF' },
  'brand-seasummit': { off: 'Upto 25% OFF' },
  'brand-coros':     { off: 'Upto 15% OFF' },
  'brand-wtb':       { off: 'Upto 15% OFF' },
  'brand-lifestraw': { off: 'Upto 10% OFF' },
};

interface Props {
  content?: StorefrontContentMap;
  partnerSlots?: StorefrontSlotDefinition[];
  brandSlots?: StorefrontSlotDefinition[];
}

export function PartnerBrands({
  content = {},
  partnerSlots = [],
  brandSlots = [],
}: Props) {
  if (partnerSlots.length === 0 && brandSlots.length === 0) return null;
  return (
    <section className="container-x py-10 sm:py-14">
      <div className="mb-6 sm:mb-8">
        <div className="text-caption uppercase tracking-[0.18em] text-ink-600 font-semibold">
          Official partners
        </div>
        <h2 className="mt-1 font-display text-h2 sm:text-h1 text-ink-900 leading-[1.05] tracking-tight">
          Explore partner brands
        </h2>
      </div>

      {partnerSlots.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-10">
          {partnerSlots.map((p) => {
            const override = content[p.slotKey];
            const extras = PROMO_EXTRAS[p.slotKey];
            const fallbackHref = p.defaultHref ?? '/products';
            return (
              <MediaTile
                key={p.id}
                slotName={p.slotKey}
                imageSrc={override?.imageUrl ?? undefined}
                aspect="1/1"
                align="center"
                headline={override?.headline ?? p.label}
                headlineSize="lg"
                eyebrow={override?.eyebrow ?? extras?.discount}
                eyebrowTone="sale"
                href={override?.ctaHref || fallbackHref}
                price={override?.price ?? undefined}
                priceCaption={override?.priceCaption ?? undefined}
              />
            );
          })}
        </div>
      )}

      {brandSlots.length > 0 && (
        <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-3 sm:gap-4">
          {brandSlots.map((b) => {
            const override = content[b.slotKey];
            const extras = BRAND_EXTRAS[b.slotKey];
            const fallbackHref =
              b.defaultHref ??
              `/products?brand=${encodeURIComponent(b.label.toLowerCase())}`;
            return (
              <li key={b.id}>
                <MediaTile
                  slotName={b.slotKey}
                  imageSrc={override?.imageUrl ?? undefined}
                  aspect="1/1"
                  align="bottom-left"
                  headline={override?.headline ?? b.label}
                  headlineSize="sm"
                  subhead={override?.subhead ?? extras?.off}
                  href={override?.ctaHref || fallbackHref}
                  price={override?.price ?? undefined}
                  priceCaption={override?.priceCaption ?? undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
