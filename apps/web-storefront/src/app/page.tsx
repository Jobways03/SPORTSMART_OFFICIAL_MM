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
import { BlogStrip } from '@/components/home/BlogStrip';
import { ValueProps } from '@/components/home/ValueProps';
import { getStorefrontContent, getStorefrontSlots } from '@/lib/storefront-content';

// Phase 3 — admin-managed storefront content. Fetched once per render
// pass. Threaded into every home component so each <MediaTile> can
// prefer admin imagery over the curated fallback. Slot definitions
// (which slots exist in each section) come from the same fetch so
// admins can add/remove tiles without a deploy.
export default async function HomePage() {
  const [content, slots] = await Promise.all([
    getStorefrontContent(),
    getStorefrontSlots(),
  ]);

  return (
    <StorefrontShell>
      <Hero content={content} slots={slots['hero'] ?? []} />
      <SportTilesStrip
        content={content}
        slots={slots['sport-tiles-strip'] ?? []}
      />
      <EquippingChampions
        content={content}
        slots={slots['equipping-champions'] ?? []}
      />

      <HorizontalProductCarousel
        eyebrow="Just in"
        title="Shop your Workout Checklist"
        subtitle="Fresh arrivals from the brands you love."
        query="sortBy=newest"
        ctaHref="/products?sortBy=newest"
      />

      <MostLovedDeals
        content={content}
        slots={slots['most-loved-deals'] ?? []}
      />

      <BannerPromo
        slot="banner-tennis"
        eyebrow="Court setup"
        headline="Grip, Strings & Bags."
        subhead="Complete your court setup."
        price="₹99"
        priceCaption="Onwards"
        ctaHref="/products?sport=tennis"
        withCarouselUI
        content={content}
      />

      <PriceBuckets />

      <HorizontalProductCarousel
        eyebrow="Explore Our Best Of"
        title="Cycling & Skating"
        subtitle="Wheels, helmets, pads — built for the road and the rink."
        query="sport=cycling"
        ctaHref="/products?sport=cycling"
      />

      <UnitePlay content={content} slots={slots['unite-play'] ?? []} />

      <HorizontalProductCarousel
        eyebrow="Near you"
        title="Trending near you"
        subtitle="What everyone's reaching for this week."
        query="sortBy=popular"
        ctaHref="/products?sortBy=popular"
      />

      <PartnerBrands
        content={content}
        partnerSlots={slots['partner-promos'] ?? []}
        brandSlots={slots['brand-chips'] ?? []}
      />

      <BlogStrip />

      <ValueProps />
    </StorefrontShell>
  );
}
