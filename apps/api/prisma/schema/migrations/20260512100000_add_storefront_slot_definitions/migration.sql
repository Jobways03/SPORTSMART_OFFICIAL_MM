-- Admin-editable slot registry for storefront sections. Seeded with the
-- 38 system slots that the storefront's home components currently
-- hardcode so existing pages keep rendering unchanged.

CREATE TABLE "storefront_slot_definitions" (
  "id"            TEXT NOT NULL,
  "section_key"   TEXT NOT NULL,
  "slot_key"      TEXT NOT NULL,
  "label"         TEXT NOT NULL,
  "position"      INTEGER NOT NULL DEFAULT 0,
  "default_href"  TEXT,
  "is_system"     BOOLEAN NOT NULL DEFAULT false,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "storefront_slot_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storefront_slot_definitions_slot_key_key"
  ON "storefront_slot_definitions"("slot_key");
CREATE INDEX "storefront_slot_definitions_section_key_position_idx"
  ON "storefront_slot_definitions"("section_key", "position");

-- Seed the 38 system slots.
INSERT INTO "storefront_slot_definitions"
  (id, section_key, slot_key, label, position, default_href, is_system, updated_at)
VALUES
  -- Hero
  (gen_random_uuid(), 'hero', 'hero-slide-1', 'Hero slide 1', 1, NULL, true, NOW()),
  (gen_random_uuid(), 'hero', 'hero-slide-2', 'Hero slide 2', 2, NULL, true, NOW()),
  (gen_random_uuid(), 'hero', 'hero-slide-3', 'Hero slide 3', 3, NULL, true, NOW()),
  -- Sport tiles strip
  (gen_random_uuid(), 'sport-tiles-strip', 'sport-running',   'Running',   1, '/products?sport=running',   true, NOW()),
  (gen_random_uuid(), 'sport-tiles-strip', 'sport-cricket',   'Cricket',   2, '/products?sport=cricket',   true, NOW()),
  (gen_random_uuid(), 'sport-tiles-strip', 'sport-football',  'Football',  3, '/products?sport=football',  true, NOW()),
  (gen_random_uuid(), 'sport-tiles-strip', 'sport-badminton', 'Badminton', 4, '/products?sport=badminton', true, NOW()),
  (gen_random_uuid(), 'sport-tiles-strip', 'sport-tennis',    'Tennis',    5, '/products?sport=tennis',    true, NOW()),
  (gen_random_uuid(), 'sport-tiles-strip', 'sport-skating',   'Skating',   6, '/products?sport=skating',   true, NOW()),
  (gen_random_uuid(), 'sport-tiles-strip', 'sport-cycling',   'Cycling',   7, '/products?sport=cycling',   true, NOW()),
  (gen_random_uuid(), 'sport-tiles-strip', 'sport-gym',       'Gym',       8, '/products?sport=gym',       true, NOW()),
  -- Equipping Champions
  (gen_random_uuid(), 'equipping-champions', 'champ-running',    'Own every step',     1, '/products?category=running-shoes', true, NOW()),
  (gen_random_uuid(), 'equipping-champions', 'champ-bikes',      'Trail-ready bikes',  2, '/products?category=bikes',         true, NOW()),
  (gen_random_uuid(), 'equipping-champions', 'champ-skating',    'Glide with confidence', 3, '/products?category=skating',    true, NOW()),
  (gen_random_uuid(), 'equipping-champions', 'champ-basketball', 'Practice makes points', 4, '/products?category=basketball', true, NOW()),
  -- Most Loved Deals
  (gen_random_uuid(), 'most-loved-deals', 'deal-goggles',   'Goggles, caps & more', 1, '/products?category=swim-accessories', true, NOW()),
  (gen_random_uuid(), 'most-loved-deals', 'deal-backpacks', 'Hiking backpacks',     2, '/products?category=backpacks',        true, NOW()),
  (gen_random_uuid(), 'most-loved-deals', 'deal-jackets',   'Light jackets',        3, '/products?category=jackets',          true, NOW()),
  (gen_random_uuid(), 'most-loved-deals', 'deal-carrom',    'Carrom boards',        4, '/products?category=indoor-games',     true, NOW()),
  -- Banner promo
  (gen_random_uuid(), 'banner-promo', 'banner-tennis',  'Banner — Tennis',  1, '/products?sport=tennis',  true, NOW()),
  (gen_random_uuid(), 'banner-promo', 'banner-cycling', 'Banner — Cycling', 2, '/products?sport=cycling', true, NOW()),
  (gen_random_uuid(), 'banner-promo', 'banner-gym',     'Banner — Gym',     3, '/products?sport=gym',     true, NOW()),
  -- Unite & Play
  (gen_random_uuid(), 'unite-play', 'play-swim',       'Chlorine-resistant swimwear', 1, '/products?category=swimwear',   true, NOW()),
  (gen_random_uuid(), 'unite-play', 'play-volleyball', 'Serve. Spike. Play.',         2, '/products?category=volleyball', true, NOW()),
  (gen_random_uuid(), 'unite-play', 'play-polo',       'Athletic polo tees',          3, '/products?category=polos',      true, NOW()),
  (gen_random_uuid(), 'unite-play', 'play-hockey',     'Field hockey essentials',     4, '/products?category=hockey',     true, NOW()),
  -- Partner promos
  (gen_random_uuid(), 'partner-promos', 'promo-flexnest', 'Flexnest', 1, '/products?brand=flexnest', true, NOW()),
  (gen_random_uuid(), 'partner-promos', 'promo-powermax', 'PowerMax', 2, '/products?brand=powermax', true, NOW()),
  (gen_random_uuid(), 'partner-promos', 'promo-coleman',  'Coleman',  3, '/products?brand=coleman',  true, NOW()),
  (gen_random_uuid(), 'partner-promos', 'promo-lifelong', 'Lifelong', 4, '/products?brand=lifelong', true, NOW()),
  -- Brand chips
  (gen_random_uuid(), 'brand-chips', 'brand-adidas',    'Adidas',         1, '/products?brand=adidas',     true, NOW()),
  (gen_random_uuid(), 'brand-chips', 'brand-intex',     'Intex',          2, '/products?brand=intex',      true, NOW()),
  (gen_random_uuid(), 'brand-chips', 'brand-garmin',    'Garmin',         3, '/products?brand=garmin',     true, NOW()),
  (gen_random_uuid(), 'brand-chips', 'brand-flexnest',  'Flexnest',       4, '/products?brand=flexnest',   true, NOW()),
  (gen_random_uuid(), 'brand-chips', 'brand-seasummit', 'Sea to Summit',  5, '/products?brand=seasummit',  true, NOW()),
  (gen_random_uuid(), 'brand-chips', 'brand-coros',     'Coros',          6, '/products?brand=coros',      true, NOW()),
  (gen_random_uuid(), 'brand-chips', 'brand-wtb',       'WTB',            7, '/products?brand=wtb',        true, NOW()),
  (gen_random_uuid(), 'brand-chips', 'brand-lifestraw', 'Lifestraw',      8, '/products?brand=lifestraw',  true, NOW());
