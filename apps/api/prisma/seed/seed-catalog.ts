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
    name: 'Activewear & Clothing',
    children: [
      { name: 'T Shirts Tops' },
      { name: 'Shorts' },
      { name: 'Leggings Tights' },
      { name: 'Track Pants Joggers' },
      { name: 'Hoodies Sweatshirts' },
      { name: 'Jackets Windbreakers' },
      { name: 'Base Layers Compression' },
      { name: 'Tracksuits' },
      { name: 'Sports Socks' },
      { name: 'Sports Caps Headwear' },
    ],
  },
  {
    name: 'Archery',
    children: [
      { name: 'Bows' },
      { name: 'Arrows' },
      { name: 'Arrow Tips Points' },
      { name: 'Quivers' },
      { name: 'Archery Targets' },
      { name: 'Archery Protective Gear' },
      { name: 'Bow Sights Rests' },
      { name: 'Bowstrings Cables' },
      { name: 'Archery Bags Cases' },
      { name: 'Archery Accessories' },
    ],
  },
  {
    name: 'Badminton',
    children: [
      { name: 'Badminton Rackets' },
      { name: 'Badminton Strings' },
      { name: 'Shuttlecocks' },
      { name: 'Badminton Shoes' },
      { name: 'Badminton Clothing' },
      { name: 'Badminton Bags' },
      { name: 'Badminton Grips' },
      { name: 'Badminton Nets Posts' },
      { name: 'Badminton Accessories' },
    ],
  },
  {
    name: 'Baseball',
    children: [
      { name: 'Baseball Bats' },
      { name: 'Baseball Gloves' },
      { name: 'Baseballs Softballs' },
      { name: 'Baseball Helmets' },
      { name: 'Baseball Cleats' },
      { name: 'Baseball Protective Gear' },
      { name: 'Baseball Clothing' },
      { name: 'Baseball Batting Gloves' },
      { name: 'Baseball Bags' },
      { name: 'Baseball Training Equipment' },
      { name: 'Baseball Fielding Accessories' },
    ],
  },
  {
    name: 'Basketball',
    children: [
      { name: 'Basketball Shoes' },
      { name: 'Basketballs' },
      { name: 'Basketball Hoops' },
      { name: 'Basketball Clothing' },
      { name: 'Basketball Socks' },
      { name: 'Basketball Protective Gear' },
      { name: 'Basketball Bags' },
      { name: 'Basketball Training Equipment' },
    ],
  },
  {
    name: 'Boxing, MMA & Martial Arts',
    children: [
      { name: 'Boxing Gloves' },
      { name: 'MMA Gloves' },
      { name: 'Hand Wraps Inner Gloves' },
      { name: 'Punching Bags' },
      { name: 'Boxing Headgear' },
      { name: 'Focus Pads Shields' },
      { name: 'Boxing Protective Gear' },
      { name: 'Martial Arts Uniforms' },
      { name: 'Martial Arts Belts' },
      { name: 'Boxing Ring Cage Equipment' },
      { name: 'Boxing Training Equipment' },
      { name: 'Martial Arts Mats' },
    ],
  },
  {
    name: 'Cricket',
    children: [
      { name: 'Cricket Bats' },
      { name: 'Batting Gloves' },
      { name: 'Batting Pads' },
      { name: 'Wicket Keeping Pads' },
      { name: 'Thigh Guards' },
      { name: 'Cricket Helmets' },
      { name: 'Arm Guards' },
      { name: 'Chest Guards' },
      { name: 'Abdominal Guards' },
      { name: 'Wicket Keeping Gloves' },
      { name: 'Cricket Balls' },
      { name: 'Cricket Shoes' },
      { name: 'Cricket Bags' },
      { name: 'Cricket Clothing' },
      { name: 'Stumps and Bails' },
      { name: 'Inner Gloves' },
      { name: 'Bat Accessories' },
      { name: 'Cricket Training Equipment' },
    ],
  },
  {
    name: 'Cycling',
    children: [
      { name: 'Bicycles' },
      { name: 'Cycling Helmets' },
      { name: 'Cycling Clothing' },
      { name: 'Cycling Gloves' },
      { name: 'Cycling Lights' },
      { name: 'Cycling Locks' },
      { name: 'Cycling Tyres Tubes' },
      { name: 'Cycling Pedals' },
      { name: 'Cycling Saddles' },
      { name: 'Cycling Pumps Tools' },
      { name: 'Cycling Bags Storage' },
      { name: 'Cycling Accessories' },
      { name: 'Cycling Eyewear' },
    ],
  },
  {
    name: 'Field Hockey',
    children: [
      { name: 'Hockey Sticks' },
      { name: 'Hockey Balls' },
      { name: 'Hockey Shin Guards' },
      { name: 'Hockey Gloves' },
      { name: 'Hockey Goalkeeping Gear' },
      { name: 'Hockey Shoes' },
      { name: 'Hockey Clothing' },
      { name: 'Hockey Bags' },
      { name: 'Hockey Stick Accessories' },
      { name: 'Hockey Goals Nets' },
    ],
  },
  {
    name: 'Football',
    children: [
      { name: 'Football Boots' },
      { name: 'Footballs' },
      { name: 'Goalkeeper Gloves' },
      { name: 'Shin Guards' },
      { name: 'Football Kits' },
      { name: 'Football Socks' },
      { name: 'Goalkeeper Clothing' },
      { name: 'Football Goals' },
      { name: 'Football Bags' },
      { name: 'Football Training Equipment' },
      { name: 'Football Accessories' },
      { name: 'Referee Equipment' },
    ],
  },
  {
    name: 'Golf',
    children: [
      { name: 'Golf Clubs' },
      { name: 'Golf Balls' },
      { name: 'Golf Bags' },
      { name: 'Golf Gloves' },
      { name: 'Golf Shoes' },
      { name: 'Golf Clothing' },
      { name: 'Golf Trolleys Carts' },
      { name: 'Golf Rangefinders GPS' },
      { name: 'Golf Accessories' },
    ],
  },
  {
    name: 'Gym & Weight Training',
    children: [
      { name: 'Dumbbells' },
      { name: 'Barbells' },
      { name: 'Weight Plates' },
      { name: 'Kettlebells' },
      { name: 'Benches' },
      { name: 'Power Racks Cages' },
      { name: 'Cable Machines' },
      { name: 'Resistance Bands Tubes' },
      { name: 'Gym Machines' },
      { name: 'Cardio Machines' },
      { name: 'Pull Up Dip Stations' },
      { name: 'Gym Flooring' },
      { name: 'Weightlifting Accessories' },
    ],
  },
  {
    name: 'Handball',
    children: [
      { name: 'Handballs' },
      { name: 'Handball Shoes' },
      { name: 'Handball Goalkeeper Gear' },
      { name: 'Handball Clothing' },
      { name: 'Handball Protective Gear' },
      { name: 'Handball Grip Resin' },
      { name: 'Handball Goals Nets' },
      { name: 'Handball Bags' },
    ],
  },
  {
    name: 'Outdoor & Camping',
    children: [
      { name: 'Tents' },
      { name: 'Sleeping Bags' },
      { name: 'Sleeping Mats Pads' },
      { name: 'Backpacks Rucksacks' },
      { name: 'Camping Furniture' },
      { name: 'Camping Cooking' },
      { name: 'Torches Lanterns' },
      { name: 'Navigation Tools' },
      { name: 'Knives Multi Tools' },
      { name: 'Camping Accessories' },
    ],
  },
  {
    name: 'Rugby',
    children: [
      { name: 'Rugby Balls' },
      { name: 'Rugby Boots' },
      { name: 'Rugby Headguards' },
      { name: 'Rugby Body Armour' },
      { name: 'Rugby Mouthguards' },
      { name: 'Rugby Clothing' },
      { name: 'Rugby Gloves' },
      { name: 'Rugby Kicking Tees' },
      { name: 'Rugby Bags' },
      { name: 'Rugby Training Equipment' },
    ],
  },
  {
    name: 'Running & Athletics',
    children: [
      { name: 'Running Shoes' },
      { name: 'Athletics Spikes' },
      { name: 'Running Clothing' },
      { name: 'Running Socks' },
      { name: 'Running Watches Electronics' },
      { name: 'Hydration' },
      { name: 'Running Bags Belts' },
      { name: 'Running Accessories' },
      { name: 'Athletics Field Equipment' },
    ],
  },
  {
    name: 'Shoes',
    children: [
      { name: 'Casual Sneakers' },
      { name: 'Walking Shoes' },
      { name: 'Hiking Shoes' },
      { name: 'Gym Training Shoes' },
      { name: 'Cycling Shoes' },
      { name: 'Boxing Wrestling Shoes' },
      { name: 'Slides Sandals' },
      { name: 'Indoor Court Shoes' },
      { name: 'Skating Shoes' },
      { name: 'Water Shoes' },
      { name: 'Climbing Shoes' },
      { name: 'Football Studs' },
    ],
  },
  {
    name: 'Skateboarding',
    children: [
      { name: 'Skateboards Completes' },
      { name: 'Skateboard Decks' },
      { name: 'Skateboard Trucks' },
      { name: 'Skateboard Wheels' },
      { name: 'Skateboard Bearings' },
      { name: 'Longboard Components' },
      { name: 'Skateboard Grip Tape' },
      { name: 'Skateboard Hardware' },
      { name: 'Skateboard Protective Gear' },
      { name: 'Skateboard Tools Accessories' },
    ],
  },
  {
    name: 'Skiing & Snowboarding',
    children: [
      { name: 'Skis' },
      { name: 'Snowboards' },
      { name: 'Ski Snowboard Boots' },
      { name: 'Ski Snowboard Bindings' },
      { name: 'Snow Helmets' },
      { name: 'Snow Goggles' },
      { name: 'Snow Jackets' },
      { name: 'Snow Pants' },
      { name: 'Snow Gloves' },
      { name: 'Ski Poles' },
      { name: 'Snow Base Layers' },
      { name: 'Snow Bags Packs' },
      { name: 'Snow Accessories' },
    ],
  },
  {
    name: 'Sports Accessories',
    children: [
      { name: 'Water Bottles' },
      { name: 'Gym Towels' },
      { name: 'Sports Tape Supports' },
      { name: 'Wristbands Sweatbands' },
      { name: 'Sports Sunglasses' },
      { name: 'First Aid Kits' },
      { name: 'Whistles Coaching' },
      { name: 'Cones Markers' },
      { name: 'Agility Speed Equipment' },
      { name: 'Ball Pumps Accessories' },
      { name: 'Phone Armbands Holders' },
    ],
  },
  {
    name: 'Sports Electronics',
    children: [
      { name: 'Fitness Trackers' },
      { name: 'Sports Watches' },
      { name: 'Heart Rate Monitors' },
      { name: 'Cycling Computers' },
      { name: 'Action Cameras' },
      { name: 'Sports Headphones' },
      { name: 'GPS Handheld Devices' },
      { name: 'Speed Distance Sensors' },
      { name: 'Sports Cameras Mounts' },
      { name: 'Smart Jump Ropes Equipment' },
    ],
  },
  {
    name: 'Sports Equipment Storage',
    children: [
      { name: 'Ball Racks Storage' },
      { name: 'Shoe Racks Organizers' },
      { name: 'Dumbbell Weight Racks' },
      { name: 'Equipment Bags Holdalls' },
      { name: 'Lockers Cabinets' },
      { name: 'Bat Racket Holders' },
      { name: 'Gym Storage Organizers' },
      { name: 'Bike Storage' },
    ],
  },
  {
    name: 'Sports Nutrition',
    children: [
      { name: 'Protein Powder' },
      { name: 'Protein Bars Snacks' },
      { name: 'Pre Workout' },
      { name: 'Creatine' },
      { name: 'BCAA Amino Acids' },
      { name: 'Energy Gels Drinks' },
      { name: 'Vitamins Supplements' },
      { name: 'Meal Replacements' },
    ],
  },
  {
    name: 'Squash & Racquetball',
    children: [
      { name: 'Squash Racquets' },
      { name: 'Racquetball Racquets' },
      { name: 'Squash Balls' },
      { name: 'Racquetball Balls' },
      { name: 'Squash Racquetball Shoes' },
      { name: 'Squash Racquetball Strings' },
      { name: 'Squash Racquetball Grips' },
      { name: 'Squash Racquetball Eyewear' },
      { name: 'Squash Racquetball Bags' },
      { name: 'Squash Racquetball Accessories' },
    ],
  },
  {
    name: 'Surfing & Water Sports',
    children: [
      { name: 'Surfboards' },
      { name: 'Wetsuits' },
      { name: 'Surf Fins' },
      { name: 'Surf Leashes' },
      { name: 'Paddle Boards' },
      { name: 'Paddles' },
      { name: 'Kayaks' },
      { name: 'Bodyboards' },
      { name: 'Life Jackets PFDs' },
      { name: 'Surf Wax Traction' },
      { name: 'Water Sports Bags' },
      { name: 'Water Sports Accessories' },
    ],
  },
  {
    name: 'Swimming',
    children: [
      { name: 'Swimwear' },
      { name: 'Swim Goggles' },
      { name: 'Swim Caps' },
      { name: 'Swim Fins' },
      { name: 'Swim Training Aids' },
      { name: 'Swim Bags' },
      { name: 'Swim Towels' },
      { name: 'Open Water Gear' },
      { name: 'Swim Accessories' },
    ],
  },
  {
    name: 'Table Tennis',
    children: [
      { name: 'Table Tennis Bats' },
      { name: 'Table Tennis Blades' },
      { name: 'Table Tennis Rubbers' },
      { name: 'Table Tennis Balls' },
      { name: 'Table Tennis Tables' },
      { name: 'Table Tennis Nets' },
      { name: 'Table Tennis Clothing' },
      { name: 'Table Tennis Shoes' },
      { name: 'Table Tennis Bags' },
      { name: 'Table Tennis Accessories' },
    ],
  },
  {
    name: 'Team Uniforms & Custom Printing',
    children: [
      { name: 'Football Kits' },
      { name: 'Cricket Uniforms' },
      { name: 'Basketball Uniforms' },
      { name: 'Rugby Uniforms' },
      { name: 'Hockey Uniforms' },
      { name: 'Volleyball Uniforms' },
      { name: 'Baseball Uniforms' },
      { name: 'Custom Printing Services' },
      { name: 'Team Training Wear' },
      { name: 'Team Accessories' },
    ],
  },
  {
    name: 'Tennis',
    children: [
      { name: 'Tennis Rackets' },
      { name: 'Tennis Strings' },
      { name: 'Tennis Balls' },
      { name: 'Tennis Shoes' },
      { name: 'Tennis Clothing' },
      { name: 'Tennis Bags' },
      { name: 'Tennis Grips Overgrips' },
      { name: 'Tennis Accessories' },
      { name: 'Tennis Nets Court Equipment' },
    ],
  },
  {
    name: 'Volleyball',
    children: [
      { name: 'Volleyballs' },
      { name: 'Volleyball Shoes' },
      { name: 'Volleyball Clothing' },
      { name: 'Volleyball Protective Gear' },
      { name: 'Volleyball Nets Posts' },
      { name: 'Volleyball Bags' },
      { name: 'Volleyball Training Equipment' },
    ],
  },
  {
    name: 'Yoga & Fitness',
    children: [
      { name: 'Yoga Mats' },
      { name: 'Yoga Accessories' },
      { name: 'Dumbbells Weights' },
      { name: 'Resistance Bands' },
      { name: 'Fitness Clothing' },
      { name: 'Foam Rollers Recovery' },
      { name: 'Exercise Mats' },
      { name: 'Fitness Equipment' },
      { name: 'Fitness Bags' },
      { name: 'Water Bottles Shakers' },
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
    update: { name, level, sortOrder, parentId },
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
    console.log(`  L0: ${l0.name} (${toSlug(l0.name)})`);

    if (l0.children) {
      for (let j = 0; j < l0.children.length; j++) {
        const l1 = l0.children[j];
        const l1Id = await upsertCategory(l1.name, 1, j, l0Id);
        slugToId.set(toSlug(l1.name), l1Id);
        console.log(`    L1: ${l1.name} (${toSlug(l1.name)})`);
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

  async function addTemplate(
    categorySlug: string,
    optionDefId: string,
    isRequired: boolean,
    sortOrder: number,
  ) {
    const categoryId = categorySlugToId.get(categorySlug);
    if (!categoryId) return;
    await prisma.categoryOptionTemplate.upsert({
      where: {
        categoryId_optionDefinitionId: {
          categoryId,
          optionDefinitionId: optionDefId,
        },
      },
      create: { categoryId, optionDefinitionId: optionDefId, isRequired, sortOrder },
      update: {},
    });
  }

  // Footwear-related categories: Size (required), Color (optional)
  const footwearSlugs = [
    'shoes', 'casual-sneakers', 'walking-shoes', 'hiking-shoes', 'gym-training-shoes',
    'cycling-shoes', 'boxing-wrestling-shoes', 'indoor-court-shoes', 'skating-shoes',
    'water-shoes', 'climbing-shoes', 'football-studs', 'slides-sandals',
    'running-shoes', 'athletics-spikes', 'badminton-shoes', 'basketball-shoes',
    'cricket-shoes', 'football-boots', 'golf-shoes', 'handball-shoes',
    'hockey-shoes', 'rugby-boots', 'squash-racquetball-shoes', 'table-tennis-shoes',
    'tennis-shoes', 'volleyball-shoes', 'ski-snowboard-boots',
  ];
  for (const slug of footwearSlugs) {
    await addTemplate(slug, sizeId, true, 0);
    await addTemplate(slug, colorId, false, 1);
  }
  console.log(`  Footwear (${footwearSlugs.length} categories): Size (required), Color (optional)`);

  // Clothing categories: Size (required), Color (required)
  const clothingSlugs = [
    'activewear-clothing', 't-shirts-tops', 'shorts', 'leggings-tights',
    'track-pants-joggers', 'hoodies-sweatshirts', 'jackets-windbreakers',
    'base-layers-compression', 'tracksuits', 'badminton-clothing', 'basketball-clothing',
    'cricket-clothing', 'cycling-clothing', 'football-kits', 'golf-clothing',
    'handball-clothing', 'hockey-clothing', 'rugby-clothing', 'running-clothing',
    'swimming', 'swimwear', 'table-tennis-clothing', 'tennis-clothing',
    'volleyball-clothing', 'fitness-clothing', 'snow-jackets', 'snow-pants',
    'snow-base-layers', 'martial-arts-uniforms', 'goalkeeper-clothing',
    'baseball-clothing', 'team-training-wear',
  ];
  for (const slug of clothingSlugs) {
    await addTemplate(slug, sizeId, true, 0);
    await addTemplate(slug, colorId, true, 1);
  }
  console.log(`  Clothing (${clothingSlugs.length} categories): Size (required), Color (required)`);

  console.log('  Done.');
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
