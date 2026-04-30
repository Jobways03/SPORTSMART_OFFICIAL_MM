import { MediaTile } from '@/components/ui/MediaTile';

const SPORTS = [
  { slot: 'sport-running', label: 'Running', href: '/products?sport=running' },
  { slot: 'sport-cricket', label: 'Cricket', href: '/products?sport=cricket' },
  { slot: 'sport-football', label: 'Football', href: '/products?sport=football' },
  { slot: 'sport-badminton', label: 'Badminton', href: '/products?sport=badminton' },
  { slot: 'sport-tennis', label: 'Tennis', href: '/products?sport=tennis' },
  { slot: 'sport-skating', label: 'Skating', href: '/products?sport=skating' },
  { slot: 'sport-cycling', label: 'Cycling', href: '/products?sport=cycling' },
  { slot: 'sport-gym', label: 'Gym', href: '/products?sport=gym' },
];

export function SportTilesStrip() {
  return (
    <section aria-label="Shop by sport" className="container-x py-8 sm:py-12">
      <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {SPORTS.map((s) => (
          <li key={s.slot}>
            <MediaTile
              slotName={s.slot}
              href={s.href}
              aspect="1/1"
              tone="dark"
              align="bottom-left"
              headline={s.label}
              headlineSize="sm"
              contentClassName="!p-3 sm:!p-4"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
