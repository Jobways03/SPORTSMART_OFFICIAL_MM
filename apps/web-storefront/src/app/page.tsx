import { StorefrontShell } from '@/components/layout/StorefrontShell';
import { Hero } from '@/components/home/Hero';
import { SportTilesStrip } from '@/components/home/SportTilesStrip';
import { EquippingChampions } from '@/components/home/EquippingChampions';
import { HorizontalProductCarousel } from '@/components/home/HorizontalProductCarousel';
import { MostLovedDeals } from '@/components/home/MostLovedDeals';
import { BannerPromo } from '@/components/home/BannerPromo';
import { PriceBuckets } from '@/components/home/PriceBuckets';
import { UnitePlay } from '@/components/home/UnitePlay';
import { PartnerBrands } from '@/components/home/PartnerBrands';
import { ValueProps } from '@/components/home/ValueProps';

export default function HomePage() {
  return (
    <StorefrontShell>
      <Hero />
      <SportTilesStrip />
      <EquippingChampions />

      <HorizontalProductCarousel
        eyebrow="Just in"
        title="Shop your Workout Checklist"
        subtitle="Fresh arrivals from the brands you love."
        query="sortBy=newest"
        ctaHref="/products?sortBy=newest"
      />

      <MostLovedDeals />

      <BannerPromo
        slot="banner-tennis"
        eyebrow="Court setup"
        headline="Grip, Strings & Bags."
        subhead="Complete your court setup."
        price="₹99"
        priceCaption="Onwards"
        ctaHref="/products?sport=tennis"
        withCarouselUI
      />

      <PriceBuckets />

      <HorizontalProductCarousel
        eyebrow="Explore Our Best Of"
        title="Cycling & Skating"
        subtitle="Wheels, helmets, pads — built for the road and the rink."
        query="sport=cycling"
        ctaHref="/products?sport=cycling"
      />

      <UnitePlay />

      <HorizontalProductCarousel
        eyebrow="Near you"
        title="Trending near you"
        subtitle="What everyone's reaching for this week."
        query="sortBy=popular"
        ctaHref="/products?sortBy=popular"
      />

      <PartnerBrands />

      <ValueProps />
    </StorefrontShell>
  );
}
