// Seeds the "main-menu" storefront navigation tree.
// Idempotent: deletes existing menu items for this handle and recreates the
// tree on each run, so editing this file safely refreshes the menu.

import { PrismaClient, MenuLinkType } from '@prisma/client';

interface SeedItem {
  label: string;
  linkType?: MenuLinkType;
  linkRef?: string | null;
  children?: SeedItem[];
}

const sportProducts = (sport: string, types: Array<[string, string]>): SeedItem[] =>
  types.map(([label, slug]) => ({
    label,
    linkType: MenuLinkType.URL,
    linkRef: `/products?sport=${sport}&type=${slug}`,
  }));

const SHOP_BY_SPORT: SeedItem[] = [
  {
    label: 'Cricket',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=cricket',
    children: sportProducts('cricket', [
      ['Cricket Bats', 'bats'],
      ['Cricket Balls', 'balls'],
      ['Cricket Shoes', 'shoes'],
      ['Cricket Batting Gloves', 'batting-gloves'],
      ['Cricket Batting Pads', 'batting-pads'],
      ['Wicket Keeping Gloves', 'wk-gloves'],
      ['Wicket Keeping Pads', 'wk-pads'],
      ['Cricket Helmets', 'helmets'],
      ['Cricket Kit Bags', 'kit-bags'],
      ['Cricket Thigh Guards', 'thigh-guards'],
      ['Cricket Elbow Guard', 'elbow-guard'],
      ['Cricket Chest Guards', 'chest-guards'],
      ['Cricket Accessories', 'accessories'],
    ]),
  },
  {
    label: 'Football',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=football',
    children: sportProducts('football', [
      ['Football Boots', 'boots'],
      ['Footballs', 'balls'],
      ['Jerseys', 'jerseys'],
      ['Shin Guards', 'shin-guards'],
      ['Goalkeeper Gloves', 'gk-gloves'],
      ['Football Accessories', 'accessories'],
    ]),
  },
  {
    label: 'Badminton',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=badminton',
    children: sportProducts('badminton', [
      ['Badminton Rackets', 'rackets'],
      ['Shuttlecocks', 'shuttles'],
      ['Badminton Shoes', 'shoes'],
      ['Strings & Grips', 'strings'],
      ['Badminton Bags', 'bags'],
      ['Badminton Accessories', 'accessories'],
    ]),
  },
  {
    label: 'Hockey',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=hockey',
    children: sportProducts('hockey', [
      ['Hockey Sticks', 'sticks'],
      ['Hockey Balls', 'balls'],
      ['Hockey Shoes', 'shoes'],
      ['Shin Guards', 'shin-guards'],
      ['Goalkeeping Kit', 'goalkeeping'],
      ['Hockey Accessories', 'accessories'],
    ]),
  },
  {
    label: 'Tennis',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=tennis',
    children: sportProducts('tennis', [
      ['Tennis Rackets', 'rackets'],
      ['Tennis Balls', 'balls'],
      ['Tennis Shoes', 'shoes'],
      ['Strings & Grips', 'strings'],
      ['Tennis Bags', 'bags'],
    ]),
  },
  {
    label: 'Pickleball',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=pickleball',
    children: sportProducts('pickleball', [
      ['Pickleball Paddles', 'paddles'],
      ['Pickleball Balls', 'balls'],
      ['Pickleball Shoes', 'shoes'],
      ['Pickleball Bags', 'bags'],
    ]),
  },
  {
    label: 'Volleyball',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=volleyball',
    children: sportProducts('volleyball', [
      ['Volleyballs', 'balls'],
      ['Volleyball Shoes', 'shoes'],
      ['Knee Pads', 'knee-pads'],
      ['Nets & Posts', 'nets'],
    ]),
  },
  {
    label: 'Basketball',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=basketball',
    children: sportProducts('basketball', [
      ['Basketballs', 'balls'],
      ['Basketball Shoes', 'shoes'],
      ['Jerseys', 'jerseys'],
      ['Hoops & Backboards', 'hoops'],
    ]),
  },
  {
    label: 'Indoor Games',
    linkType: MenuLinkType.URL,
    linkRef: '/products?sport=indoor',
    children: sportProducts('indoor', [
      ['Table Tennis', 'table-tennis'],
      ['Carrom', 'carrom'],
      ['Chess', 'chess'],
      ['Snooker & Pool', 'snooker'],
      ['Dart Boards', 'darts'],
    ]),
  },
];

const TRAINING_FITNESS: SeedItem[] = [
  {
    label: 'Apparel',
    children: [
      { label: 'T-shirts & Tops',   linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=tops' },
      { label: 'Shorts & Track',    linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=bottoms' },
      { label: 'Hoodies & Jackets', linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=outerwear' },
      { label: 'Compression Wear',  linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=compression' },
    ],
  },
  {
    label: 'Footwear',
    children: [
      { label: 'Running Shoes',  linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=running-shoes' },
      { label: 'Training Shoes', linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=gym-shoes' },
      { label: 'Walking Shoes',  linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=walking' },
    ],
  },
  {
    label: 'Equipment',
    children: [
      { label: 'Yoga Mats & Blocks', linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=yoga' },
      { label: 'Resistance Bands',   linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=bands' },
      { label: 'Dumbbells & Plates', linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=weights' },
      { label: 'Skipping Ropes',     linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=ropes' },
      { label: 'Foam Rollers',       linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=recovery' },
    ],
  },
  {
    label: 'Nutrition',
    children: [
      { label: 'Whey Protein', linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=protein' },
      { label: 'Creatine',     linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=creatine' },
      { label: 'Energy Bars',  linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=bars' },
      { label: 'Hydration',    linkType: MenuLinkType.URL, linkRef: '/products?cat=training&type=hydration' },
    ],
  },
];

const genderGroups = (gender: 'men' | 'women' | 'kids'): SeedItem[] => [
  {
    label: 'Footwear',
    children: [
      { label: 'Running Shoes',  linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=running-shoes` },
      { label: 'Cricket Shoes',  linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=cricket-shoes` },
      { label: 'Football Boots', linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=football-boots` },
      { label: 'Tennis Shoes',   linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=tennis-shoes` },
      { label: 'Casuals',        linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=casuals` },
    ],
  },
  {
    label: 'Apparel',
    children: [
      { label: 'T-shirts',    linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=tshirts` },
      { label: 'Shorts',      linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=shorts` },
      { label: 'Track Pants', linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=trackpants` },
      { label: 'Jackets',     linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=jackets` },
      { label: 'Jerseys',     linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=jerseys` },
    ],
  },
  {
    label: 'Accessories',
    children: [
      { label: 'Caps & Hats', linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=caps` },
      { label: 'Socks',       linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=socks` },
      { label: 'Bags',        linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=bags` },
      { label: 'Watches',     linkType: MenuLinkType.URL, linkRef: `/products?gender=${gender}&type=watches` },
    ],
  },
];

const BRANDS_GROUPS: SeedItem[] = [
  {
    label: 'International',
    children: [
      { label: 'Nike',        linkType: MenuLinkType.URL, linkRef: '/products?brand=nike' },
      { label: 'Adidas',      linkType: MenuLinkType.URL, linkRef: '/products?brand=adidas' },
      { label: 'Puma',        linkType: MenuLinkType.URL, linkRef: '/products?brand=puma' },
      { label: 'Asics',       linkType: MenuLinkType.URL, linkRef: '/products?brand=asics' },
      { label: 'Reebok',      linkType: MenuLinkType.URL, linkRef: '/products?brand=reebok' },
      { label: 'New Balance', linkType: MenuLinkType.URL, linkRef: '/products?brand=new-balance' },
    ],
  },
  {
    label: 'India',
    children: [
      { label: 'SM (Sportsmart)', linkType: MenuLinkType.URL, linkRef: '/products?brand=sm' },
      { label: 'SG',              linkType: MenuLinkType.URL, linkRef: '/products?brand=sg' },
      { label: 'Yonex',           linkType: MenuLinkType.URL, linkRef: '/products?brand=yonex' },
      { label: 'Cosco',           linkType: MenuLinkType.URL, linkRef: '/products?brand=cosco' },
    ],
  },
  {
    label: 'Featured',
    children: [
      { label: 'New brand drops',    linkType: MenuLinkType.URL, linkRef: '/products?view=new-brands' },
      { label: 'Bestselling brands', linkType: MenuLinkType.URL, linkRef: '/products?view=top-brands' },
      { label: 'Sale by brand',      linkType: MenuLinkType.URL, linkRef: '/products?view=brand-sale' },
    ],
  },
];

const TOP_LEVEL: SeedItem[] = [
  { label: 'Shop by Sport',      children: SHOP_BY_SPORT },
  { label: 'Training & Fitness', children: TRAINING_FITNESS },
  { label: 'Men',                children: genderGroups('men') },
  { label: 'Women',              children: genderGroups('women') },
  { label: 'Kids',               children: genderGroups('kids') },
  { label: 'Brand',              children: BRANDS_GROUPS },
];

async function insertItems(
  prisma: PrismaClient,
  menuId: string,
  items: SeedItem[],
  parentId: string | null,
) {
  let position = 0;
  for (const item of items) {
    const created = await prisma.storefrontMenuItem.create({
      data: {
        menuId,
        parentId,
        position: position++,
        label: item.label,
        linkType: item.linkType ?? MenuLinkType.NONE,
        linkRef: item.linkRef ?? null,
      },
    });
    if (item.children?.length) {
      await insertItems(prisma, menuId, item.children, created.id);
    }
  }
}

export async function seedStorefrontMenu(prisma: PrismaClient) {
  const HANDLE = 'main-menu';
  const NAME = 'Main menu';

  // Upsert the menu shell
  const menu = await prisma.storefrontMenu.upsert({
    where: { handle: HANDLE },
    update: { name: NAME },
    create: { handle: HANDLE, name: NAME },
  });

  // Wipe existing items, then re-insert. Cascade deletes children too.
  await prisma.storefrontMenuItem.deleteMany({ where: { menuId: menu.id } });
  await insertItems(prisma, menu.id, TOP_LEVEL, null);

  console.log(`✓ Seeded storefront menu '${HANDLE}' with ${TOP_LEVEL.length} top-level items.`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedStorefrontMenu(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
