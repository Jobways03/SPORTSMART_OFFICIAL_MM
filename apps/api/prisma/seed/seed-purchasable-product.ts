/**
 * Seeds ONE fully-purchasable product so live-purchase smoke / E2E tests can
 * run end-to-end (login → cart → checkout/initiate → place-order) instead of
 * dead-ending on the half-provisioned fulfillment stack.
 *
 * The catalog seed creates products + variants + seller mappings, but leaves
 * the *fulfillment* layer unprovisioned, so nothing is actually buyable:
 *   - variants are created DRAFT  → the cart's validateVariant only accepts
 *     ACTIVE / OUT_OF_STOCK, so add-to-cart 404s ("Variant not found / available")
 *   - seller_service_areas is empty → an opted-in seller can't confirm a pincode
 *   - mapping pickup pincodes are random → the allocator's distance cap
 *     (ROUTING_MAX_DISTANCE_KM, default 1500) can filter a far seller out
 *
 * This makes a product that already has a seller mapping deliverable to
 * TARGET_PINCODE (default 560001 Bengaluru), COD-enabled, by satisfying every
 * condition SellerAllocationService.allocate() checks:
 *   1. product ACTIVE + not deleted          (else PRODUCT_INACTIVE)
 *   2. every variant ACTIVE                  (else add-to-cart fails)
 *   3. seller mapping: isActive, APPROVED, in stock, pickup = TARGET_PINCODE
 *      (distance ~0 → never tripped by the max-distance cap)
 *   4. seller: status ACTIVE, not on fulfillmentHold
 *   5. a SellerServiceArea row for TARGET_PINCODE (active + codEligible)
 *   6. post_offices must hold TARGET_PINCODE coords (warn if missing — that
 *      table is the customer-pincode geocode source; allocate returns
 *      PINCODE_UNKNOWN without it)
 *
 * Idempotent (update / upsert-by-find). Safe to re-run. NOT gated to non-prod:
 * it only ever flips an already-seeded demo product to buyable, which is
 * meaningless in a real catalog — but keep it out of prod seed pipelines.
 *
 * Env:
 *   TARGET_PINCODE   delivery pincode to serve            (default 560001)
 *   PRODUCT_SLUG     provision this specific product      (default: first
 *                    product that already has a seller mapping)
 *   STOCK_QTY        stock to set on the mapping(s)        (default 1000)
 *
 * Run:
 *   pnpm --filter @sportsmart/api exec ts-node prisma/seed/seed-purchasable-product.ts
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const TARGET_PINCODE = process.env.TARGET_PINCODE || '560001';
const STOCK_QTY = Number(process.env.STOCK_QTY) || 1000;
// Known password stamped on the provisioned seller so order-lifecycle E2E tests
// can log in as it (to accept + pack + ship the order). Dev/test only.
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD || 'SellerE2E@123';

async function main() {
  if (!/^[1-9][0-9]{5}$/.test(TARGET_PINCODE)) {
    throw new Error(
      `TARGET_PINCODE must be a 6-digit Indian PIN (first digit non-zero); got "${TARGET_PINCODE}".`,
    );
  }

  // 0. The allocator geocodes the customer pincode from post_offices (Redis-
  //    cached). Without a row it returns PINCODE_UNKNOWN and nothing is
  //    serviceable — warn rather than fail so the rest still runs.
  const po = await prisma.postOffice.findFirst({
    where: { pincode: TARGET_PINCODE },
    select: { pincode: true },
  });
  if (!po) {
    console.warn(
      `⚠  post_offices has no row for ${TARGET_PINCODE} — the allocator will ` +
        `return PINCODE_UNKNOWN. Seed post_offices (or pick a TARGET_PINCODE that exists) first.`,
    );
  }

  // 1. Choose the product to make buyable: an explicit slug, otherwise the
  //    oldest product that already has a seller mapping (so a seller exists to
  //    make serviceable — we don't fabricate sellers here).
  let mapping;
  if (process.env.PRODUCT_SLUG) {
    const product = await prisma.product.findUnique({
      where: { slug: process.env.PRODUCT_SLUG },
      select: { id: true },
    });
    if (!product) {
      throw new Error(`No product with slug "${process.env.PRODUCT_SLUG}".`);
    }
    mapping = await prisma.sellerProductMapping.findFirst({
      where: { productId: product.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!mapping) {
      throw new Error(
        `Product "${process.env.PRODUCT_SLUG}" has no seller mapping — cannot make it purchasable.`,
      );
    }
  } else {
    mapping = await prisma.sellerProductMapping.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!mapping) {
      throw new Error(
        'No seller_product_mappings exist — run the catalog seed (seed-demo-products) first.',
      );
    }
  }

  const productId = mapping.productId;
  const sellerId = mapping.sellerId;

  // 2. Product ACTIVE + not soft-deleted.
  await prisma.product.update({
    where: { id: productId },
    data: { status: 'ACTIVE', isDeleted: false },
  });

  // 3. Flip DRAFT variants → ACTIVE (leave DISABLED / ARCHIVED / OUT_OF_STOCK).
  const variantsFlipped = await prisma.productVariant.updateMany({
    where: { productId, status: 'DRAFT' },
    data: { status: 'ACTIVE' },
  });

  // 4. Every seller mapping for this product: active, APPROVED, in stock, and
  //    pickup = TARGET_PINCODE so the Haversine distance is ~0 (the mapping can
  //    never be dropped by the max-distance cap, whatever it's set to).
  const mappingsFixed = await prisma.sellerProductMapping.updateMany({
    where: { productId },
    data: {
      isActive: true,
      approvalStatus: 'APPROVED',
      stockQty: STOCK_QTY,
      reservedQty: 0,
      pickupPincode: TARGET_PINCODE,
    },
  });

  // 5. Seller ACTIVE + off any manual fulfillment hold, with a known password
  //    so the order-lifecycle E2E can log in as it to fulfill.
  await prisma.seller.update({
    where: { id: sellerId },
    data: {
      status: 'ACTIVE',
      fulfillmentHold: false,
      passwordHash: await bcrypt.hash(SELLER_PASSWORD, 12),
    },
  });

  // 6. SellerServiceArea for the target pincode — active + COD-eligible.
  //    NOTE: adding ANY service-area row flips the seller to "opted-in"
  //    (restricted to its listed pincodes), so the target pincode MUST be
  //    present — which it now is.
  const area = await prisma.sellerServiceArea.findFirst({
    where: { sellerId, pincode: TARGET_PINCODE },
    select: { id: true },
  });
  if (area) {
    await prisma.sellerServiceArea.update({
      where: { id: area.id },
      data: { isActive: true, codEligible: true },
    });
  } else {
    await prisma.sellerServiceArea.create({
      data: { sellerId, pincode: TARGET_PINCODE, isActive: true, codEligible: true },
    });
  }

  // ── Report — these ids let smoke/E2E tests hardcode a known-good purchase ──
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true, title: true },
  });
  const activeVariants = await prisma.productVariant.findMany({
    where: { productId, status: 'ACTIVE' },
    select: { id: true, sku: true },
  });
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { email: true },
  });

  console.log('✅ Purchasable product ready');
  console.log(`   title:     ${product?.title}`);
  console.log(`   slug:      ${product?.slug}`);
  console.log(`   productId: ${productId}`);
  console.log(`   sellerId:  ${sellerId}`);
  console.log(`   seller login (fulfillment E2E): ${seller?.email} / ${SELLER_PASSWORD}`);
  console.log(`   pincode:   ${TARGET_PINCODE} (COD-enabled, pickup co-located)`);
  console.log(
    `   variants:  ${activeVariants.map((v) => `${v.id}${v.sku ? ` (${v.sku})` : ''}`).join('\n              ') || '(NONE ACTIVE — check variant statuses)'}`,
  );
  console.log(
    `   changes:   ${variantsFlipped.count} variant(s) DRAFT→ACTIVE, ${mappingsFixed.count} mapping(s) provisioned`,
  );
  console.log('');
  console.log('   E2E: log in the smoke customer, add an ACTIVE variant above to');
  console.log(`   the cart, create an address with pincode ${TARGET_PINCODE}, then`);
  console.log('   POST /customer/checkout/initiate + /place-order with paymentMethod COD.');
}

main()
  .catch((err) => {
    console.error('seed-purchasable-product failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
