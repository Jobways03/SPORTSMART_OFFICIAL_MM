/* eslint-disable no-console */
/**
 * Phase 1 GST seed — master data for the tax module.
 *
 * Seeds:
 *   1. india_states            — 38 entries per CBIC GST state-code list
 *   2. uqc_master              — CBIC Unit Quantity Code list
 *   3. hsn_master              — STUB list of common sports-goods HSN.
 *                                CA MUST replace with the signed-off list
 *                                before TAX_STRICT_MODE=true. See
 *                                docs/tax/HSN_RATE_POLICY.md §7.
 *   4. tax_config              — runtime defaults engineering picked.
 *                                CA reviews via docs/tax/CA.md §4.
 *   5. platform_gst_profiles   — single placeholder row. CA fills in
 *                                real Sportsmart GSTIN before strict
 *                                mode.
 *
 * Idempotent: upserts where uniqueness allows; deletes-then-inserts for
 * lookup tables (india_states, uqc_master) where re-running should yield
 * the canonical list. tax_config and platform_gst_profiles preserve
 * existing rows on re-run (admin may have edited values).
 *
 * Run via:
 *   pnpm --filter @sportsmart/api exec ts-node prisma/seed/seed-tax-master.ts
 */

import { PrismaClient, SupplyTaxability, GstRegistrationType } from '@prisma/client';

const prisma = new PrismaClient();

// ───────────────────────────────────────────────────────────────
// 1. india_states
// ───────────────────────────────────────────────────────────────
// CBIC GST state-code list. Stable since 2020 reorganisations
// (Ladakh = 38). Special codes (96/97/99) included for completeness.

const INDIA_STATES = [
  { gstStateCode: '01', stateName: 'Jammu and Kashmir',      isoCode: 'IN-JK', isUnionTerritory: true },
  { gstStateCode: '02', stateName: 'Himachal Pradesh',       isoCode: 'IN-HP', isUnionTerritory: false },
  { gstStateCode: '03', stateName: 'Punjab',                 isoCode: 'IN-PB', isUnionTerritory: false },
  { gstStateCode: '04', stateName: 'Chandigarh',             isoCode: 'IN-CH', isUnionTerritory: true },
  { gstStateCode: '05', stateName: 'Uttarakhand',            isoCode: 'IN-UT', isUnionTerritory: false },
  { gstStateCode: '06', stateName: 'Haryana',                isoCode: 'IN-HR', isUnionTerritory: false },
  { gstStateCode: '07', stateName: 'Delhi',                  isoCode: 'IN-DL', isUnionTerritory: true },
  { gstStateCode: '08', stateName: 'Rajasthan',              isoCode: 'IN-RJ', isUnionTerritory: false },
  { gstStateCode: '09', stateName: 'Uttar Pradesh',          isoCode: 'IN-UP', isUnionTerritory: false },
  { gstStateCode: '10', stateName: 'Bihar',                  isoCode: 'IN-BR', isUnionTerritory: false },
  { gstStateCode: '11', stateName: 'Sikkim',                 isoCode: 'IN-SK', isUnionTerritory: false },
  { gstStateCode: '12', stateName: 'Arunachal Pradesh',      isoCode: 'IN-AR', isUnionTerritory: false },
  { gstStateCode: '13', stateName: 'Nagaland',               isoCode: 'IN-NL', isUnionTerritory: false },
  { gstStateCode: '14', stateName: 'Manipur',                isoCode: 'IN-MN', isUnionTerritory: false },
  { gstStateCode: '15', stateName: 'Mizoram',                isoCode: 'IN-MZ', isUnionTerritory: false },
  { gstStateCode: '16', stateName: 'Tripura',                isoCode: 'IN-TR', isUnionTerritory: false },
  { gstStateCode: '17', stateName: 'Meghalaya',              isoCode: 'IN-ML', isUnionTerritory: false },
  { gstStateCode: '18', stateName: 'Assam',                  isoCode: 'IN-AS', isUnionTerritory: false },
  { gstStateCode: '19', stateName: 'West Bengal',            isoCode: 'IN-WB', isUnionTerritory: false },
  { gstStateCode: '20', stateName: 'Jharkhand',              isoCode: 'IN-JH', isUnionTerritory: false },
  { gstStateCode: '21', stateName: 'Odisha',                 isoCode: 'IN-OR', isUnionTerritory: false },
  { gstStateCode: '22', stateName: 'Chhattisgarh',           isoCode: 'IN-CT', isUnionTerritory: false },
  { gstStateCode: '23', stateName: 'Madhya Pradesh',         isoCode: 'IN-MP', isUnionTerritory: false },
  { gstStateCode: '24', stateName: 'Gujarat',                isoCode: 'IN-GJ', isUnionTerritory: false },
  { gstStateCode: '26', stateName: 'Dadra and Nagar Haveli and Daman and Diu', isoCode: 'IN-DH', isUnionTerritory: true },
  { gstStateCode: '27', stateName: 'Maharashtra',            isoCode: 'IN-MH', isUnionTerritory: false },
  { gstStateCode: '29', stateName: 'Karnataka',              isoCode: 'IN-KA', isUnionTerritory: false },
  { gstStateCode: '30', stateName: 'Goa',                    isoCode: 'IN-GA', isUnionTerritory: false },
  { gstStateCode: '31', stateName: 'Lakshadweep',            isoCode: 'IN-LD', isUnionTerritory: true },
  { gstStateCode: '32', stateName: 'Kerala',                 isoCode: 'IN-KL', isUnionTerritory: false },
  { gstStateCode: '33', stateName: 'Tamil Nadu',             isoCode: 'IN-TN', isUnionTerritory: false },
  { gstStateCode: '34', stateName: 'Puducherry',             isoCode: 'IN-PY', isUnionTerritory: true },
  { gstStateCode: '35', stateName: 'Andaman and Nicobar Islands', isoCode: 'IN-AN', isUnionTerritory: true },
  { gstStateCode: '36', stateName: 'Telangana',              isoCode: 'IN-TG', isUnionTerritory: false },
  { gstStateCode: '37', stateName: 'Andhra Pradesh',         isoCode: 'IN-AP', isUnionTerritory: false },
  { gstStateCode: '38', stateName: 'Ladakh',                 isoCode: 'IN-LA', isUnionTerritory: true },
  { gstStateCode: '96', stateName: 'Other Country',          isoCode: null,    isUnionTerritory: false },
  { gstStateCode: '97', stateName: 'Other Territory',        isoCode: null,    isUnionTerritory: false },
  { gstStateCode: '99', stateName: 'Centre Jurisdiction',    isoCode: null,    isUnionTerritory: false },
];

async function seedIndiaStates() {
  for (const s of INDIA_STATES) {
    await prisma.indiaState.upsert({
      where: { gstStateCode: s.gstStateCode },
      update: {
        stateName: s.stateName,
        isoCode: s.isoCode,
        isUnionTerritory: s.isUnionTerritory,
      },
      create: {
        gstStateCode: s.gstStateCode,
        stateName: s.stateName,
        isoCode: s.isoCode,
        isUnionTerritory: s.isUnionTerritory,
      },
    });
  }
  console.log(`✓ india_states: upserted ${INDIA_STATES.length} rows`);
}

// ───────────────────────────────────────────────────────────────
// 2. uqc_master
// ───────────────────────────────────────────────────────────────
// CBIC Unit Quantity Code list — used on every tax-invoice line.

const UQC_LIST = [
  { code: 'BAG', description: 'BAGS' },
  { code: 'BAL', description: 'BALE' },
  { code: 'BDL', description: 'BUNDLES' },
  { code: 'BKL', description: 'BUCKLES' },
  { code: 'BOU', description: 'BILLIONS OF UNITS' },
  { code: 'BOX', description: 'BOX' },
  { code: 'BTL', description: 'BOTTLES' },
  { code: 'BUN', description: 'BUNCHES' },
  { code: 'CAN', description: 'CANS' },
  { code: 'CBM', description: 'CUBIC METERS' },
  { code: 'CCM', description: 'CUBIC CENTIMETERS' },
  { code: 'CMS', description: 'CENTIMETERS' },
  { code: 'CTN', description: 'CARTONS' },
  { code: 'DOZ', description: 'DOZEN' },
  { code: 'DRM', description: 'DRUM' },
  { code: 'GGK', description: 'GREAT GROSS' },
  { code: 'GMS', description: 'GRAMMES' },
  { code: 'GRS', description: 'GROSS' },
  { code: 'GYD', description: 'GROSS YARDS' },
  { code: 'KGS', description: 'KILOGRAMS' },
  { code: 'KLR', description: 'KILOLITRE' },
  { code: 'KME', description: 'KILOMETRE' },
  { code: 'MLT', description: 'MILLILITRE' },
  { code: 'MTR', description: 'METERS' },
  { code: 'MTS', description: 'METRIC TON' },
  { code: 'NOS', description: 'NUMBERS' },
  { code: 'OTH', description: 'OTHERS' },
  { code: 'PAC', description: 'PACKS' },
  { code: 'PCS', description: 'PIECES' },
  { code: 'PRS', description: 'PAIRS' },
  { code: 'QTL', description: 'QUINTAL' },
  { code: 'ROL', description: 'ROLLS' },
  { code: 'SET', description: 'SETS' },
  { code: 'SQF', description: 'SQUARE FEET' },
  { code: 'SQM', description: 'SQUARE METERS' },
  { code: 'SQY', description: 'SQUARE YARDS' },
  { code: 'TBS', description: 'TABLETS' },
  { code: 'TGM', description: 'TEN GROSS' },
  { code: 'THD', description: 'THOUSANDS' },
  { code: 'TON', description: 'TONNES' },
  { code: 'TUB', description: 'TUBES' },
  { code: 'UGS', description: 'US GALLONS' },
  { code: 'UNT', description: 'UNITS' },
  { code: 'YDS', description: 'YARDS' },
];

async function seedUqcMaster() {
  for (const u of UQC_LIST) {
    await prisma.uqcMaster.upsert({
      where: { code: u.code },
      update: { description: u.description },
      create: u,
    });
  }
  console.log(`✓ uqc_master: upserted ${UQC_LIST.length} rows`);
}

// ───────────────────────────────────────────────────────────────
// 3. hsn_master — STUB list for sports goods
// ───────────────────────────────────────────────────────────────
// THIS IS A PLACEHOLDER. CA must validate every entry and add the
// complete list (especially price-banded apparel/footwear rates).
// See docs/tax/HSN_RATE_POLICY.md §7-8.

const EFFECTIVE_FROM_FY_2026_27 = new Date('2026-04-01T00:00:00Z');

const HSN_STUB = [
  { hsnCode: '950611', description: 'Skis and other snow-ski equipment',                       defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'winter sports' },
  { hsnCode: '950619', description: 'Skis (other)',                                             defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'winter sports' },
  { hsnCode: '950621', description: 'Sailboards',                                               defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'water sports' },
  { hsnCode: '950629', description: 'Water-skis, surf-boards and water-sport equipment',        defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'water sports' },
  { hsnCode: '950631', description: 'Golf clubs, complete',                                     defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'golf' },
  { hsnCode: '950632', description: 'Golf balls',                                               defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'golf' },
  { hsnCode: '950640', description: 'Articles and equipment for table-tennis',                  defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'table sports' },
  { hsnCode: '950651', description: 'Lawn-tennis rackets',                                      defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'racket sports' },
  { hsnCode: '950659', description: 'Other rackets (badminton, squash)',                        defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'racket sports' },
  { hsnCode: '950661', description: 'Lawn-tennis balls',                                        defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'racket sports' },
  { hsnCode: '950662', description: 'Inflatable balls (football, cricket, basketball, etc.)',   defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'team sports' },
  { hsnCode: '950669', description: 'Other balls (table-tennis, golf, etc.)',                   defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'team sports' },
  { hsnCode: '950670', description: 'Ice skates and roller skates',                             defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'skating' },
  { hsnCode: '950691', description: 'Gymnastics and athletics equipment',                       defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'gymnastics' },
  { hsnCode: '950699', description: 'Other sports articles (cricket bats, hockey sticks, etc.)', defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'general sports' },
  { hsnCode: '950420', description: 'Articles for billiards / pool table accessories',          defaultGstRateBps: 2800, defaultUqcCode: 'NOS', categoryHint: 'parlour games' },
  { hsnCode: '950430', description: 'Coin-operated games (excl bowling)',                       defaultGstRateBps: 2800, defaultUqcCode: 'NOS', categoryHint: 'parlour games' },
  { hsnCode: '950450', description: 'Video game consoles',                                      defaultGstRateBps: 2800, defaultUqcCode: 'NOS', categoryHint: 'electronics' },
  // Apparel — CBIC rate is price-banded (≤₹1000 = 5%, above = 12%).
  // Phase 1 seeds the higher band; price-band logic comes in Phase 3
  // engine extension. CA: review whether to seed both rows or to
  // build per-line price-band lookup logic instead.
  { hsnCode: '6109',   description: 'T-shirts, singlets and other vests, knitted',              defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'apparel-above-1000' },
  { hsnCode: '6110',   description: 'Jerseys, pullovers, cardigans, knitted',                   defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'apparel-above-1000' },
  { hsnCode: '6203',   description: "Men's or boys' suits, ensembles, jackets, trousers",       defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'apparel-above-1000' },
  { hsnCode: '6204',   description: "Women's or girls' suits, ensembles, jackets",              defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'apparel-above-1000' },
  { hsnCode: '6403',   description: 'Footwear with leather outer soles',                        defaultGstRateBps: 1800, defaultUqcCode: 'PRS', categoryHint: 'footwear' },
  { hsnCode: '6404',   description: 'Footwear with rubber/plastic outer soles',                 defaultGstRateBps: 1800, defaultUqcCode: 'PRS', categoryHint: 'footwear' },
  // Bags, backpacks, equipment cases
  { hsnCode: '4202',   description: 'Trunks, suit-cases, vanity-cases, bags',                   defaultGstRateBps: 1800, defaultUqcCode: 'NOS', categoryHint: 'bags' },
  // Bicycles + parts
  { hsnCode: '8712',   description: 'Bicycles and other cycles (non-motorised)',                defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'cycling' },
  { hsnCode: '8714',   description: 'Parts and accessories of bicycles',                        defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'cycling' },
  // Carnival / sports articles
  { hsnCode: '9505',   description: 'Festive, carnival or other entertainment articles',        defaultGstRateBps: 1200, defaultUqcCode: 'NOS', categoryHint: 'accessories' },
];

async function seedHsnMaster() {
  for (const h of HSN_STUB) {
    // Upsert via composite unique (hsnCode + effectiveFrom)
    const existing = await prisma.hsnMaster.findFirst({
      where: { hsnCode: h.hsnCode, effectiveFrom: EFFECTIVE_FROM_FY_2026_27 },
    });
    if (existing) {
      await prisma.hsnMaster.update({
        where: { id: existing.id },
        data: {
          description: h.description,
          defaultGstRateBps: h.defaultGstRateBps,
          supplyTaxability: SupplyTaxability.TAXABLE,
          defaultUqcCode: h.defaultUqcCode,
          categoryHint: h.categoryHint,
          isActive: true,
        },
      });
    } else {
      await prisma.hsnMaster.create({
        data: {
          hsnCode: h.hsnCode,
          description: h.description,
          defaultGstRateBps: h.defaultGstRateBps,
          supplyTaxability: SupplyTaxability.TAXABLE,
          defaultUqcCode: h.defaultUqcCode,
          categoryHint: h.categoryHint,
          isActive: true,
          effectiveFrom: EFFECTIVE_FROM_FY_2026_27,
          effectiveTo: null,
        },
      });
    }
  }
  console.log(`✓ hsn_master: upserted ${HSN_STUB.length} rows (STUB — CA must validate)`);
}

// ───────────────────────────────────────────────────────────────
// 4. tax_config — runtime defaults
// ───────────────────────────────────────────────────────────────

const TAX_CONFIG_DEFAULTS: Array<{ key: string; value: unknown; description: string }> = [
  { key: 'required_hsn_length',                value: 6,                description: 'CBIC HSN length tier — depends on AATO. CA must confirm.' },
  { key: 'eway_bill_threshold_paise',          value: 5000000,          description: '₹50,000 — single national threshold for e-way bill.' },
  { key: 'shipping_sac_code',                  value: '9968',           description: 'SAC for postal/courier services. CA must confirm.' },
  { key: 'shipping_gst_rate_bps',              value: 1800,             description: '18% — shipping GST. CA must confirm.' },
  { key: 'shipping_tax_inclusive',             value: false,            description: 'Shipping fee stored exclusive of GST.' },
  { key: 'goodwill_approval_threshold_paise',  value: 500000,           description: '₹5,000 — above this requires second-admin approval on wallet adjustments.' },
  { key: 'tcs_rate_bps',                       value: 100,              description: '1% — Section 52 TCS. CA must confirm current rate.' },
  { key: 'default_gst_rate_bps_test_mode',     value: 1800,             description: 'Fallback rate when product has no rate, in test mode only.' },
  { key: 'tax_strict_mode',                    value: false,            description: 'When true, missing tax data blocks checkout/invoice. CA flips after sign-off.' },
  { key: 'tax_audit_mode',                     value: true,             description: 'When true, engine logs shadow calculations for diff.' },
  { key: 'invoice_generation_enabled',         value: true,             description: 'When true, tax documents are generated on order finalisation.' },
  { key: 'credit_note_generation_enabled',     value: true,             description: 'When true, credit notes are generated on return QC approval.' },
  { key: 'eway_bill_enabled',                  value: true,             description: 'When true, e-way bills are generated (stub provider).' },
  { key: 'gst_tcs_enabled',                    value: true,             description: 'When true, TCS ledger writes occur at settlement.' },
  { key: 'gstr8_enabled',                      value: true,             description: 'When true, GSTR-8 export is available.' },
  { key: 'einvoice_enabled',                   value: false,            description: 'When true, NIC IRP integration is called. Disabled until CA confirms turnover applicability.' },
  { key: 'legacy_order_cutoff_date',           value: null,             description: 'Orders before this date get LEGACY_RECEIPT. Set when TAX_STRICT_MODE flips.' },
  { key: 'b2b_place_of_supply_source',         value: 'SHIPPING',       description: 'SHIPPING | BUYER_GSTIN_STATE. CA must confirm.' },
  { key: 'section_34_window_cutoff_month',     value: 9,                description: 'Sept = month-end-cutoff (30/09 of next FY).' },
];

async function seedTaxConfig() {
  for (const c of TAX_CONFIG_DEFAULTS) {
    await prisma.taxConfig.upsert({
      where: { key: c.key },
      // Preserve admin-edited values on re-run by only updating
      // description (not value).
      update: { description: c.description },
      create: { key: c.key, value: c.value as never, description: c.description },
    });
  }
  console.log(`✓ tax_config: upserted ${TAX_CONFIG_DEFAULTS.length} rows`);
}

// ───────────────────────────────────────────────────────────────
// 5. platform_gst_profiles — single placeholder row
// ───────────────────────────────────────────────────────────────
// CA fills in the real Sportsmart GSTIN. This row drives invoice
// supplier details for OWN_BRAND / SPORTSMART supplies.

async function seedPlatformGstProfile() {
  const placeholderGstin = '36AAAAA0000A1Z5'; // Telangana placeholder; CA replaces.
  const existing = await prisma.platformGstProfile.findUnique({ where: { gstin: placeholderGstin } });
  if (existing) {
    console.log(`= platform_gst_profiles: placeholder already present (gstin=${placeholderGstin})`);
    return;
  }
  await prisma.platformGstProfile.create({
    data: {
      legalBusinessName: 'Sportsmart Marketplace Pvt Ltd (PLACEHOLDER — CA REPLACE)',
      gstin: placeholderGstin,
      registeredAddressJson: {
        addressLine1: 'Replace with registered office address',
        city: 'Hyderabad',
        state: 'Telangana',
        stateCode: '36',
        pincode: '500001',
        country: 'India',
      },
      gstStateCode: '36',
      registrationType: GstRegistrationType.REGULAR,
      panNumber: null,
      panLast4: null,
      panVerified: false,
      isDefault: true,
      isActive: true,
    },
  });
  console.log(`✓ platform_gst_profiles: created 1 placeholder row — CA must replace before strict-mode flip`);
}

// ───────────────────────────────────────────────────────────────
// Entry point
// ───────────────────────────────────────────────────────────────

async function main() {
  console.log('GST Phase 1 — tax master data seed starting…');
  await seedIndiaStates();
  await seedUqcMaster();
  await seedHsnMaster();
  await seedTaxConfig();
  await seedPlatformGstProfile();
  console.log('GST Phase 1 — seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
