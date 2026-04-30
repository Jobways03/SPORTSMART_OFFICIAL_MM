import { MediaTile } from '@/components/ui/MediaTile';

const DEALS = [
  {
    slot: 'deal-goggles',
    headline: 'Goggles, Caps & More',
    price: '₹99',
    priceCaption: 'Onwards',
    href: '/products?category=swim-accessories',
  },
  {
    slot: 'deal-backpacks',
    headline: 'Hiking Backpacks',
    price: '₹299',
    priceCaption: 'Onwards',
    href: '/products?category=backpacks',
  },
  {
    slot: 'deal-jackets',
    headline: 'Light Jackets',
    price: '₹599',
    priceCaption: 'Onwards',
    href: '/products?category=jackets',
  },
  {
    slot: 'deal-carrom',
    headline: 'Carrom Boards',
    price: '₹329',
    priceCaption: 'Onwards',
    href: '/products?category=indoor-games',
  },
];

export function MostLovedDeals() {
  return (
    <section className="container-x py-8 sm:py-12">
      <h2 className="font-display text-h2 sm:text-h1 text-ink-900 mb-6">
        Most loved deals! Too good to miss.
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {DEALS.map((d) => (
          <MediaTile
            key={d.slot}
            slotName={d.slot}
            href={d.href}
            aspect="1/1"
            tone="dark"
            align="bottom-left"
            headline={d.headline}
            headlineSize="md"
            price={d.price}
            priceCaption={d.priceCaption}
          />
        ))}
      </div>
    </section>
  );
}
