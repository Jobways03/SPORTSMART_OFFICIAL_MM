import React, {useEffect, useMemo, useState} from 'react';
import {
  Image,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {SPORTSMART_LOGO} from '../../assets/logo';
import {useNavigation} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {
  ArrowRight,
  Bell,
  ChevronRight,
  Crown,
  Facebook,
  Flame,
  Gift,
  Globe,
  GraduationCap,
  Headphones,
  Heart,
  Instagram,
  Leaf,
  Lock,
  MapPin,
  Newspaper,
  Package,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Trophy,
  Truck,
  Twitter,
  Wallet,
  Youtube,
  Zap,
} from 'lucide-react-native';
// Trophy retained — used in CONCIERGE service-tile icons.
import {useMenu} from '../../queries/useMenu';
import {useProducts} from '../../queries/useProducts';
import {
  useBrands,
  useCategories,
  useCollections,
} from '../../queries/useCatalogRefs';
import {useStorefrontStats} from '../../queries/useStorefrontStats';
import {useTickets} from '../../queries/useSupport';
import {useStorefrontConfig} from '../../queries/useStorefrontConfig';
import {
  useEditorial,
  useEvents,
  useFlashSale,
  usePress,
  useStoresSummary,
  useTestimonials,
} from '../../queries/useStorefrontContent';
import {useAuth} from '../../context/AuthContext';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {ProductCard} from '../../components/ProductCard';
import {CachedImage} from '../../components/CachedImage';
import {Gradient} from '../../components/Gradient';
import {formatINR} from '../../lib/format';
import {emojiFor} from '../../lib/category-emoji';
import type {AppTabParamList} from '../../navigation/types';

type Nav = BottomTabNavigationProp<AppTabParamList, 'HomeTab'>;

// Matches the seeded handle in apps/api/prisma/seed/seed-menu.ts —
// keep this in sync with the web storefront (Navbar.tsx) so all
// clients query the same menu tree.
const MAIN_MENU_HANDLE = 'main-menu';

// ── Deep-blue premium palette — cool + confident ────────────────────
// Cool slate base, blue primary, indigo+navy for premium chips, orange
// kept as the single warm accent (discount/urgency pops harder against
// blue). Inspired by Decathlon / Nike Run / Linear — athletic + technical.
// Property names (sage/coral/gold) preserved across files for code
// compatibility; their *meanings* are blue/orange/navy now.
const C = {
  // Surfaces
  bg: '#f4f7fb',           // cool off-white page
  surface: '#ffffff',      // pure white cards
  surfaceWarm: '#fafafa',  // soft cool surface (was warm cream)
  surfaceSage: '#f5f5f5',  // sky-blue tint — primary accent surface
  surfaceCoral: '#fee2e2', // rose tint — urgency / discount surface
  surfaceGold: '#fecaca',  // indigo tint — premium surface (was gold)
  surfaceMauve: '#e4e4e7', // slate tint
  border: '#e4e4e7',       // cool hairline

  // Text — slate
  ink: '#0a0a0a',          // deep slate near-black
  inkSoft: '#1a1a1a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',

  // Accents (semantic role kept; old names preserved for cross-file consistency)
  sage: '#ef4444',         // primary blue
  sageDeep: '#dc2626',     // deep blue — primary CTA / active state
  coral: '#fb923c',        // warm orange — urgency / discount badges
  coralDeep: '#ea580c',
  gold: '#b91c1c',         // navy — premium / member surfaces
  goldDeep: '#991b1b',     // deep navy — premium ink
  blush: '#a5b4fc',        // indigo blush
  sky: '#bae6fd',          // pale sky
};

// ── Content ──────────────────────────────────────────────────────────

// Static UI-only shortcuts — these are layout primitives, not data.
// PRICE_BUCKETS are derived navigation targets into BrowseScreen
// filters, not items in a CMS; CONCIERGE is a fixed service menu
// with React-icon components (icons aren't data).

const PRICE_BUCKETS = [
  {label: 'Under ₹999', sub: 'Steals', bg: '#fee2e2', maxPrice: 999},
  {label: 'Under ₹2,999', sub: 'Value', bg: '#fee2e2', maxPrice: 2999},
  {label: 'Premium', sub: 'Pro gear', bg: '#fee2e2', minPrice: 5000},
] as const;

const CONCIERGE = [
  {Icon: Crown, title: 'Personal shopper', sub: 'Chat with a stylist'},
  {Icon: Trophy, title: 'Custom fitting', sub: 'In-store + at home'},
  {Icon: Gift, title: 'Gift wrapping', sub: 'Eco-friendly, free'},
  {Icon: Zap, title: 'Express delivery', sub: 'Same-day in metros'},
];

// Uniform red tint for the category / sport / collection / editorial
// rails so every tile reads as one cohesive brand set (rose surface +
// red accent), matching the icon tiles across the app. Single-entry
// arrays: the index lookups below resolve to this one red treatment.
const SPORT_TINTS = [{bg: '#fee2e2', accent: '#dc2626'}];

const COLLECTION_TINTS = [{bg: '#fee2e2', fg: '#dc2626'}];

const EDITORIAL_TINTS = [{accent: '#dc2626', accentSoft: '#fee2e2'}];

// Marketing-grade count formatter for stats chips: 50000 → "50K+",
// 500 → "500+", 12 → "12". Matches the AboutScreen helper.
function formatBigCount(n?: number): string {
  if (!Number.isFinite(n) || !n || n <= 0) return '—';
  if (n >= 1_000_000) return `${Math.floor(n / 100_000) / 10}M+`;
  if (n >= 10_000) return `${Math.floor(n / 1_000)}K+`;
  if (n >= 1_000) return `${Math.floor(n / 100) / 10}K+`;
  return `${n.toLocaleString('en-IN')}+`;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(n => n.toString().padStart(2, '0')).join(':');
}

// ── Atoms ────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  subtitle,
  action,
  onActionPress,
}: {
  title: string;
  subtitle?: string;
  action?: string;
  onActionPress?: () => void;
}) {
  return (
    <View className="flex-row items-end justify-between mb-3">
      <View className="flex-1 flex-row items-start">
        {/* Small accent bar before the title — anchors the section
            visually and adds a recurring rhythm to the home page. */}
        <View
          className="rounded-full mr-3 mt-1.5"
          style={{
            width: 3,
            height: 18,
            backgroundColor: C.sageDeep,
          }}
        />
        <View className="flex-1">
          <Text
            className="font-black"
            style={{color: C.ink, fontSize: 19, letterSpacing: -0.4}}>
            {title}
          </Text>
          {subtitle ? (
            <Text
              className="text-xs mt-0.5"
              style={{color: C.textTertiary}}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {action ? (
        // Gradient pill — matches the filter-button signature so every
        // "View all" link across the home page reads as a premium
        // affordance, not a flat tag.
        <View
          style={{
            borderRadius: 999,
            overflow: 'hidden',
            shadowColor: C.sageDeep,
            shadowOpacity: 0.22,
            shadowOffset: {width: 0, height: 3},
            shadowRadius: 6,
            elevation: 3,
          }}>
          <Gradient
            colors={[C.sageDeep, C.ink]}
            angle={135}
            borderRadius={999}>
            <TouchableOpacity
              onPress={onActionPress}
              activeOpacity={0.85}
              className="px-3 py-1.5">
              <Text
                className="text-[11px] font-bold"
                style={{color: 'white', letterSpacing: 0.2}}>
                {action} →
              </Text>
            </TouchableOpacity>
          </Gradient>
        </View>
      ) : null}
    </View>
  );
}

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const {user} = useAuth();
  const menuQuery = useMenu(MAIN_MENU_HANDLE);
  const featuredQuery = useProducts({page: 1, limit: 6});
  const newArrivalsQuery = useProducts({page: 1, limit: 8});

  // Reference data — categories, brands, collections — drives every
  // "shop by X" rail. Slow staleTime keeps these off the wire during
  // a session.
  const categoriesQuery = useCategories();
  // Support tickets drive the bell: tapping it opens the Support page, and
  // the dot shows only when there's an open ticket awaiting you.
  const ticketsQuery = useTickets();
  const hasOpenTicket = (ticketsQuery.data?.items ?? []).some(t =>
    ['OPEN', 'PENDING', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_AGENT'].includes(
      (t.status ?? '').toUpperCase(),
    ),
  );
  const brandsQuery = useBrands();
  const collectionsQuery = useCollections();

  // Stats + config drive the chip counts and the membership/CTA
  // prices. useStorefrontConfig() merges API → fallback so the
  // returned object is always fully populated.
  const statsQuery = useStorefrontStats();
  const config = useStorefrontConfig();

  // Tier-B "content" hooks. Each returns [] / null on error so the
  // consuming section can simply skip rendering when empty.
  const editorialQuery = useEditorial();
  const testimonialsQuery = useTestimonials();
  const pressQuery = usePress();
  const eventsQuery = useEvents();
  const storesQuery = useStoresSummary();
  const flashSaleQuery = useFlashSale();

  // Live countdown — uses the active flash sale's endsAt when one
  // exists. Falls back to a synthetic window so the flash strip can
  // still demo, but we hide it when neither source is available.
  const flashSaleEndsAt = useMemo(() => {
    const remote = flashSaleQuery.data?.endsAt;
    if (remote) {
      const t = Date.parse(remote);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  }, [flashSaleQuery.data?.endsAt]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const countdownMs = flashSaleEndsAt ? flashSaleEndsAt - now : 0;
  const countdown = formatCountdown(countdownMs);
  const hasActiveFlashSale = flashSaleEndsAt != null && countdownMs > 0;

  const isLoading = menuQuery.isLoading || featuredQuery.isLoading;
  const isError = menuQuery.isError && featuredQuery.isError;

  const onRefresh = () => {
    menuQuery.refetch();
    featuredQuery.refetch();
    newArrivalsQuery.refetch();
  };

  const goToBrowse = () => nav.navigate('BrowseTab', {screen: 'Browse'});
  // "Top 100" best sellers — Browse sorted by units sold, filters cleared.
  const goToBestSellers = () =>
    nav.navigate('BrowseTab', {screen: 'Browse', params: {sort: 'popular'}});
  // Price tiles deep-link into Browse with their bucket bounds applied.
  const goToPriceBucket = (bucket: {minPrice?: number; maxPrice?: number}) =>
    nav.navigate('BrowseTab', {
      screen: 'Browse',
      params: {minPrice: bucket.minPrice, maxPrice: bucket.maxPrice},
    });
  const goToCart = () => nav.navigate('CartTab', {screen: 'Cart'});
  // Bell → Support (your tickets); the dot flags an open ticket.
  const goToSupport = () => nav.navigate('AccountTab', {screen: 'Tickets'});
  const goToProduct = (slug: string) =>
    nav.navigate('BrowseTab', {
      screen: 'ProductDetail',
      params: {productSlug: slug},
    });

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <Spinner fullscreen />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <ErrorState onRetry={onRefresh} />
      </SafeAreaView>
    );
  }

  const firstName = user?.firstName?.split(' ')[0] ?? 'there';
  const products = featuredQuery.data?.products ?? [];
  const newArrivals = newArrivalsQuery.data?.products ?? [];

  // Pull the derived data each section consumes, with sensible
  // fallbacks so the page never shows raw "undefined" or empty
  // pills while a hook is still loading.
  const stats = statsQuery.data ?? {};
  const categories = categoriesQuery.data ?? [];
  const brands = brandsQuery.data ?? [];
  const collections = collectionsQuery.data ?? [];
  const editorialStories = editorialQuery.data ?? [];
  const testimonials = testimonialsQuery.data?.items ?? [];
  const testimonialsTotal =
    testimonialsQuery.data?.total ?? testimonials.length;
  const pressLogos = pressQuery.data ?? [];
  const events = eventsQuery.data ?? [];
  const stores = storesQuery.data;
  const flashSale = flashSaleQuery.data;

  // The stats strip: each cell falls back to a sensible default
  // when the API hasn't responded yet. averageRating renders with
  // a star when present.
  const displayStats = [
    {value: formatBigCount(stats.athletes ?? 50_000), label: 'Athletes'},
    {value: formatBigCount(stats.products ?? 10_000), label: 'Products'},
    {value: formatBigCount(stats.brands ?? 500), label: 'Brands'},
    {
      value:
        stats.averageRating != null
          ? `${stats.averageRating.toFixed(1)}★`
          : '4.8★',
      label: 'Rated',
    },
  ];

  // Featured-sport is the one with the highest product count when
  // the backend gives us counts; otherwise the first category.
  const featuredCategory = categories.length
    ? [...categories].sort(
        (a, b) => (b.productCount ?? 0) - (a.productCount ?? 0),
      )[0]
    : null;
  const otherCategories = featuredCategory
    ? categories.filter(c => c.id !== featuredCategory.id)
    : [];

  // Store-locator subtitle. Backend may return total + top cities;
  // gracefully degrade to a generic line when missing.
  const storeSubtitle = stores
    ? `${stores.total} stores · ${(stores.topCities ?? []).slice(0, 3).join(', ')}${
        (stores.topCities ?? []).length > 3 ? ' +' : ''
      }`
    : 'Find a store near you';

  return (
    <SafeAreaView
      className="flex-1"
      style={{backgroundColor: C.bg}}
      edges={['top']}>
      <ScrollView
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={menuQuery.isRefetching || featuredQuery.isRefetching}
            onRefresh={onRefresh}
            tintColor={C.sageDeep}
          />
        }>
        {/* Sticky top header — pinned as the feed scrolls (index 0 of
            stickyHeaderIndices), matching the fixed Browse / Cart headers. */}
        <View style={{backgroundColor: C.surface}}>
        {/* ── 0. Brand logo ──────────────────────────────────────── */}
        <View className="px-5 pt-3 pb-1 flex-row items-center justify-between">
          <Image
            source={{uri: SPORTSMART_LOGO}}
            style={{width: 148, height: 32}}
            resizeMode="contain"
            accessibilityLabel="SportsMart"
          />
          <View className="flex-row" style={{gap: 8}}>
            <TouchableOpacity
              className="w-10 h-10 rounded-full items-center justify-center relative"
              style={{backgroundColor: C.surfaceWarm}}
              onPress={goToSupport}
              activeOpacity={0.7}>
              <Bell color={C.ink} size={17} />
              {hasOpenTicket ? (
                <View
                  className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                  style={{backgroundColor: C.sageDeep}}
                />
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity
              testID="home-cart"
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{backgroundColor: C.surfaceWarm}}
              onPress={goToCart}
              activeOpacity={0.7}>
              <ShoppingBag color={C.ink} size={17} />
            </TouchableOpacity>
          </View>
        </View>
        {/* ── 1. Top utility strip ─────────────────────────────── */}
        <View
          className="px-5 pt-2 pb-1 flex-row items-center justify-between"
          style={{backgroundColor: C.surface}}>
          <View className="flex-row items-center">
            <MapPin color={C.textTertiary} size={11} />
            <Text
              className="text-[11px] ml-1"
              style={{color: C.textTertiary}}>
              Deliver to{' '}
              <Text className="font-semibold" style={{color: C.ink}}>
                India
              </Text>
            </Text>
          </View>
          <View className="flex-row items-center">
            <Globe color={C.textTertiary} size={11} />
            <Text
              className="text-[11px] ml-1 font-medium"
              style={{color: C.textTertiary}}>
              EN · INR
            </Text>
          </View>
        </View>

        {/* ── 2. Header — accent bar + eyebrow + title, matching the
            Browse / Cart rhythm for consistent tab headers. ───────── */}
        <View
          className="px-5 pt-1 pb-4 flex-row items-center justify-between"
          style={{backgroundColor: C.surface}}>
          <View className="flex-1 flex-row items-start">
            {/* Accent bar — recurring rhythm across the tab headers. */}
            <View
              className="rounded-full mr-3 mt-1.5"
              style={{width: 3, height: 30, backgroundColor: C.sageDeep}}
            />
            <View className="flex-1">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.sageDeep, letterSpacing: 2}}>
                {getGreeting().toUpperCase()}
              </Text>
              <View className="flex-row items-center mt-0.5">
                <Text
                  className="font-black"
                  style={{
                    color: C.ink,
                    fontSize: 26,
                    letterSpacing: -0.8,
                    lineHeight: 30,
                    flexShrink: 1,
                  }}
                  numberOfLines={1}>
                  Hi {firstName}
                </Text>
                <View
                  className="ml-2 flex-row items-center px-2 py-0.5 rounded-full"
                  style={{backgroundColor: C.surfaceGold}}>
                  <Crown color={C.goldDeep} size={10} />
                  <Text
                    className="text-[9px] font-bold ml-1"
                    style={{color: C.goldDeep, letterSpacing: 0.5}}>
                    MEMBER
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
        </View>

        {/* ── 4. PREMIUM HERO — dark gradient editorial ─────────── */}
        <View className="px-5 pt-3">
          <Gradient
            colors={[C.ink, C.goldDeep, '#312e81']}
            angle={150}
            borderRadius={24}
            style={{minHeight: 360}}>
            {/* Soft glow blobs over the gradient — picked up by SVG
                background so they read as light reflections, not flat shapes. */}
            <View
              className="absolute rounded-full"
              style={{
                width: 280,
                height: 280,
                right: -90,
                top: -100,
                backgroundColor: C.sage,
                opacity: 0.22,
              }}
            />
            <View
              className="absolute rounded-full"
              style={{
                width: 200,
                height: 200,
                left: -60,
                bottom: -80,
                backgroundColor: C.coral,
                opacity: 0.18,
              }}
            />

            <View className="p-7">
              <View className="flex-row items-center mb-5">
                <View
                  className="w-1 h-3 rounded-full mr-2"
                  style={{backgroundColor: C.sage}}
                />
                <Text
                  className="text-[10px] font-bold tracking-widest"
                  style={{color: C.surfaceSage, letterSpacing: 2.5}}>
                  AUTUMN · WINTER · 2026
                </Text>
              </View>
              <Text
                className="font-black"
                style={{
                  color: 'white',
                  fontSize: 44,
                  lineHeight: 46,
                  letterSpacing: -1.5,
                }}>
                Unleash{'\n'}your game.
              </Text>
              <Text
                className="text-sm mt-4 leading-5"
                style={{
                  color: 'rgba(255,255,255,0.78)',
                  maxWidth: '88%',
                }}>
                The new collection. Performance gear engineered with
                the world's best athletes.
              </Text>

              <View className="flex-row mt-7" style={{gap: 8}}>
                <TouchableOpacity
                  className="rounded-full px-6 py-3.5 flex-row items-center"
                  style={{backgroundColor: 'white'}}
                  onPress={goToBrowse}
                  activeOpacity={0.85}>
                  <Text
                    className="text-xs font-bold mr-1.5"
                    style={{color: C.ink, letterSpacing: 0.3}}>
                    Shop collection
                  </Text>
                  <ArrowRight color={C.ink} size={14} />
                </TouchableOpacity>
              </View>

              {/* Meta strip */}
              <View
                className="flex-row mt-10 pt-5 border-t"
                style={{borderColor: 'rgba(255,255,255,0.14)'}}>
                <View className="flex-1">
                  <Text
                    className="text-[10px] font-bold tracking-widest"
                    style={{color: C.sage, letterSpacing: 1.5}}>
                    LIMITED
                  </Text>
                  <Text
                    className="text-xs mt-1"
                    style={{color: 'white', fontWeight: '500'}}>
                    200 pieces
                  </Text>
                </View>
                <View className="flex-1">
                  <Text
                    className="text-[10px] font-bold tracking-widest"
                    style={{color: C.sage, letterSpacing: 1.5}}>
                    LAUNCH
                  </Text>
                  <Text
                    className="text-xs mt-1"
                    style={{color: 'white', fontWeight: '500'}}>
                    Live now
                  </Text>
                </View>
                <View className="flex-1">
                  <Text
                    className="text-[10px] font-bold tracking-widest"
                    style={{color: C.sage, letterSpacing: 1.5}}>
                    SHIPS
                  </Text>
                  <Text
                    className="text-xs mt-1"
                    style={{color: 'white', fontWeight: '500'}}>
                    24 hrs
                  </Text>
                </View>
              </View>
            </View>
          </Gradient>
        </View>

        {/* ── 8. Flash sale strip — only renders when one is live ── */}
        {hasActiveFlashSale && flashSale ? (
          <View className="px-5 pt-7">
            <TouchableOpacity
              className="rounded-2xl overflow-hidden flex-row items-center p-4"
              style={{backgroundColor: C.surfaceCoral}}
              onPress={goToBrowse}
              activeOpacity={0.9}>
              <View
                className="w-11 h-11 rounded-full items-center justify-center mr-4"
                style={{backgroundColor: C.coralDeep}}>
                <Flame color="white" size={20} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] font-bold tracking-widest mb-0.5"
                  style={{color: C.coralDeep, letterSpacing: 2}}>
                  FLASH SALE
                </Text>
                <Text
                  className="font-bold text-base"
                  style={{color: C.ink}}>
                  {flashSale.title}
                </Text>
                <Text
                  className="text-xs mt-0.5"
                  style={{color: C.inkSoft}}>
                  Ends in {countdown}
                </Text>
              </View>
              <ChevronRight color={C.coralDeep} size={20} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── 9. EDITORIAL stories — hides when CMS has no stories ── */}
        {editorialStories.length > 0 ? (
        <View className="pt-7">
          <View className="px-5">
            <SectionHeader
              title="Stories"
              subtitle="Reads from our editors"
              action="The journal"
              onActionPress={() => {}}
            />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{paddingHorizontal: 20, gap: 12}}>
            {editorialStories.map((story, idx) => {
              const tint = EDITORIAL_TINTS[idx % EDITORIAL_TINTS.length];
              return (
              <TouchableOpacity
                key={story.id}
                className="rounded-2xl overflow-hidden"
                style={{
                  width: 280,
                  height: 280,
                  backgroundColor: C.surface,
                }}
                onPress={goToBrowse}
                activeOpacity={0.9}>
                {/* Top accent plate */}
                <View
                  className="flex-1 p-5 justify-end"
                  style={{backgroundColor: tint.accentSoft}}>
                  <Text
                    className="text-[10px] font-bold tracking-widest"
                    style={{color: tint.accent, letterSpacing: 2}}>
                    {story.tag}
                  </Text>
                </View>
                {/* Body */}
                <View
                  className="p-5"
                  style={{backgroundColor: C.surface, height: 140}}>
                  <Text
                    className="font-bold mb-2"
                    style={{
                      color: C.ink,
                      fontSize: 17,
                      lineHeight: 22,
                      letterSpacing: -0.3,
                    }}
                    numberOfLines={2}>
                    {story.title}
                  </Text>
                  <Text
                    className="text-xs mt-1"
                    style={{color: C.textSecondary}}
                    numberOfLines={2}>
                    {story.subtitle}
                  </Text>
                  <View className="flex-row items-center mt-auto">
                    <Text
                      className="text-[10px]"
                      style={{color: C.textMuted, letterSpacing: 0.5}}>
                      {story.minutesRead
                        ? `${story.minutesRead} min read`
                        : ''}
                    </Text>
                    <View
                      className="mx-2 w-1 h-1 rounded-full"
                      style={{backgroundColor: C.textMuted}}
                    />
                    <Text
                      className="text-[10px] font-bold"
                      style={{color: tint.accent, letterSpacing: 0.5}}>
                      READ →
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
        ) : null}

        {/* ── 10. Shop by sport — bento layout, fully data-driven ── */}
        {featuredCategory ? (
          <View className="pt-7">
            <View className="px-5">
              <SectionHeader
                title="Shop by sport"
                subtitle="Gear up for your game"
                action="View all"
                onActionPress={goToBrowse}
              />
            </View>

            {/* Hero featured card — highest-product-count category */}
            {(() => {
              const tint = SPORT_TINTS[0];
              const count = featuredCategory.productCount;
              return (
                <View className="px-5">
                  <TouchableOpacity
                    className="rounded-2xl overflow-hidden relative flex-row items-center p-5 mb-2"
                    style={{
                      backgroundColor: tint.bg,
                      minHeight: 120,
                    }}
                    onPress={goToBrowse}
                    activeOpacity={0.85}>
                    <View
                      className="absolute rounded-full"
                      style={{
                        width: 180,
                        height: 180,
                        right: -50,
                        bottom: -70,
                        backgroundColor: tint.accent,
                        opacity: 0.12,
                      }}
                    />
                    <View
                      className="absolute"
                      style={{right: 20, top: 14}}>
                      <Text style={{fontSize: 84}}>
                        {emojiFor(featuredCategory.slug, featuredCategory.name)}
                      </Text>
                    </View>
                    <View className="flex-1" style={{maxWidth: '60%'}}>
                      <Text
                        className="text-[10px] font-bold tracking-widest mb-2"
                        style={{color: tint.accent, letterSpacing: 1.8}}>
                        MOST POPULAR
                      </Text>
                      <Text
                        className="font-black"
                        style={{
                          color: C.ink,
                          fontSize: 28,
                          letterSpacing: -1,
                          lineHeight: 30,
                        }}>
                        {featuredCategory.name}
                      </Text>
                      {count ? (
                        <Text
                          className="text-xs mt-1"
                          style={{color: C.textSecondary}}>
                          {formatBigCount(count)} products
                        </Text>
                      ) : null}
                      <View className="flex-row items-center mt-3">
                        <Text
                          className="text-xs font-bold mr-1"
                          style={{color: tint.accent}}>
                          Explore
                        </Text>
                        <ArrowRight color={tint.accent} size={12} />
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })()}

            {/* 3-col grid for the rest, capped at 6 so the bento stays balanced */}
            <View
              className="px-5 flex-row flex-wrap"
              style={{gap: 8}}>
              {otherCategories.slice(0, 6).map((sport, idx) => {
                // +1 because index 0 belongs to the featured hero tint
                const tint = SPORT_TINTS[(idx + 1) % SPORT_TINTS.length];
                return (
                  <TouchableOpacity
                    key={sport.id}
                    className="rounded-2xl overflow-hidden relative p-3 justify-between"
                    style={{
                      width: '31.5%',
                      aspectRatio: 0.95,
                      backgroundColor: tint.bg,
                    }}
                    onPress={goToBrowse}
                    activeOpacity={0.7}>
                    <View
                      className="absolute"
                      style={{right: -6, top: -4}}>
                      <Text style={{fontSize: 56, opacity: 0.95}}>
                        {emojiFor(sport.slug, sport.name)}
                      </Text>
                    </View>
                    <View style={{marginTop: 'auto'}}>
                      <Text
                        className="font-bold"
                        style={{
                          color: C.ink,
                          fontSize: 13,
                          letterSpacing: -0.2,
                        }}>
                        {sport.name}
                      </Text>
                      {sport.productCount ? (
                        <Text
                          className="text-[10px] mt-0.5 font-medium"
                          style={{color: tint.accent, letterSpacing: 0.2}}>
                          {formatBigCount(sport.productCount)} items
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ── 11. Top brands — hides when no brands returned ─────── */}
        {brands.length > 0 ? (
        <View className="pt-7">
          <View className="px-5">
            <SectionHeader
              title="Top brands"
              subtitle="The names you trust"
              action="Explore"
              onActionPress={goToBrowse}
            />
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{paddingHorizontal: 20, gap: 12}}>
            {brands.slice(0, 12).map(brand => (
              <TouchableOpacity
                key={brand.id}
                className="items-center"
                onPress={goToBrowse}
                activeOpacity={0.7}>
                <View
                  className="w-16 h-16 rounded-full items-center justify-center mb-2 overflow-hidden"
                  style={{backgroundColor: C.surfaceCoral}}>
                  {brand.logoUrl ? (
                    <CachedImage
                      source={{uri: brand.logoUrl}}
                      className="w-10 h-10"
                      resizeMode="contain"
                    />
                  ) : (
                    <Text
                      className="font-black text-base"
                      style={{color: C.sageDeep, letterSpacing: -0.5}}>
                      {brand.name.charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
                <Text
                  className="text-[10px] font-semibold"
                  style={{
                    color: C.textSecondary,
                    width: 64,
                    textAlign: 'center',
                  }}
                  numberOfLines={1}>
                  {brand.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        ) : null}

        {/* ── 13. New arrivals ─────────────────────────────────── */}
        {newArrivals.length > 0 ? (
          <View className="pt-7">
            <View className="px-5">
              <SectionHeader
                title="New arrivals"
                subtitle="Fresh drops this week"
                action="See all"
                onActionPress={goToBrowse}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{paddingHorizontal: 20, gap: 12}}>
              {newArrivals.map(p => (
                <View key={p.id} style={{width: 160}}>
                  <ProductCard
                    product={p}
                    widthPercent={100}
                    onPress={goToProduct}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* ── 14. EXCLUSIVE DROPS — only when a members-only flash sale is live ── */}
        {flashSale?.membersOnly ? (
          <View className="px-5 pt-7">
            <TouchableOpacity
              className="rounded-2xl overflow-hidden p-6 relative"
              style={{backgroundColor: C.surfaceGold}}
              activeOpacity={0.9}
              onPress={goToBrowse}>
              <View
                className="absolute rounded-full"
                style={{
                  width: 200,
                  height: 200,
                  right: -60,
                  top: -60,
                  backgroundColor: C.gold,
                  opacity: 0.15,
                }}
              />
              <View className="flex-row items-center mb-3">
                <Lock color={C.goldDeep} size={13} />
                <Text
                  className="text-[10px] font-bold tracking-widest ml-1.5"
                  style={{color: C.goldDeep, letterSpacing: 2}}>
                  MEMBERS ONLY
                </Text>
              </View>
              <Text
                className="font-black"
                style={{
                  color: C.ink,
                  fontSize: 32,
                  lineHeight: 36,
                  letterSpacing: -1,
                }}>
                {flashSale.title}
              </Text>
              {flashSale.subtitle ? (
                <Text
                  className="text-sm mt-3 mb-5"
                  style={{color: C.textSecondary, maxWidth: '80%'}}>
                  {flashSale.subtitle}
                </Text>
              ) : (
                <View style={{height: 20}} />
              )}
              <View className="flex-row items-center" style={{gap: 12}}>
                <TouchableOpacity
                  className="rounded-full px-5 py-2.5"
                  style={{backgroundColor: C.ink}}
                  onPress={goToBrowse}
                  activeOpacity={0.85}>
                  <Text className="text-xs font-bold text-white">
                    Join waitlist
                  </Text>
                </TouchableOpacity>
                {flashSale.waitlistCount && flashSale.waitlistCount > 0 ? (
                  <Text
                    className="text-[11px]"
                    style={{color: C.textTertiary}}>
                    {flashSale.waitlistCount.toLocaleString('en-IN')}+ waiting
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── 15. Featured collections — hides when curation empty ── */}
        {collections.length > 0 ? (
          <View className="pt-7">
            <View className="px-5">
              <SectionHeader
                title="Featured collections"
                subtitle="Curated for every athlete"
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{paddingHorizontal: 20, gap: 12}}>
              {collections.map((c, idx) => {
                const tint =
                  COLLECTION_TINTS[idx % COLLECTION_TINTS.length];
                return (
                  <TouchableOpacity
                    key={c.id}
                    className="rounded-2xl overflow-hidden justify-end p-5"
                    style={{
                      width: 200,
                      height: 160,
                      backgroundColor: tint.bg,
                    }}
                    onPress={goToBrowse}
                    activeOpacity={0.9}>
                    <Text
                      className="text-[10px] font-bold tracking-widest mb-1"
                      style={{color: tint.fg, letterSpacing: 1.5}}>
                      COLLECTION
                    </Text>
                    <Text
                      className="font-bold"
                      style={{
                        color: C.ink,
                        fontSize: 18,
                        letterSpacing: -0.3,
                      }}
                      numberOfLines={2}>
                      {c.name}
                    </Text>
                    {c.productCount ? (
                      <Text
                        className="text-xs mt-1"
                        style={{color: C.textSecondary}}>
                        {formatBigCount(c.productCount)} items
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* ── 16. Shop by price — tinted tiles ──────────────────── */}
        <View className="pt-7">
          <View className="px-5">
            <SectionHeader
              title="Shop by price"
              subtitle="Quality at every budget"
            />
          </View>
          <View className="px-5 flex-row" style={{gap: 8}}>
            {PRICE_BUCKETS.map(bucket => (
              <TouchableOpacity
                key={bucket.label}
                className="flex-1 rounded-2xl p-4 items-start"
                style={{backgroundColor: bucket.bg}}
                onPress={() => goToPriceBucket(bucket)}
                activeOpacity={0.7}>
                <Text
                  className="text-[10px] font-bold tracking-widest"
                  style={{color: C.textTertiary, letterSpacing: 1.5}}>
                  {bucket.sub.toUpperCase()}
                </Text>
                <Text
                  className="font-bold mt-2"
                  style={{
                    color: C.ink,
                    fontSize: 14,
                    letterSpacing: -0.2,
                  }}
                  numberOfLines={1}>
                  {bucket.label}
                </Text>
                <Text
                  className="text-[11px] mt-1"
                  style={{color: C.sageDeep, fontWeight: '700'}}>
                  Shop →
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── 17. Best sellers ranked ──────────────────────────── */}
        {products.length >= 3 ? (
          <View className="pt-7">
            <View className="px-5">
              <SectionHeader
                title="Best sellers"
                subtitle="What everyone's grabbing"
                action="Top 100"
                onActionPress={goToBestSellers}
              />
            </View>
            <View className="px-5" style={{gap: 10}}>
              {products.slice(0, 3).map((p, idx) => (
                <TouchableOpacity
                  key={p.id}
                  className="rounded-2xl flex-row items-center p-3 relative overflow-hidden"
                  style={{backgroundColor: C.surface}}
                  onPress={() => goToProduct(p.slug)}
                  activeOpacity={0.7}>
                  {/* Rank ribbon — gradient stripe matching the
                      filter-button signature for the #1 spot;
                      lighter medals for #2 / #3. */}
                  <View
                    className="absolute left-0 top-0 bottom-0"
                    style={{
                      width: 4,
                      overflow: 'hidden',
                    }}>
                    {idx === 0 ? (
                      <Gradient
                        colors={[C.sageDeep, C.ink]}
                        angle={180}
                        style={{width: '100%', height: '100%'}}
                      />
                    ) : (
                      <View
                        style={{
                          width: '100%',
                          height: '100%',
                          backgroundColor: idx === 1 ? C.sage : C.coral,
                        }}
                      />
                    )}
                  </View>

                  {/* Product image thumb */}
                  <View
                    className="w-16 h-16 rounded-xl overflow-hidden mr-3 ml-2"
                    style={{backgroundColor: C.surfaceWarm}}>
                    {p.primaryImageUrl ? (
                      <CachedImage
                        source={{uri: p.primaryImageUrl}}
                        className="w-full h-full"
                        resizeMode="cover"
                      />
                    ) : (
                      <View className="w-full h-full items-center justify-center">
                        <Text style={{fontSize: 22, opacity: 0.4}}>📦</Text>
                      </View>
                    )}
                  </View>

                  {/* Body */}
                  <View className="flex-1 mr-2">
                    <View className="flex-row items-center mb-1">
                      {/* Rank chip — #1 gets the premium gradient
                          treatment, #2 / #3 stay as soft tinted
                          chips to keep the medal hierarchy clear. */}
                      {idx === 0 ? (
                        <View
                          style={{
                            borderRadius: 999,
                            overflow: 'hidden',
                            marginRight: 6,
                            shadowColor: C.sageDeep,
                            shadowOpacity: 0.22,
                            shadowOffset: {width: 0, height: 2},
                            shadowRadius: 4,
                            elevation: 2,
                          }}>
                          <Gradient
                            colors={[C.sageDeep, C.ink]}
                            angle={135}
                            borderRadius={999}>
                            <View className="px-1.5 py-0.5">
                              <Text
                                className="text-[9px] font-black"
                                style={{
                                  color: 'white',
                                  letterSpacing: 0.3,
                                }}>
                                #1
                              </Text>
                            </View>
                          </Gradient>
                        </View>
                      ) : (
                        <View
                          className="rounded-full px-1.5 py-0.5 mr-1.5"
                          style={{
                            backgroundColor:
                              idx === 1
                                ? C.surfaceSage
                                : C.surfaceCoral,
                          }}>
                          <Text
                            className="text-[9px] font-black"
                            style={{
                              color:
                                idx === 1
                                  ? C.sageDeep
                                  : C.coralDeep,
                              letterSpacing: 0.3,
                            }}>
                            #{idx + 1}
                          </Text>
                        </View>
                      )}
                      {p.brandName ? (
                        <Text
                          className="text-[10px] font-bold uppercase"
                          style={{
                            color: C.textTertiary,
                            letterSpacing: 1,
                          }}
                          numberOfLines={1}>
                          {p.brandName
                            .replace(/\s*\([^)]*\)\s*/g, '')
                            .trim()}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      className="font-semibold text-[13px]"
                      style={{color: C.ink, letterSpacing: -0.2}}
                      numberOfLines={1}>
                      {p.title}
                    </Text>
                    <View className="flex-row items-center mt-1">
                      <Star color={C.gold} size={10} fill={C.gold} />
                      <Text
                        className="text-[10px] ml-1 font-medium"
                        style={{color: C.textSecondary}}>
                        4.{8 - idx} · {1 + idx}.{2 + idx}k sold
                      </Text>
                    </View>
                  </View>

                  {/* Price */}
                  <Text
                    className="text-sm font-bold"
                    style={{color: C.ink, letterSpacing: -0.3}}>
                    ₹{p.price?.toLocaleString('en-IN') ?? '—'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── 18. Featured grid ─────────────────────────────────── */}
        <View className="px-5 pt-7 pb-2">
          <SectionHeader
            title="Featured"
            subtitle="Hand-picked for you"
            action="See all"
            onActionPress={goToBrowse}
          />
          <View
            className="flex-row flex-wrap justify-between"
            style={{alignItems: 'flex-start'}}>
            {products.map(p => (
              // Each card wrapped in a fixed 48%-width View so the
              // image (aspect-square) is the same height for every card
              // and the grid columns stay perfectly aligned.
              <View key={p.id} style={{width: '48%'}}>
                <ProductCard
                  product={p}
                  widthPercent={100}
                  onPress={goToProduct}
                />
              </View>
            ))}
          </View>
          {products.length === 0 ? (
            <View className="py-10 items-center">
              <Text className="text-5xl mb-2">📦</Text>
              <Text
                className="text-sm text-center"
                style={{color: C.textTertiary}}>
                No products yet — seed the catalog and pull to refresh.
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── 19. CONCIERGE SERVICES — white tiles ──────────────── */}
        <View className="px-5 pt-7">
          <View className="mb-3">
            <Text
              className="text-[10px] font-bold tracking-widest mb-1"
              style={{color: C.goldDeep, letterSpacing: 2}}>
              CONCIERGE
            </Text>
            <Text
              className="font-bold"
              style={{color: C.ink, fontSize: 18, letterSpacing: -0.3}}>
              The Sportsmart service
            </Text>
            <Text
              className="text-xs mt-0.5"
              style={{color: C.textTertiary}}>
              White-glove care, included with every order
            </Text>
          </View>
          <View className="flex-row flex-wrap" style={{gap: 8}}>
            {CONCIERGE.map(svc => {
              return (
                <TouchableOpacity
                  key={svc.title}
                  className="rounded-2xl p-4"
                  style={{
                    width: '48.5%',
                    backgroundColor: C.surface,
                  }}
                  activeOpacity={0.85}>
                  <View
                    className="w-10 h-10 rounded-xl items-center justify-center mb-3"
                    style={{backgroundColor: C.surfaceCoral}}>
                    <svc.Icon color={C.sageDeep} size={18} />
                  </View>
                  <Text
                    className="font-bold text-sm mb-0.5"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    {svc.title}
                  </Text>
                  <Text
                    className="text-[11px]"
                    style={{color: C.textTertiary}}>
                    {svc.sub}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── 20. ACADEMIES — sage card ─────────────────────────── */}
        <View className="px-5 pt-4">
          <TouchableOpacity
            className="rounded-2xl overflow-hidden flex-row"
            style={{backgroundColor: C.surfaceSage}}
            activeOpacity={0.9}>
            <View className="flex-1 p-5">
              <Text
                className="text-[10px] font-bold tracking-widest mb-2"
                style={{color: C.sageDeep, letterSpacing: 2}}>
                ACADEMY
              </Text>
              <Text
                className="font-bold text-base"
                style={{color: C.ink}}>
                Train with the pros
              </Text>
              <Text
                className="text-xs mt-1 leading-4"
                style={{color: C.textSecondary}}>
                Cricket, tennis, and football academies across 12 cities.
              </Text>
              <View className="flex-row items-center mt-3">
                <Text
                  className="text-xs font-bold mr-1"
                  style={{color: C.sageDeep}}>
                  Find a centre
                </Text>
                <ArrowRight color={C.sageDeep} size={12} />
              </View>
            </View>
            <View
              className="w-20 items-center justify-center"
              style={{backgroundColor: C.sage}}>
              <GraduationCap color="white" size={32} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── 21. SUSTAINABILITY — sage white ───────────────────── */}
        <View className="px-5 pt-4">
          <View
            className="rounded-2xl p-5 flex-row items-center"
            style={{backgroundColor: C.surface}}>
            <View
              className="w-11 h-11 rounded-xl items-center justify-center mr-4"
              style={{backgroundColor: C.surfaceSage}}>
              <Leaf color={C.sageDeep} size={20} />
            </View>
            <View className="flex-1">
              <Text
                className="font-bold text-sm"
                style={{color: C.ink, letterSpacing: -0.2}}>
                Carbon-neutral shipping
              </Text>
              <Text
                className="text-xs mt-0.5 leading-4"
                style={{color: C.textTertiary}}>
                Every order offset. 100% recycled packaging.
              </Text>
            </View>
            <Text
              className="text-[10px] font-bold tracking-widest"
              style={{color: C.sageDeep, letterSpacing: 1.5}}>
              LEARN MORE
            </Text>
          </View>
        </View>

        {/* ── 22. GIFT CARDS — soft mauve ───────────────────────── */}
        <View className="px-5 pt-4">
          <TouchableOpacity
            className="rounded-2xl overflow-hidden flex-row items-center p-5 relative"
            style={{backgroundColor: C.surfaceMauve}}
            activeOpacity={0.9}>
            <View
              className="absolute rounded-full"
              style={{
                width: 160,
                height: 160,
                right: -50,
                top: -50,
                backgroundColor: C.blush,
                opacity: 0.4,
              }}
            />
            <View
              className="w-12 h-12 rounded-2xl items-center justify-center mr-4"
              style={{backgroundColor: C.blush}}>
              <Gift color={C.ink} size={22} />
            </View>
            <View className="flex-1">
              <Text
                className="text-[10px] font-bold tracking-widest mb-1"
                style={{color: C.goldDeep, letterSpacing: 2}}>
                GIFT CARDS
              </Text>
              <Text
                className="font-bold text-base"
                style={{color: C.ink}}>
                Give the right gear
              </Text>
              <Text
                className="text-xs mt-0.5"
                style={{color: C.inkSoft}}>
                From ₹500 · Delivered instantly
              </Text>
            </View>
            <ChevronRight color={C.ink} size={20} />
          </TouchableOpacity>
        </View>

        {/* ── 23. EVENTS NEAR YOU — hides when calendar is empty ──── */}
        {events.length > 0 ? (
          <View className="px-5 pt-7">
            <SectionHeader
              title="Events near you"
              subtitle="Marathons, tournaments, meetups"
            />
            {events.slice(0, 3).map((ev, idx) => {
              // Uniform red tile treatment (matches the other Home rails).
              const tint = {bg: C.surfaceCoral, fg: C.sageDeep};
              const date = new Date(ev.startsAt);
              const day = isNaN(date.getTime())
                ? '—'
                : date.getDate().toString().padStart(2, '0');
              const month = isNaN(date.getTime())
                ? ''
                : date
                    .toLocaleString('en-IN', {month: 'short'})
                    .toUpperCase();
              const meta = [
                ev.city,
                ev.description,
                ev.isMemberFree ? 'Free entry for members' : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <View
                  key={ev.id}
                  className="rounded-2xl p-4 mb-2 flex-row items-center"
                  style={{backgroundColor: C.surface}}>
                  <View
                    className="w-14 h-14 rounded-xl items-center justify-center mr-4"
                    style={{backgroundColor: tint.bg}}>
                    <Text
                      className="text-[10px] font-bold"
                      style={{color: tint.fg}}>
                      {day}
                    </Text>
                    <Text
                      className="text-[9px] font-bold"
                      style={{color: tint.fg}}>
                      {month}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-[9px] font-bold tracking-widest mb-0.5"
                      style={{color: C.textMuted, letterSpacing: 1.5}}>
                      {ev.category.toUpperCase()}
                    </Text>
                    <Text
                      className="font-bold text-sm"
                      style={{color: C.ink, letterSpacing: -0.2}}
                      numberOfLines={1}>
                      {ev.title}
                    </Text>
                    {meta ? (
                      <Text
                        className="text-[11px] mt-0.5"
                        style={{color: C.textTertiary}}
                        numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* ── 24. STORE LOCATOR ─────────────────────────────────── */}
        <View className="px-5 pt-2">
          <TouchableOpacity
            className="rounded-2xl p-4 flex-row items-center"
            style={{backgroundColor: C.surface}}
            activeOpacity={0.85}>
            <View
              className="w-11 h-11 rounded-xl items-center justify-center mr-4"
              style={{backgroundColor: C.surfaceSage}}>
              <Store color={C.sageDeep} size={20} />
            </View>
            <View className="flex-1">
              <Text
                className="font-bold text-sm"
                style={{color: C.ink, letterSpacing: -0.2}}>
                Find a store
              </Text>
              <Text
                className="text-xs mt-0.5"
                style={{color: C.textTertiary}}>
                {storeSubtitle}
              </Text>
            </View>
            <ChevronRight color={C.textMuted} size={20} />
          </TouchableOpacity>
        </View>

        {/* ── 25. REVIEWS — hides when no testimonials returned ──── */}
        {testimonials.length > 0 ? (
          <View className="pt-7">
            <View className="px-5">
              <SectionHeader
                title="Loved by athletes"
                subtitle={`${formatBigCount(testimonialsTotal)} verified customer reviews`}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{paddingHorizontal: 20, gap: 12}}>
              {testimonials.map(r => (
                <View
                  key={r.id}
                  className="rounded-2xl p-5"
                  style={{
                    width: 270,
                    backgroundColor: C.surface,
                  }}>
                  <View className="flex-row mb-3">
                    {Array.from({length: Math.max(1, Math.min(5, Math.round(r.rating)))}).map(
                      (_, i) => (
                        <Star
                          key={i}
                          color={C.gold}
                          size={13}
                          fill={C.gold}
                        />
                      ),
                    )}
                  </View>
                  <Text
                    className="text-sm mb-4 leading-5"
                    style={{color: C.ink}}
                    numberOfLines={4}>
                    "{r.text}"
                  </Text>
                  <View className="flex-row items-center">
                    <View
                      className="w-9 h-9 rounded-full items-center justify-center mr-2.5 overflow-hidden"
                      style={{backgroundColor: C.surfaceSage}}>
                      {r.avatarUrl ? (
                        <CachedImage
                          source={{uri: r.avatarUrl}}
                          className="w-full h-full"
                          resizeMode="cover"
                        />
                      ) : (
                        <Text
                          className="font-bold text-xs"
                          style={{color: C.sageDeep}}>
                          {r.name.charAt(0).toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View>
                      <Text
                        className="text-xs font-semibold"
                        style={{color: C.ink}}>
                        {r.name}
                      </Text>
                      <Text
                        className="text-[10px]"
                        style={{color: C.textTertiary}}>
                        {[r.location, r.verified ? 'Verified' : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* ── 26. PRESS / "AS SEEN IN" — hides when none returned ── */}
        {pressLogos.length > 0 ? (
          <View className="px-5 pt-7">
            <View className="flex-row items-center mb-3">
              <Newspaper color={C.textTertiary} size={13} />
              <Text
                className="text-[10px] font-bold tracking-widest ml-2"
                style={{color: C.textTertiary, letterSpacing: 2}}>
                AS FEATURED IN
              </Text>
            </View>
            <View
              className="rounded-2xl px-3 py-5"
              style={{backgroundColor: C.surface}}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 8,
                  gap: 28,
                  alignItems: 'center',
                }}>
                {pressLogos.map(p =>
                  p.logoUrl ? (
                    <CachedImage
                      key={p.id}
                      source={{uri: p.logoUrl}}
                      style={{width: 80, height: 20, opacity: 0.7}}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text
                      key={p.id}
                      className="font-black"
                      style={{
                        color: C.textMuted,
                        fontSize: 11,
                        letterSpacing: 1.5,
                      }}>
                      {p.name.toUpperCase()}
                    </Text>
                  ),
                )}
              </ScrollView>
            </View>
          </View>
        ) : null}

        {/* ── 27. NEWSLETTER — sage cream ───────────────────────── */}
        <View className="px-5 pt-7">
          <View
            className="rounded-2xl p-6 overflow-hidden relative"
            style={{backgroundColor: C.surfaceSage}}>
            <View
              className="absolute rounded-full"
              style={{
                width: 180,
                height: 180,
                right: -60,
                bottom: -70,
                backgroundColor: C.sage,
                opacity: 0.15,
              }}
            />
            <View
              className="w-12 h-12 rounded-full items-center justify-center mb-4"
              style={{backgroundColor: C.sage}}>
              <Zap color="white" size={20} />
            </View>
            <Text
              className="font-bold mb-1"
              style={{color: C.ink, fontSize: 18, letterSpacing: -0.3}}>
              First dibs on drops
            </Text>
            <Text
              className="text-xs mb-5"
              style={{color: C.textSecondary}}>
              Get early access to launches and exclusive member deals.
            </Text>
            <TouchableOpacity
              className="rounded-full px-5 py-3 self-start"
              style={{backgroundColor: C.ink}}
              onPress={goToBrowse}
              activeOpacity={0.85}>
              <Text className="text-xs font-bold text-white">
                Enable notifications
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 28. Trust badges ──────────────────────────────────── */}
        <View className="px-5 pt-4">
          <View
            className="rounded-2xl px-4 py-5 flex-row justify-between"
            style={{backgroundColor: C.surface}}>
            {[
              {Icon: Truck, label: 'Free shipping', sub: 'Over ₹999', bg: C.surfaceSage},
              {Icon: ShieldCheck, label: 'Secure pay', sub: 'Razorpay', bg: C.surfaceGold},
              {Icon: RotateCcw, label: 'Easy returns', sub: '7-day window', bg: C.surfaceCoral},
            ].map(badge => (
              <View key={badge.label} className="items-center flex-1">
                <View
                  className="w-10 h-10 rounded-full items-center justify-center mb-2"
                  style={{backgroundColor: badge.bg}}>
                  <badge.Icon color={C.ink} size={18} />
                </View>
                <Text
                  className="text-xs font-semibold"
                  style={{color: C.ink}}>
                  {badge.label}
                </Text>
                <Text
                  className="text-[10px] mt-0.5"
                  style={{color: C.textTertiary}}>
                  {badge.sub}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── 29. FOOTER — warm cream ────────────────────────────── */}
        <View className="px-5 pt-8 pb-8">
          <View
            className="rounded-2xl p-6"
            style={{backgroundColor: C.surfaceWarm}}>
            <Text
              className="font-black mb-1"
              style={{
                color: C.ink,
                fontSize: 24,
                letterSpacing: -0.8,
              }}>
              SPORTSMART
            </Text>
            <Text
              className="text-xs mb-5"
              style={{color: C.textSecondary}}>
              India's home for sports gear, since 2026.
            </Text>

            <View className="flex-row mb-5" style={{gap: 10}}>
              {[Instagram, Twitter, Facebook, Youtube].map((Icon, i) => (
                <TouchableOpacity
                  key={i}
                  className="w-10 h-10 rounded-full items-center justify-center"
                  style={{backgroundColor: C.surface}}
                  activeOpacity={0.7}>
                  <Icon color={C.ink} size={15} />
                </TouchableOpacity>
              ))}
            </View>

            <View
              className="flex-row pt-5 border-t"
              style={{borderColor: 'rgba(0,0,0,0.08)', gap: 24}}>
              <View className="flex-1">
                <Text
                  className="text-[10px] font-bold tracking-widest mb-3"
                  style={{color: C.goldDeep, letterSpacing: 1.5}}>
                  COMPANY
                </Text>
                <Text className="text-xs mb-2" style={{color: C.inkSoft}}>About</Text>
                <Text className="text-xs mb-2" style={{color: C.inkSoft}}>Press</Text>
                <Text className="text-xs" style={{color: C.inkSoft}}>Careers</Text>
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] font-bold tracking-widest mb-3"
                  style={{color: C.goldDeep, letterSpacing: 1.5}}>
                  HELP
                </Text>
                <Text className="text-xs mb-2" style={{color: C.inkSoft}}>FAQs</Text>
                <Text className="text-xs mb-2" style={{color: C.inkSoft}}>Shipping</Text>
                <Text className="text-xs" style={{color: C.inkSoft}}>Returns</Text>
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] font-bold tracking-widest mb-3"
                  style={{color: C.goldDeep, letterSpacing: 1.5}}>
                  LEGAL
                </Text>
                <Text className="text-xs mb-2" style={{color: C.inkSoft}}>Privacy</Text>
                <Text className="text-xs mb-2" style={{color: C.inkSoft}}>Terms</Text>
                <Text className="text-xs" style={{color: C.inkSoft}}>DPDP</Text>
              </View>
            </View>

            <Text
              className="text-[10px] mt-6 text-center"
              style={{color: C.textTertiary}}>
              Made in India · © {new Date().getFullYear()} Sportsmart
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
