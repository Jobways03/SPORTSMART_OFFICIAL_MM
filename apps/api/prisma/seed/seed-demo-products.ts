/**
 * Demo-product seeder for the mobile / web storefront preview.
 *
 * Creates ~30 ACTIVE products across cricket, football, running, gym,
 * badminton, tennis, swimming, and cycling — wired to a "Sportsmart
 * Official Store" seller with APPROVED SellerProductMapping rows so
 * the storefront catalog endpoint returns them.
 *
 * Idempotent: skips if any non-deleted product already exists.
 *
 * Run with:
 *   pnpm --filter @sportsmart/api seed:demo-products
 * or:
 *   cd apps/api && npx ts-node prisma/seed/seed-demo-products.ts
 */
import {PrismaClient} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

interface DemoProduct {
  title: string;
  categorySlug: string;
  brandSlug: string;
  price: number;          // INR rupees
  compareAt?: number;     // strike-through price for discount display
  stock: number;
  image: string;          // hero image URL
  shortDesc: string;
}

// Each image is a stable Unsplash photo URL — picked because Unsplash
// allows hot-linking and serves at the size requested via `?w=` / `?h=`
// query params. Picsum was an option but unrelated photos undercut the
// "this looks like a real sports catalog" demo feel.
const DEMO_PRODUCTS: DemoProduct[] = [
  // ─── Cricket ───
  {
    title: 'SS Magnum English Willow Cricket Bat',
    categorySlug: 'cricket-bats',
    brandSlug: 'ss-sareen-sports',
    price: 8499, compareAt: 11999, stock: 24,
    image: 'https://images.unsplash.com/photo-1531415074968-036ba1b575da?w=600&h=600&fit=crop',
    shortDesc: 'Grade 1 English willow. Match-ready, knocked-in. SH long handle.',
  },
  {
    title: 'Kookaburra Pace 2.0 Leather Ball',
    categorySlug: 'cricket-balls',
    brandSlug: 'kookaburra',
    price: 749, compareAt: 999, stock: 80,
    image: 'https://images.unsplash.com/photo-1593341646782-e0b495cff86d?w=600&h=600&fit=crop',
    shortDesc: 'Tournament-grade 4-piece construction. 156g. Red.',
  },
  {
    title: 'SG Test Wicket Keeping Gloves',
    categorySlug: 'wicket-keeping-gloves',
    brandSlug: 'sg-stanford-of-georgetown',
    price: 2799, stock: 36,
    image: 'https://images.unsplash.com/photo-1543326727-cf6c39e8f84c?w=600&h=600&fit=crop',
    shortDesc: 'Pro fit, Pittards leather palm. Adult size.',
  },
  {
    title: 'MRF Genius Limited Edition Bat',
    categorySlug: 'cricket-bats',
    brandSlug: 'mrf',
    price: 14999, compareAt: 18999, stock: 12,
    image: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=600&h=600&fit=crop',
    shortDesc: 'Hand-picked premium willow. The bat the pros use.',
  },

  // ─── Football ───
  {
    title: 'Nike Phantom GX Elite Football Boots',
    categorySlug: 'football-boots',
    brandSlug: 'nike',
    price: 12499, compareAt: 15999, stock: 28,
    image: 'https://images.unsplash.com/photo-1511886929837-354d827aae26?w=600&h=600&fit=crop',
    shortDesc: 'FG cleats with All Conditions Control technology.',
  },
  {
    title: 'Adidas Tango Pro Match Ball',
    categorySlug: 'footballs',
    brandSlug: 'adidas',
    price: 3499, stock: 50,
    image: 'https://images.unsplash.com/photo-1614632537190-23e4146777db?w=600&h=600&fit=crop',
    shortDesc: 'FIFA Quality Pro certified. Size 5. Hand-stitched.',
  },
  {
    title: 'Puma Future Match Goalkeeper Gloves',
    categorySlug: 'goalkeeper-gloves',
    brandSlug: 'puma',
    price: 2299, stock: 40,
    image: 'https://images.unsplash.com/photo-1551958219-acbc608c6377?w=600&h=600&fit=crop',
    shortDesc: 'Latex palm with 4mm cushion. All-weather grip.',
  },
  {
    title: 'Nivia Storm Football Pump',
    categorySlug: 'football-accessories',
    brandSlug: 'nivia',
    price: 449, stock: 100,
    image: 'https://images.unsplash.com/photo-1614632537423-1e6c2e7e0aab?w=600&h=600&fit=crop',
    shortDesc: 'Compact dual-action pump with 3 needle attachments.',
  },

  // ─── Running ───
  {
    title: 'Nike Pegasus 41 Running Shoes',
    categorySlug: 'running-shoes',
    brandSlug: 'nike',
    price: 11995, stock: 60,
    image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&h=600&fit=crop',
    shortDesc: 'Daily trainer with React foam. Men + Women sizes.',
  },
  {
    title: 'Asics Gel-Kayano 31 Stability Shoes',
    categorySlug: 'running-shoes',
    brandSlug: 'asics',
    price: 14999, compareAt: 17499, stock: 32,
    image: 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=600&h=600&fit=crop',
    shortDesc: 'Overpronation support. FF Blast Plus midsole.',
  },
  {
    title: 'Adidas Adizero Adios Pro 3',
    categorySlug: 'running-shoes',
    brandSlug: 'adidas',
    price: 22999, stock: 18,
    image: 'https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600&h=600&fit=crop',
    shortDesc: 'Carbon-plated race shoe. Marathon weapon.',
  },
  {
    title: 'New Balance Fresh Foam X Trail',
    categorySlug: 'running-shoes',
    brandSlug: 'new-balance',
    price: 13499, stock: 22,
    image: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=600&h=600&fit=crop',
    shortDesc: 'Aggressive lugs, rock-plate protection. All-terrain.',
  },

  // ─── Gym / Fitness ───
  {
    title: 'Cosco Hexagonal Dumbbell Set (2.5kg–10kg)',
    categorySlug: 'dumbbells',
    brandSlug: 'cosco',
    price: 6499, compareAt: 8499, stock: 14,
    image: 'https://images.unsplash.com/photo-1532029837206-abbe2b7620e3?w=600&h=600&fit=crop',
    shortDesc: 'Rubber-coated hex pair. Knurled chrome handle.',
  },
  {
    title: 'Adidas Performance Yoga Mat 6mm',
    categorySlug: 'yoga-mats',
    brandSlug: 'adidas',
    price: 1799, stock: 75,
    image: 'https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=600&h=600&fit=crop',
    shortDesc: 'Non-slip TPE. 173 × 61 cm. Carry strap included.',
  },
  {
    title: 'Under Armour Project Rock 6 Training Shoes',
    categorySlug: 'gym-training-shoes',
    brandSlug: 'under-armour',
    price: 12999, stock: 26,
    image: 'https://images.unsplash.com/photo-1556906781-9a412961c28c?w=600&h=600&fit=crop',
    shortDesc: 'Flat-soled lifters. UA Flow tech. Tribase grip.',
  },
  {
    title: 'Reebok Resistance Band Set (5-pack)',
    categorySlug: 'resistance-bands',
    brandSlug: 'reebok',
    price: 899, stock: 200,
    image: 'https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=600&h=600&fit=crop',
    shortDesc: 'Light to extra-heavy. Door anchor + carry pouch.',
  },
  {
    title: 'Decathlon Domyos 100 Skipping Rope',
    categorySlug: 'running-accessories',
    brandSlug: 'decathlon-domyos',
    price: 299, stock: 300,
    image: 'https://images.unsplash.com/photo-1599058945522-28d584b6f0ff?w=600&h=600&fit=crop',
    shortDesc: 'Adjustable PVC rope. Ball-bearing handles.',
  },

  // ─── Badminton ───
  {
    title: 'Yonex Astrox 99 Pro Badminton Racket',
    categorySlug: 'badminton-rackets',
    brandSlug: 'yonex',
    price: 18999, compareAt: 21999, stock: 16,
    image: 'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=600&h=600&fit=crop',
    shortDesc: 'The Kento Momota racket. Head-heavy, attack frame.',
  },
  {
    title: 'Yonex Nanoflare 700 Game Racket',
    categorySlug: 'badminton-rackets',
    brandSlug: 'yonex',
    price: 7999, stock: 30,
    image: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?w=600&h=600&fit=crop',
    shortDesc: 'Speed frame for fast doubles play. Even balance.',
  },
  {
    title: 'Yonex AS-30 Feather Shuttlecocks (12-pack)',
    categorySlug: 'shuttlecocks',
    brandSlug: 'yonex',
    price: 2299, stock: 90,
    image: 'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=600&h=600&fit=crop',
    shortDesc: 'Tournament-grade feather. Stable flight, slow speed.',
  },

  // ─── Tennis ───
  {
    title: 'Yonex VCORE 100 Tennis Racket (300g)',
    categorySlug: 'tennis-rackets',
    brandSlug: 'yonex',
    price: 16499, stock: 12,
    image: 'https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=600&h=600&fit=crop',
    shortDesc: 'Spin-friendly frame, used by Naomi Osaka. Grip 3.',
  },
  {
    title: 'Cosco Championship Tennis Balls (Can of 3)',
    categorySlug: 'tennis-balls',
    brandSlug: 'cosco',
    price: 449, stock: 150,
    image: 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=600&h=600&fit=crop',
    shortDesc: 'Pressurized hard-court balls. ITF approved.',
  },

  // ─── Swimming ───
  {
    title: 'Speedo Fastskin Hyper Elite Goggles',
    categorySlug: 'swim-goggles',
    brandSlug: 'asics',
    price: 4999, stock: 25,
    image: 'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=600&h=600&fit=crop',
    shortDesc: 'Anti-fog mirror lens. Low-profile race fit.',
  },
  {
    title: 'Nike Performance Swim Cap',
    categorySlug: 'swim-caps',
    brandSlug: 'nike',
    price: 599, stock: 80,
    image: 'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=600&h=600&fit=crop',
    shortDesc: 'Silicone, hydrodynamic. One-size-fits-all.',
  },

  // ─── Cycling ───
  {
    title: 'Decathlon Btwin Riverside 500 Hybrid Bike',
    categorySlug: 'bicycles',
    brandSlug: 'decathlon-domyos',
    price: 28999, compareAt: 32999, stock: 8,
    image: 'https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?w=600&h=600&fit=crop',
    shortDesc: '21-speed Shimano gears. Aluminium frame. M / L / XL.',
  },
  {
    title: 'Cosco Cycling Helmet (Adult)',
    categorySlug: 'cycling-helmets',
    brandSlug: 'cosco',
    price: 1499, stock: 60,
    image: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=600&h=600&fit=crop',
    shortDesc: 'CE-certified. 22 vents. Removable visor.',
  },

  // ─── Activewear ───
  {
    title: 'Nike Dri-FIT Training T-Shirt',
    categorySlug: 't-shirts-tops',
    brandSlug: 'nike',
    price: 1799, compareAt: 2299, stock: 120,
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&h=600&fit=crop',
    shortDesc: 'Sweat-wicking polyester. S / M / L / XL.',
  },
  {
    title: 'Adidas Tiro 23 Training Track Pants',
    categorySlug: 'track-pants-joggers',
    brandSlug: 'adidas',
    price: 2999, stock: 85,
    image: 'https://images.unsplash.com/photo-1542327897-d73f4005b533?w=600&h=600&fit=crop',
    shortDesc: 'AEROREADY moisture management. Tapered fit.',
  },
  {
    title: 'Puma Essentials Pullover Hoodie',
    categorySlug: 'hoodies-sweatshirts',
    brandSlug: 'puma',
    price: 2799, compareAt: 3499, stock: 70,
    image: 'https://images.unsplash.com/photo-1556906781-9a412961c28c?w=600&h=600&fit=crop',
    shortDesc: 'French terry cotton blend. Kangaroo pocket.',
  },
  {
    title: 'Under Armour HeatGear Compression Tights',
    categorySlug: 'base-layers-compression',
    brandSlug: 'under-armour',
    price: 2499, stock: 65,
    image: 'https://images.unsplash.com/photo-1558642084-fd07fae5282e?w=600&h=600&fit=crop',
    shortDesc: 'Second-skin fit. Anti-odour. Cool feel.',
  },
];

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[()&,]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function ensureDemoSeller() {
  const email = 'demo-seller@sportsmart.test';
  const existing = await prisma.seller.findUnique({where: {email}});
  if (existing) return existing;
  const passwordHash = await bcrypt.hash('Test@123', 12);
  return prisma.seller.create({
    data: {
      sellerName: 'Sportsmart Official',
      sellerShopName: 'Sportsmart Official Store',
      email,
      phoneNumber: '+919999900099',
      passwordHash,
      status: 'ACTIVE',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      sellerZipCode: '400001',
      shortStoreDescription: "Sportsmart's flagship demo storefront.",
      isEmailVerified: true,
      verificationStatus: 'VERIFIED',
    },
  });
}

async function main() {
  // Per-product idempotency via slug — re-runs only insert the missing
  // entries rather than refusing globally. Lets us iteratively add new
  // demo SKUs without wiping the table.
  console.log('[seed-demo-products] Creating demo seller…');
  const seller = await ensureDemoSeller();

  console.log(`[seed-demo-products] Seeding ${DEMO_PRODUCTS.length} products…`);
  let created = 0;
  let skipped = 0;
  let existed = 0;

  for (const def of DEMO_PRODUCTS) {
    const slug = toSlug(def.title);
    const dupe = await prisma.product.findUnique({where: {slug}});
    if (dupe) {
      existed++;
      continue;
    }
    const category = await prisma.category.findUnique({
      where: {slug: def.categorySlug},
    });
    const brand = await prisma.brand.findUnique({
      where: {slug: def.brandSlug},
    });

    if (!category) {
      console.warn(
        `  ⚠ skip "${def.title}" — category slug "${def.categorySlug}" not found`,
      );
      skipped++;
      continue;
    }
    if (!brand) {
      console.warn(
        `  ⚠ skip "${def.title}" — brand slug "${def.brandSlug}" not found`,
      );
      skipped++;
      continue;
    }

    const product = await prisma.product.create({
      data: {
        title: def.title,
        slug,
        sellerId: seller.id,
        categoryId: category.id,
        brandId: brand.id,
        shortDescription: def.shortDesc,
        description: `${def.shortDesc}\n\nShipped from Sportsmart Official Store. Genuine product with full manufacturer warranty.`,
        status: 'ACTIVE',
        moderationStatus: 'APPROVED',
        basePrice: def.price,
        compareAtPrice: def.compareAt ?? null,
        hasVariants: false,
        images: {
          create: [
            {
              url: def.image,
              altText: def.title,
              sortOrder: 0,
              isPrimary: true,
            },
          ],
        },
        variants: {
          create: [
            {
              title: 'Default',
              price: def.price,
              compareAtPrice: def.compareAt ?? null,
              stock: def.stock,
              status: 'ACTIVE',
              sortOrder: 0,
            },
          ],
        },
      },
      include: {variants: true},
    });

    // SellerProductMapping with APPROVED status is what makes the
    // storefront treat the product as in-stock and serviceable.
    for (const variant of product.variants) {
      await prisma.sellerProductMapping.create({
        data: {
          sellerId: seller.id,
          productId: product.id,
          variantId: variant.id,
          stockQty: def.stock,
          reservedQty: 0,
          isActive: true,
          approvalStatus: 'APPROVED',
        },
      });
    }

    created++;
    if (created % 5 === 0) {
      console.log(`  ✓ ${created} products created so far…`);
    }
  }

  console.log(
    `[seed-demo-products] Done. Created: ${created}, Existed: ${existed}, Skipped: ${skipped}.`,
  );
}

main()
  .catch(err => {
    console.error('[seed-demo-products] FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
