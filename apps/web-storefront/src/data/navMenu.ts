// Source of truth for the storefront navigation. Mirrors the Shopify "Main menu"
// structure. Static for now; can be swapped to a CMS/menu API later.

export interface MenuItem {
  label: string;
  href: string;
}

export interface Sport {
  slug: string;
  name: string;
  // Items shown in column 2 of the mega-menu when this sport is selected.
  products: MenuItem[];
}

export interface NavGroup {
  heading: string;
  items: MenuItem[];
}

export interface TopNavItem {
  label: string;
  href?: string;
  // SHOP BY SPORT — two-column tabbed mega-menu (sports → products).
  sports?: Sport[];
  // MEN / WOMEN / KIDS / BRAND — flat grouped mega-menu.
  groups?: NavGroup[];
}

const buildProductHref = (sport: string, type: string) =>
  `/products?sport=${sport}&type=${type}`;

const cricketProducts: MenuItem[] = [
  { label: 'Cricket Bats',           href: buildProductHref('cricket', 'bats') },
  { label: 'Cricket Balls',          href: buildProductHref('cricket', 'balls') },
  { label: 'Cricket Shoes',          href: buildProductHref('cricket', 'shoes') },
  { label: 'Cricket Batting Gloves', href: buildProductHref('cricket', 'batting-gloves') },
  { label: 'Cricket Batting Pads',   href: buildProductHref('cricket', 'batting-pads') },
  { label: 'Wicket Keeping Gloves',  href: buildProductHref('cricket', 'wk-gloves') },
  { label: 'Wicket Keeping Pads',    href: buildProductHref('cricket', 'wk-pads') },
  { label: 'Cricket Helmets',        href: buildProductHref('cricket', 'helmets') },
  { label: 'Cricket Kit Bags',       href: buildProductHref('cricket', 'kit-bags') },
  { label: 'Cricket Thigh Guards',   href: buildProductHref('cricket', 'thigh-guards') },
  { label: 'Cricket Elbow Guard',    href: buildProductHref('cricket', 'elbow-guard') },
  { label: 'Cricket Chest Guards',   href: buildProductHref('cricket', 'chest-guards') },
  { label: 'Cricket Accessories',    href: buildProductHref('cricket', 'accessories') },
];

const footballProducts: MenuItem[] = [
  { label: 'Football Boots',         href: buildProductHref('football', 'boots') },
  { label: 'Footballs',              href: buildProductHref('football', 'balls') },
  { label: 'Jerseys',                href: buildProductHref('football', 'jerseys') },
  { label: 'Shin Guards',            href: buildProductHref('football', 'shin-guards') },
  { label: 'Goalkeeper Gloves',      href: buildProductHref('football', 'gk-gloves') },
  { label: 'Football Accessories',   href: buildProductHref('football', 'accessories') },
];

const badmintonProducts: MenuItem[] = [
  { label: 'Badminton Rackets',      href: buildProductHref('badminton', 'rackets') },
  { label: 'Shuttlecocks',           href: buildProductHref('badminton', 'shuttles') },
  { label: 'Badminton Shoes',        href: buildProductHref('badminton', 'shoes') },
  { label: 'Strings & Grips',        href: buildProductHref('badminton', 'strings') },
  { label: 'Badminton Bags',         href: buildProductHref('badminton', 'bags') },
  { label: 'Badminton Accessories',  href: buildProductHref('badminton', 'accessories') },
];

const hockeyProducts: MenuItem[] = [
  { label: 'Hockey Sticks',          href: buildProductHref('hockey', 'sticks') },
  { label: 'Hockey Balls',           href: buildProductHref('hockey', 'balls') },
  { label: 'Hockey Shoes',           href: buildProductHref('hockey', 'shoes') },
  { label: 'Shin Guards',            href: buildProductHref('hockey', 'shin-guards') },
  { label: 'Goalkeeping Kit',        href: buildProductHref('hockey', 'goalkeeping') },
  { label: 'Hockey Accessories',     href: buildProductHref('hockey', 'accessories') },
];

const tennisProducts: MenuItem[] = [
  { label: 'Tennis Rackets',         href: buildProductHref('tennis', 'rackets') },
  { label: 'Tennis Balls',           href: buildProductHref('tennis', 'balls') },
  { label: 'Tennis Shoes',           href: buildProductHref('tennis', 'shoes') },
  { label: 'Strings & Grips',        href: buildProductHref('tennis', 'strings') },
  { label: 'Tennis Bags',            href: buildProductHref('tennis', 'bags') },
];

const pickleballProducts: MenuItem[] = [
  { label: 'Pickleball Paddles',     href: buildProductHref('pickleball', 'paddles') },
  { label: 'Pickleball Balls',       href: buildProductHref('pickleball', 'balls') },
  { label: 'Pickleball Shoes',       href: buildProductHref('pickleball', 'shoes') },
  { label: 'Pickleball Bags',        href: buildProductHref('pickleball', 'bags') },
];

const volleyballProducts: MenuItem[] = [
  { label: 'Volleyballs',            href: buildProductHref('volleyball', 'balls') },
  { label: 'Volleyball Shoes',       href: buildProductHref('volleyball', 'shoes') },
  { label: 'Knee Pads',              href: buildProductHref('volleyball', 'knee-pads') },
  { label: 'Nets & Posts',           href: buildProductHref('volleyball', 'nets') },
];

const basketballProducts: MenuItem[] = [
  { label: 'Basketballs',            href: buildProductHref('basketball', 'balls') },
  { label: 'Basketball Shoes',       href: buildProductHref('basketball', 'shoes') },
  { label: 'Jerseys',                href: buildProductHref('basketball', 'jerseys') },
  { label: 'Hoops & Backboards',     href: buildProductHref('basketball', 'hoops') },
];

const indoorProducts: MenuItem[] = [
  { label: 'Table Tennis',           href: buildProductHref('indoor', 'table-tennis') },
  { label: 'Carrom',                 href: buildProductHref('indoor', 'carrom') },
  { label: 'Chess',                  href: buildProductHref('indoor', 'chess') },
  { label: 'Snooker & Pool',         href: buildProductHref('indoor', 'snooker') },
  { label: 'Dart Boards',            href: buildProductHref('indoor', 'darts') },
];

export const SPORTS: Sport[] = [
  { slug: 'cricket',     name: 'Cricket',     products: cricketProducts },
  { slug: 'football',    name: 'Football',    products: footballProducts },
  { slug: 'badminton',   name: 'Badminton',   products: badmintonProducts },
  { slug: 'hockey',      name: 'Hockey',      products: hockeyProducts },
  { slug: 'tennis',      name: 'Tennis',      products: tennisProducts },
  { slug: 'pickleball',  name: 'Pickleball',  products: pickleballProducts },
  { slug: 'volleyball',  name: 'Volleyball',  products: volleyballProducts },
  { slug: 'basketball',  name: 'Basketball',  products: basketballProducts },
  { slug: 'indoor',      name: 'Indoor Games',products: indoorProducts },
];

const trainingGroups: NavGroup[] = [
  {
    heading: 'Apparel',
    items: [
      { label: 'T-shirts & Tops',    href: '/products?cat=training&type=tops' },
      { label: 'Shorts & Track',     href: '/products?cat=training&type=bottoms' },
      { label: 'Hoodies & Jackets',  href: '/products?cat=training&type=outerwear' },
      { label: 'Compression Wear',   href: '/products?cat=training&type=compression' },
    ],
  },
  {
    heading: 'Footwear',
    items: [
      { label: 'Running Shoes',      href: '/products?cat=training&type=running-shoes' },
      { label: 'Training Shoes',     href: '/products?cat=training&type=gym-shoes' },
      { label: 'Walking Shoes',      href: '/products?cat=training&type=walking' },
    ],
  },
  {
    heading: 'Equipment',
    items: [
      { label: 'Yoga Mats & Blocks', href: '/products?cat=training&type=yoga' },
      { label: 'Resistance Bands',   href: '/products?cat=training&type=bands' },
      { label: 'Dumbbells & Plates', href: '/products?cat=training&type=weights' },
      { label: 'Skipping Ropes',     href: '/products?cat=training&type=ropes' },
      { label: 'Foam Rollers',       href: '/products?cat=training&type=recovery' },
    ],
  },
  {
    heading: 'Nutrition',
    items: [
      { label: 'Whey Protein',       href: '/products?cat=training&type=protein' },
      { label: 'Creatine',           href: '/products?cat=training&type=creatine' },
      { label: 'Energy Bars',        href: '/products?cat=training&type=bars' },
      { label: 'Hydration',          href: '/products?cat=training&type=hydration' },
    ],
  },
];

const buildGenderGroups = (gender: 'men' | 'women' | 'kids'): NavGroup[] => [
  {
    heading: 'Footwear',
    items: [
      { label: 'Running Shoes',  href: `/products?gender=${gender}&type=running-shoes` },
      { label: 'Cricket Shoes',  href: `/products?gender=${gender}&type=cricket-shoes` },
      { label: 'Football Boots', href: `/products?gender=${gender}&type=football-boots` },
      { label: 'Tennis Shoes',   href: `/products?gender=${gender}&type=tennis-shoes` },
      { label: 'Casuals',        href: `/products?gender=${gender}&type=casuals` },
    ],
  },
  {
    heading: 'Apparel',
    items: [
      { label: 'T-shirts',       href: `/products?gender=${gender}&type=tshirts` },
      { label: 'Shorts',         href: `/products?gender=${gender}&type=shorts` },
      { label: 'Track Pants',    href: `/products?gender=${gender}&type=trackpants` },
      { label: 'Jackets',        href: `/products?gender=${gender}&type=jackets` },
      { label: 'Jerseys',        href: `/products?gender=${gender}&type=jerseys` },
    ],
  },
  {
    heading: 'Accessories',
    items: [
      { label: 'Caps & Hats',    href: `/products?gender=${gender}&type=caps` },
      { label: 'Socks',          href: `/products?gender=${gender}&type=socks` },
      { label: 'Bags',           href: `/products?gender=${gender}&type=bags` },
      { label: 'Watches',        href: `/products?gender=${gender}&type=watches` },
    ],
  },
];

const brandGroups: NavGroup[] = [
  {
    heading: 'International',
    items: [
      { label: 'Nike',         href: '/products?brand=nike' },
      { label: 'Adidas',       href: '/products?brand=adidas' },
      { label: 'Puma',         href: '/products?brand=puma' },
      { label: 'Asics',        href: '/products?brand=asics' },
      { label: 'Reebok',       href: '/products?brand=reebok' },
      { label: 'New Balance',  href: '/products?brand=new-balance' },
    ],
  },
  {
    heading: 'India',
    items: [
      { label: 'SM (Sportsmart)', href: '/products?brand=sm' },
      { label: 'SG',              href: '/products?brand=sg' },
      { label: 'Yonex',           href: '/products?brand=yonex' },
      { label: 'Cosco',           href: '/products?brand=cosco' },
    ],
  },
  {
    heading: 'Featured',
    items: [
      { label: 'New brand drops',     href: '/products?view=new-brands' },
      { label: 'Bestselling brands',  href: '/products?view=top-brands' },
      { label: 'Sale by brand',       href: '/products?view=brand-sale' },
    ],
  },
];

export const TOP_NAV: TopNavItem[] = [
  { label: 'Shop by Sport',        sports: SPORTS },
  { label: 'Training & Fitness',   groups: trainingGroups },
  { label: 'Men',                  groups: buildGenderGroups('men') },
  { label: 'Women',                groups: buildGenderGroups('women') },
  { label: 'Kids',                 groups: buildGenderGroups('kids') },
  { label: 'Brand',                groups: brandGroups },
];
