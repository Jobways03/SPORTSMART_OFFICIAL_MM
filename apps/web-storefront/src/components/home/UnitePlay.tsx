import { MediaTile } from '@/components/ui/MediaTile';

const TILES = [
  {
    slot: 'play-swim',
    headline: 'Chlorine-Resistant Swimwear',
    price: '₹499',
    priceCaption: 'Onwards',
    href: '/products?category=swimwear',
  },
  {
    slot: 'play-volleyball',
    headline: 'Serve. Spike. Play.',
    price: '₹299',
    priceCaption: 'Onwards',
    href: '/products?category=volleyball',
  },
  {
    slot: 'play-polo',
    headline: 'Athletic Polo Tees',
    price: '₹299',
    priceCaption: 'Onwards',
    href: '/products?category=polos',
  },
  {
    slot: 'play-hockey',
    headline: 'Field Hockey Essentials',
    price: '₹299',
    priceCaption: 'Onwards',
    href: '/products?category=hockey',
  },
];

export function UnitePlay() {
  return (
    <section className="container-x py-8 sm:py-12">
      <h2 className="font-display text-h2 sm:text-h1 text-ink-900 mb-6">
        Unite & play. Shop sports gear.
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {TILES.map((t) => (
          <MediaTile
            key={t.slot}
            slotName={t.slot}
            href={t.href}
            aspect="1/1"
            tone="dark"
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
