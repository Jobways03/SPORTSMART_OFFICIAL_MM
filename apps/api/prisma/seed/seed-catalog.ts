import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Data definitions
// ---------------------------------------------------------------------------

interface CategoryDef {
  name: string;
  children?: CategoryDef[];
}

const CATEGORY_TREE: CategoryDef[] = [
  {
    name: 'Footwear',
    children: [
      {
        name: 'Running Shoes',
        children: [{ name: 'Road Running' }, { name: 'Trail Running' }],
      },
      { name: 'Cricket Shoes', children: [{ name: 'Batting Shoes' }, { name: 'Bowling Shoes' }] },
      { name: 'Football Boots' },
      { name: 'Badminton Shoes' },
      { name: 'Training Shoes' },
    ],
  },
  {
    name: 'Apparel',
    children: [
      { name: 'T-Shirts' },
      { name: 'Shorts' },
      { name: 'Track Pants' },
      { name: 'Jerseys' },
      { name: 'Jackets' },
    ],
  },
  {
    name: 'Equipment',
    children: [
      { name: 'Cricket Bats' },
      { name: 'Footballs' },
      { name: 'Badminton Rackets' },
      { name: 'Gym Equipment' },
      { name: 'Yoga Mats' },
    ],
  },
  {
    name: 'Accessories',
    children: [
      { name: 'Bags' },
      { name: 'Socks' },
      { name: 'Caps' },
      { name: 'Gloves' },
      { name: 'Water Bottles' },
    ],
  },
];

const BRANDS = [
  { name: 'Nike' },
  { name: 'Adidas' },
  { name: 'Puma' },
  { name: 'Reebok' },
  { name: 'Under Armour' },
  { name: 'New Balance' },
  { name: 'Asics' },
  { name: 'Yonex' },
  { name: 'SS (Sareen Sports)' },
  { name: 'SG (Stanford of Georgetown)' },
  { name: 'MRF' },
  { name: 'Kookaburra' },
  { name: 'Decathlon (Domyos)' },
  { name: 'Nivia' },
  { name: 'Cosco' },
];

const OPTION_DEFINITIONS: { name: string; displayName: string; type: string; values: string[] }[] = [
  {
    name: 'Size',
    displayName: 'Size',
    type: 'SIZE',
    values: ['5 UK', '6 UK', '7 UK', '8 UK', '9 UK', '10 UK', '11 UK', 'S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    name: 'Color',
    displayName: 'Color',
    type: 'COLOR',
    values: ['Red', 'Blue', 'Black', 'White', 'Green', 'Yellow', 'Orange', 'Grey', 'Navy', 'Pink'],
  },
  {
    name: 'Material',
    displayName: 'Material',
    type: 'GENERIC',
    values: ['Cotton', 'Polyester', 'Nylon', 'Leather', 'Mesh', 'Synthetic', 'Rubber'],
  },
];

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

/** Upsert a single category and return its id */
async function upsertCategory(
  name: string,
  level: number,
  sortOrder: number,
  parentId: string | null,
): Promise<string> {
  const slug = toSlug(name);
  const cat = await prisma.category.upsert({
    where: { slug },
    create: { name, slug, level, sortOrder, parentId },
    update: {},
  });
  return cat.id;
}

/** Recursively seed the category tree */
async function seedCategories(): Promise<Map<string, string>> {
  console.log('\n[1/4] Seeding categories...');
  const slugToId = new Map<string, string>();

  for (let i = 0; i < CATEGORY_TREE.length; i++) {
    const l0 = CATEGORY_TREE[i];
    const l0Id = await upsertCategory(l0.name, 0, i, null);
    slugToId.set(toSlug(l0.name), l0Id);
    console.log(`  L0: ${l0.name}`);

    if (l0.children) {
      for (let j = 0; j < l0.children.length; j++) {
        const l1 = l0.children[j];
        const l1Id = await upsertCategory(l1.name, 1, j, l0Id);
        slugToId.set(toSlug(l1.name), l1Id);
        console.log(`    L1: ${l1.name}`);

        if (l1.children) {
          for (let k = 0; k < l1.children.length; k++) {
            const l2 = l1.children[k];
            const l2Id = await upsertCategory(l2.name, 2, k, l1Id);
            slugToId.set(toSlug(l2.name), l2Id);
            console.log(`      L2: ${l2.name}`);
          }
        }
      }
    }
  }

  console.log(`  Total categories: ${slugToId.size}`);
  return slugToId;
}

async function seedBrands(): Promise<void> {
  console.log('\n[2/4] Seeding brands...');

  for (const brand of BRANDS) {
    const slug = toSlug(brand.name);
    await prisma.brand.upsert({
      where: { slug },
      create: { name: brand.name, slug },
      update: {},
    });
    console.log(`  Brand: ${brand.name} (${slug})`);
  }

  console.log(`  Total brands: ${BRANDS.length}`);
}

async function seedOptionsAndValues(): Promise<Map<string, string>> {
  console.log('\n[3/4] Seeding option definitions & values...');
  const optionNameToId = new Map<string, string>();

  for (const def of OPTION_DEFINITIONS) {
    const optDef = await prisma.optionDefinition.upsert({
      where: { name: def.name },
      create: { name: def.name, displayName: def.displayName, type: def.type },
      update: { type: def.type },
    });
    optionNameToId.set(def.name, optDef.id);
    console.log(`  Option: ${def.name} (${def.values.length} values)`);

    for (let i = 0; i < def.values.length; i++) {
      const val = def.values[i];
      await prisma.optionValue.upsert({
        where: {
          optionDefinitionId_value: {
            optionDefinitionId: optDef.id,
            value: val,
          },
        },
        create: {
          optionDefinitionId: optDef.id,
          value: val,
          displayValue: val,
          sortOrder: i,
        },
        update: {},
      });
    }
  }

  return optionNameToId;
}

async function seedCategoryOptionTemplates(
  categorySlugToId: Map<string, string>,
  optionNameToId: Map<string, string>,
): Promise<void> {
  console.log('\n[4/4] Seeding category option templates...');

  const sizeId = optionNameToId.get('Size')!;
  const colorId = optionNameToId.get('Color')!;

  // Helper to create a template
  async function addTemplate(
    categorySlug: string,
    optionDefId: string,
    isRequired: boolean,
    sortOrder: number,
  ) {
    const categoryId = categorySlugToId.get(categorySlug);
    if (!categoryId) {
      console.warn(`  WARNING: category slug "${categorySlug}" not found, skipping template`);
      return;
    }
    await prisma.categoryOptionTemplate.upsert({
      where: {
        categoryId_optionDefinitionId: {
          categoryId,
          optionDefinitionId: optionDefId,
        },
      },
      create: {
        categoryId,
        optionDefinitionId: optionDefId,
        isRequired,
        sortOrder,
      },
      update: {},
    });
  }

  // --- Footwear categories: Size (required), Color (optional) ---
  const footwearSlugs = [
    'footwear',
    'running-shoes',
    'road-running',
    'trail-running',
    'cricket-shoes',
    'batting-shoes',
    'bowling-shoes',
    'football-boots',
    'badminton-shoes',
    'training-shoes',
  ];

  for (const slug of footwearSlugs) {
    await addTemplate(slug, sizeId, true, 0);
    await addTemplate(slug, colorId, false, 1);
  }
  console.log(`  Footwear (${footwearSlugs.length} categories): Size (required), Color (optional)`);

  // --- Apparel categories: Size (required), Color (required) ---
  const apparelSlugs = [
    'apparel',
    't-shirts',
    'shorts',
    'track-pants',
    'jerseys',
    'jackets',
  ];

  for (const slug of apparelSlugs) {
    await addTemplate(slug, sizeId, true, 0);
    await addTemplate(slug, colorId, true, 1);
  }
  console.log(`  Apparel (${apparelSlugs.length} categories): Size (required), Color (required)`);

  // --- Equipment categories: no templates ---
  console.log('  Equipment: no templates (no variants)');

  // --- Accessories (parent + Bags, Socks, Caps): Size (optional), Color (optional) ---
  const accessorySlugs = ['accessories', 'bags', 'socks', 'caps'];

  for (const slug of accessorySlugs) {
    await addTemplate(slug, sizeId, false, 0);
    await addTemplate(slug, colorId, false, 1);
  }
  console.log(`  Accessories (${accessorySlugs.length} categories): Size (optional), Color (optional)`);

  const totalTemplates =
    footwearSlugs.length * 2 + apparelSlugs.length * 2 + accessorySlugs.length * 2;
  console.log(`  Total templates: ${totalTemplates}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== Catalog Seed Script ===');

  const categorySlugToId = await seedCategories();
  await seedBrands();
  const optionNameToId = await seedOptionsAndValues();
  await seedCategoryOptionTemplates(categorySlugToId, optionNameToId);

  console.log('\n=== Catalog seed complete ===');
}

main()
  .catch((e) => {
    console.error('Catalog seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
