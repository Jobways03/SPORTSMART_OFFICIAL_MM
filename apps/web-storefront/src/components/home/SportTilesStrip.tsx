import { MediaTile } from '@/components/ui/MediaTile';
import type {
  StorefrontContentMap,
  StorefrontSlotDefinition,
} from '@/lib/storefront-content';

interface Props {
  content?: StorefrontContentMap;
  slots?: StorefrontSlotDefinition[];
}

export function SportTilesStrip({ content = {}, slots = [] }: Props) {
  if (slots.length === 0) return null;
  return (
    <section aria-label="Shop by sport" className="container-x py-8 sm:py-12">
      <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {slots.map((s) => {
          const override = content[s.slotKey];
          const fallbackHref =
            s.defaultHref ?? `/products?sport=${encodeURIComponent(s.label.toLowerCase())}`;
          return (
            <li key={s.id}>
              <MediaTile
                slotName={s.slotKey}
                imageSrc={override?.imageUrl ?? undefined}
                href={override?.ctaHref || fallbackHref}
                aspect="1/1"
                tone="dark"
                align="bottom-left"
                headline={override?.headline ?? s.label}
                headlineSize="sm"
                price={override?.price ?? undefined}
                priceCaption={override?.priceCaption ?? undefined}
                contentClassName="!p-3 sm:!p-4"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
