import { MediaTile } from '@/components/ui/MediaTile';

const TILES = [
  {
    slot: 'champ-running',
    headline: 'Own Every Step',
    price: '₹999',
    priceCaption: 'Onwards',
    href: '/products?category=running-shoes',
    tone: 'dark' as const,
  },
  {
    slot: 'champ-bikes',
    headline: 'Trail Ready Bikes',
    price: '₹6,499',
    priceCaption: 'Onwards',
    href: '/products?category=bikes',
    tone: 'dark' as const,
  },
  {
    slot: 'champ-skating',
    headline: 'Glide With Confidence',
    price: '₹1,099',
    priceCaption: 'Onwards',
    href: '/products?category=skating',
    tone: 'dark' as const,
  },
  {
    slot: 'champ-basketball',
    headline: 'Practice Makes Points',
    price: '₹699',
    priceCaption: 'Onwards',
    href: '/products?category=basketball',
    tone: 'dark' as const,
  },
];

export function EquippingChampions() {
  return (
    <section className="container-x py-8 sm:py-12">
      <h2 className="font-display text-h2 sm:text-h1 text-ink-900 mb-6">
        Equipping champions
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {TILES.map((t) => (
          <MediaTile
            key={t.slot}
            slotName={t.slot}
            href={t.href}
            aspect="1/1"
            tone={t.tone}
            align="bottom-left"
            headline={t.headline}
            headlineSize="md"
            price={t.price}
            priceCaption={t.priceCaption}
          />
        ))}
      </div>
    </section>
  );
}
