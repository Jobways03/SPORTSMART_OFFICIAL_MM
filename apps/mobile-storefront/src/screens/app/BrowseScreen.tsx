import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowUpDown,
  Grid3x3,
  LayoutList,
  Menu as MenuIcon,
  Search as SearchIcon,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react-native';
import {useInfiniteProducts} from '../../queries/useProducts';
import {useCategories} from '../../queries/useCatalogRefs';
import {Spinner} from '../../components/Spinner';
import {SkeletonProductGrid} from '../../components/Skeleton';
import {ErrorState} from '../../components/ErrorState';
import {EmptyState} from '../../components/EmptyState';
import {ProductCard} from '../../components/ProductCard';
import {SearchInput} from '../../components/SearchInput';
import {FilterSheet, FilterDraft} from '../../components/FilterSheet';
import {MenuSheet} from '../../components/MenuSheet';
import {Gradient} from '../../components/Gradient';
import {SORT_OPTIONS} from '../../services/filters.service';
import {useDebouncedValue} from '../../lib/useDebouncedValue';
import {emojiFor} from '../../lib/category-emoji';
import {Events, track} from '../../lib/analytics';
import type {BrowseStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<BrowseStackParamList, 'Browse'>;

// ── Warm light premium palette (mirrors HomeScreen) ────────────────
const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceSage: '#f5f5f5',
  surfaceCoral: '#fee2e2',
  surfaceGold: '#fecaca',
  surfaceMauve: '#e4e4e7',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  inkSoft: '#1a1a1a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',
  sage: '#ef4444',
  sageDeep: '#dc2626',
  coral: '#fb923c',
  coralDeep: '#ea580c',
  gold: '#b91c1c',
  goldDeep: '#991b1b',
};

// The "All" pill is synthetic — it clears the category filter. We
// prepend it to whatever the backend returns so users always have a
// way to escape a category selection.
const ALL_PILL = {label: 'All', icon: '✨'};

const EMPTY_FILTERS: FilterDraft = {
  sort: '',
  minPrice: '',
  maxPrice: '',
  filters: {},
};

export function BrowseScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<BrowseStackParamList, 'Browse'>>();
  const [searchInput, setSearchInput] = useState('');
  const debouncedQ = useDebouncedValue(searchInput.trim(), 350);
  // Ref to the search field so the Home search bar can focus it on arrival.
  const searchRef = useRef<TextInput>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Categories drawer — opened from the Header menu button. Reuses
  // the storefront menu tree (the same one HomeScreen warms on app
  // start) so the data is usually already cached when this opens.
  const [menuOpen, setMenuOpen] = useState(false);
  const [applied, setApplied] = useState<FilterDraft>(() => ({
    ...EMPTY_FILTERS,
    sort: (route.params?.sort ?? '') as FilterDraft['sort'],
    minPrice: route.params?.minPrice != null ? String(route.params.minPrice) : '',
    maxPrice: route.params?.maxPrice != null ? String(route.params.maxPrice) : '',
  }));
  // Re-apply price bounds when arriving from a HomeScreen price tile (or
  // tapping a different tile while Browse is already mounted).
  const paramSort = route.params?.sort;
  const paramMinPrice = route.params?.minPrice;
  const paramMaxPrice = route.params?.maxPrice;
  useEffect(() => {
    if (paramSort != null) {
      // Curated entry (e.g. Home "Top 100" best sellers): apply the sort
      // and clear any leftover price filter so we never land on a stale
      // filtered view.
      setApplied(prev => ({
        ...prev,
        sort: paramSort as FilterDraft['sort'],
        minPrice: '',
        maxPrice: '',
      }));
      return;
    }
    if (paramMinPrice == null && paramMaxPrice == null) return;
    setApplied(prev => ({
      ...prev,
      minPrice: paramMinPrice != null ? String(paramMinPrice) : '',
      maxPrice: paramMaxPrice != null ? String(paramMaxPrice) : '',
    }));
  }, [paramSort, paramMinPrice, paramMaxPrice]);
  // Arriving from the Home search bar (focusSearch param). autoFocus on
  // the SearchInput covers the fresh-mount and loading→loaded-remount
  // cases; this ref.focus() covers re-navigating here while Browse is
  // already mounted (autoFocus won't re-fire on an existing input).
  const focusSearch = route.params?.focusSearch;
  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);
  // Clear the flag when leaving Browse so returning via the tab bar
  // doesn't force the keyboard open again.
  useEffect(
    () => nav.addListener('blur', () => nav.setParams({focusSearch: undefined})),
    [nav],
  );
  // Opening Browse from the Home filter button (openFilters param): pop
  // the filter sheet straight away. sheetOpen is component state, so it
  // survives the loading→loaded re-render; clear the param so a repeat
  // tap re-triggers it.
  const openFilters = route.params?.openFilters;
  useEffect(() => {
    if (openFilters) {
      setSheetOpen(true);
      nav.setParams({openFilters: undefined});
    }
  }, [openFilters, nav]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  // Grid vs list layout — purely visual, doesn't change the query.
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');

  const minPrice = applied.minPrice ? Number(applied.minPrice) : undefined;
  const maxPrice = applied.maxPrice ? Number(applied.maxPrice) : undefined;

  // Combine pill selection + search input. Pill sets a base; user
  // text appends on top so "Cricket" + "bat" searches for "cricket bat".
  const effectiveQuery = useMemo(() => {
    const cat = activeCategory !== 'All' ? activeCategory : '';
    const txt = debouncedQ;
    return [cat, txt].filter(Boolean).join(' ');
  }, [activeCategory, debouncedQ]);

  const query = useInfiniteProducts({
    ...(effectiveQuery ? {q: effectiveQuery} : {}),
    ...(applied.sort ? {sortBy: applied.sort} : {}),
    ...(minPrice != null ? {minPrice} : {}),
    ...(maxPrice != null ? {maxPrice} : {}),
    ...(Object.keys(applied.filters).length > 0
      ? {filters: applied.filters}
      : {}),
  });

  useEffect(() => {
    if (debouncedQ) track(Events.ProductSearched, {query: debouncedQ});
  }, [debouncedQ]);

  const activeChips = useMemo(() => {
    const chips: Array<{id: string; label: string; onRemove: () => void}> = [];
    if (applied.sort) {
      const sortLabel =
        SORT_OPTIONS.find(o => o.value === applied.sort)?.label ?? applied.sort;
      chips.push({
        id: 'sort',
        label: sortLabel,
        onRemove: () => setApplied(p => ({...p, sort: ''})),
      });
    }
    if (applied.minPrice || applied.maxPrice) {
      const lo = applied.minPrice ? `₹${applied.minPrice}` : '₹0';
      const hi = applied.maxPrice ? `₹${applied.maxPrice}` : '∞';
      chips.push({
        id: 'price',
        label: `${lo}–${hi}`,
        onRemove: () =>
          setApplied(p => ({...p, minPrice: '', maxPrice: ''})),
      });
    }
    for (const [key, vs] of Object.entries(applied.filters)) {
      for (const v of vs) {
        chips.push({
          id: `${key}:${v}`,
          label: v,
          onRemove: () =>
            setApplied(p => {
              const cur = p.filters[key] ?? [];
              const next = cur.filter(x => x !== v);
              const filters = {...p.filters};
              if (next.length === 0) delete filters[key];
              else filters[key] = next;
              return {...p, filters};
            }),
        });
      }
    }
    return chips;
  }, [applied]);

  const filterBadge = activeChips.length;
  const sortLabel = applied.sort
    ? SORT_OPTIONS.find(o => o.value === applied.sort)?.label ?? 'Custom'
    : 'Best match';

  if (query.isLoading) {
    return (
      <SafeAreaView
        className="flex-1"
        style={{backgroundColor: C.bg}}
        edges={['top']}>
        <Header
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          searchRef={searchRef}
          autoFocusSearch={!!focusSearch}
          filterBadge={filterBadge}
          onOpenSheet={() => setSheetOpen(true)}
          onOpenMenu={() => setMenuOpen(true)}
        />
        <CategoryPillRow
          active={activeCategory}
          onSelect={setActiveCategory}
        />
        <SkeletonProductGrid />
        <FilterSheet
          visible={sheetOpen}
          initial={applied}
          search={effectiveQuery || undefined}
          onApply={next => {
            setApplied(next);
            setSheetOpen(false);
          }}
          onClose={() => setSheetOpen(false)}
        />
      </SafeAreaView>
    );
  }

  // Keep header + category rail rendered on error so the user can
  // navigate away or change filters instead of being dumped on a
  // blank "Something went wrong" page. Transient API blips (e.g. a
  // dev-server restart) shouldn't trap the user in this screen.

  const products = (query.data?.pages ?? []).flatMap(p => p.products);
  const total = query.data?.pages[0]?.pagination.total ?? 0;
  const hasAnyFilter = filterBadge > 0 || activeCategory !== 'All' || !!debouncedQ;

  return (
    <SafeAreaView
      className="flex-1"
      style={{backgroundColor: C.bg}}
      edges={['top']}>
      <Header
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        searchRef={searchRef}
        autoFocusSearch={!!focusSearch}
        filterBadge={filterBadge}
        onOpenSheet={() => setSheetOpen(true)}
        onOpenMenu={() => setMenuOpen(true)}
      />

      {/* Category pills */}
      <CategoryPillRow
        active={activeCategory}
        onSelect={setActiveCategory}
      />

      {/* Stats / sort / layout toggle bar */}
      <View
        className="px-5 pt-3 pb-2 flex-row items-center justify-between"
        style={{backgroundColor: C.bg}}>
        <Text className="text-xs" style={{color: C.textSecondary}}>
          <Text style={{color: C.ink, fontWeight: '700'}}>{total}</Text>{' '}
          {total === 1 ? 'product' : 'products'}
          {debouncedQ ? (
            <Text>
              {' for '}
              <Text style={{color: C.ink, fontWeight: '600'}}>
                "{debouncedQ}"
              </Text>
            </Text>
          ) : null}
        </Text>
        <View className="flex-row items-center" style={{gap: 8}}>
          <TouchableOpacity
            className="flex-row items-center rounded-full px-3 py-1.5"
            style={{backgroundColor: C.surface}}
            onPress={() => setSheetOpen(true)}
            activeOpacity={0.7}>
            <ArrowUpDown color={C.ink} size={12} />
            <Text
              className="text-[11px] font-semibold ml-1.5"
              style={{color: C.ink}}>
              {sortLabel}
            </Text>
          </TouchableOpacity>
          <View
            className="flex-row rounded-full p-0.5"
            style={{backgroundColor: C.surface}}>
            <TouchableOpacity
              className="w-7 h-7 rounded-full items-center justify-center"
              style={{
                backgroundColor: layout === 'grid' ? C.ink : 'transparent',
              }}
              onPress={() => setLayout('grid')}
              activeOpacity={0.7}>
              <Grid3x3
                color={layout === 'grid' ? 'white' : C.textTertiary}
                size={13}
              />
            </TouchableOpacity>
            <TouchableOpacity
              className="w-7 h-7 rounded-full items-center justify-center"
              style={{
                backgroundColor: layout === 'list' ? C.ink : 'transparent',
              }}
              onPress={() => setLayout('list')}
              activeOpacity={0.7}>
              <LayoutList
                color={layout === 'list' ? 'white' : C.textTertiary}
                size={13}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Active filter chips — wrapping row. (A horizontal ScrollView
          collapses its height on react-native-web and clips the chips,
          so they were only half-visible.) */}
      {activeChips.length > 0 ? (
        <View
          className="flex-row flex-wrap"
          style={{
            paddingHorizontal: 20,
            paddingVertical: 8,
            gap: 8,
          }}>
          {activeChips.map(c => (
            <TouchableOpacity
              key={c.id}
              className="flex-row items-center rounded-full px-3 py-1.5"
              style={{backgroundColor: C.surfaceSage}}
              onPress={c.onRemove}
              activeOpacity={0.7}>
              <Text
                className="text-[11px] font-semibold mr-1"
                style={{color: C.sageDeep}}>
                {c.label}
              </Text>
              <X color={C.sageDeep} size={11} />
            </TouchableOpacity>
          ))}
          {hasAnyFilter ? (
            <TouchableOpacity
              className="flex-row items-center rounded-full px-3 py-1.5"
              style={{backgroundColor: C.surfaceCoral}}
              onPress={() => {
                setApplied(EMPTY_FILTERS);
                setActiveCategory('All');
                setSearchInput('');
              }}
              activeOpacity={0.7}>
              <Text
                className="text-[11px] font-semibold"
                style={{color: C.sageDeep}}>
                Clear all
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <FlatList
        key={layout}
        data={products}
        keyExtractor={item => item.id}
        numColumns={layout === 'grid' ? 2 : 1}
        columnWrapperStyle={
          layout === 'grid'
            ? {justifyContent: 'space-between', alignItems: 'flex-start'}
            : undefined
        }
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 24,
        }}
        ListHeaderComponent={
          products.length > 0 ? (
            <View className="mb-4">
              {/* Editorial banner — full-width hero above the grid. */}
              <TouchableOpacity
                activeOpacity={0.9}
                style={{marginBottom: 16}}
                onPress={() => setActiveCategory('Running')}>
                <View
                  className="rounded-2xl overflow-hidden p-5 relative"
                  style={{backgroundColor: C.ink, minHeight: 140}}>
                  <View
                    className="absolute rounded-full"
                    style={{
                      width: 200,
                      height: 200,
                      right: -60,
                      top: -60,
                      backgroundColor: 'rgba(200, 168, 120, 0.18)',
                    }}
                  />
                  <Text
                    className="text-[10px] font-bold tracking-widest mb-2"
                    style={{color: C.gold, letterSpacing: 2}}>
                    COLLECTION OF THE WEEK
                  </Text>
                  <Text
                    className="text-white font-black mb-2"
                    style={{
                      fontSize: 22,
                      letterSpacing: -0.5,
                      lineHeight: 26,
                    }}>
                    Marathon-ready{'\n'}essentials.
                  </Text>
                  <Text
                    className="text-xs mb-3"
                    style={{color: '#a3a3a3', maxWidth: '80%'}}>
                    Carbon-plated racers, recovery sliders, and the
                    apparel our athletes train in.
                  </Text>
                  <View
                    className="rounded-full px-4 py-2 self-start"
                    style={{backgroundColor: 'white'}}>
                    <Text
                      className="text-[11px] font-bold"
                      style={{color: C.ink}}>
                      Shop collection →
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              {/* Trending now — popular-search chips */}
              <View className="flex-row items-center mb-2">
                <View
                  className="w-1 h-3 rounded-full mr-2"
                  style={{backgroundColor: C.coralDeep}}
                />
                <Text
                  className="text-[10px] font-bold tracking-widest"
                  style={{color: C.coralDeep, letterSpacing: 1.8}}>
                  TRENDING NOW
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{gap: 6}}
                style={{marginHorizontal: -20, paddingHorizontal: 20}}>
                {[
                  'Cricket bats',
                  'Running shoes',
                  'Yoga mats',
                  'Football boots',
                  'Yonex rackets',
                  'Dumbbells',
                ].map(term => (
                  <TouchableOpacity
                    key={term}
                    className="rounded-full px-3 py-1.5"
                    style={{
                      backgroundColor: C.surface,
                      borderWidth: 1,
                      borderColor: C.border,
                    }}
                    onPress={() => setSearchInput(term)}
                    activeOpacity={0.7}>
                    <Text
                      className="text-[11px] font-medium"
                      style={{color: C.ink}}>
                      {term}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            onRefresh={query.refetch}
            tintColor={C.sageDeep}
          />
        }
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) {
            query.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <Spinner />
          ) : query.hasNextPage ? null : products.length > 0 ? (
            <View className="py-6 items-center">
              <View
                className="w-10 h-px mb-3"
                style={{backgroundColor: C.border}}
              />
              <Text
                className="text-[10px] tracking-widest"
                style={{color: C.textMuted, letterSpacing: 2}}>
                YOU'VE REACHED THE END
              </Text>
            </View>
          ) : (
            <View className="h-4" />
          )
        }
        renderItem={({item}) => (
          // Wrapper sets an explicit width so two cards in a row are
          // guaranteed equal width. Without this the inner card's
          // `width: 48%` resolves against an auto-sized parent and the
          // columns end up at different widths — which made the
          // aspect-square images different heights and broke alignment.
          <View
            style={
              layout === 'list'
                ? {marginBottom: 12, width: '100%'}
                : {width: '48%'}
            }>
            <ProductCard
              product={item}
              widthPercent={100}
              onPress={slug => nav.navigate('ProductDetail', {productSlug: slug})}
            />
          </View>
        )}
        ListEmptyComponent={
          query.isError ? (
            <View style={{marginTop: 12}}>
              <ErrorState
                onRetry={query.refetch}
                message={
                  (query.error as Error | undefined)?.message ||
                  'Pull down to try again, or come back in a moment.'
                }
              />
            </View>
          ) : (
          <View
            className="rounded-2xl p-6 items-center"
            style={{backgroundColor: C.surface, marginTop: 12}}>
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-4"
              style={{backgroundColor: C.surfaceSage}}>
              <SearchIcon color={C.sageDeep} size={28} />
            </View>
            <Text
              className="text-base font-bold mb-1"
              style={{color: C.ink, letterSpacing: -0.3}}>
              {hasAnyFilter ? 'No matches' : 'Catalog coming soon'}
            </Text>
            <Text
              className="text-xs text-center mb-5"
              style={{color: C.textTertiary, maxWidth: 260}}>
              {hasAnyFilter
                ? 'Try a different search, switch category, or clear some filters.'
                : 'Seed the catalog from the API and pull to refresh.'}
            </Text>
            {hasAnyFilter ? (
              <TouchableOpacity
                className="rounded-full px-5 py-2.5"
                style={{backgroundColor: C.ink}}
                onPress={() => {
                  setApplied(EMPTY_FILTERS);
                  setActiveCategory('All');
                  setSearchInput('');
                }}
                activeOpacity={0.85}>
                <Text className="text-xs font-bold text-white">
                  Reset everything
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
          )
        }
      />

      <FilterSheet
        visible={sheetOpen}
        initial={applied}
        search={effectiveQuery || undefined}
        onApply={next => {
          setApplied(next);
          setSheetOpen(false);
          track(Events.ProductFiltersApplied, {
            sort: next.sort || null,
            hasPriceRange: !!(next.minPrice || next.maxPrice),
            filterGroupCount: Object.keys(next.filters).length,
          });
        }}
        onClose={() => setSheetOpen(false)}
      />

      <MenuSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSelectLeaf={label => {
          // Tapping a leaf piggybacks on the existing search query
          // path: write the label into searchInput and close. The
          // debounced useInfiniteProducts call picks it up on the
          // next tick. Reset the category pill so the user sees the
          // raw menu-driven query result without an "and" filter.
          setActiveCategory('All');
          setSearchInput(label);
          setMenuOpen(false);
          track(Events.ProductSearched, {query: label, source: 'menu'});
        }}
      />
    </SafeAreaView>
  );
}

// ── Header ────────────────────────────────────────────────────────────

interface HeaderProps {
  searchInput: string;
  setSearchInput: (v: string) => void;
  searchRef?: React.Ref<TextInput>;
  autoFocusSearch?: boolean;
  filterBadge: number;
  onOpenSheet: () => void;
  onOpenMenu: () => void;
}

function Header({
  searchInput,
  setSearchInput,
  searchRef,
  autoFocusSearch,
  filterBadge,
  onOpenSheet,
  onOpenMenu,
}: HeaderProps) {
  return (
    <View
      className="px-5 pt-3 pb-4"
      style={{backgroundColor: C.surface}}>
      <View className="flex-row items-end justify-between mb-3">
        <View className="flex-1 flex-row items-start">
          {/* Accent bar — recurring rhythm matching Home / Cart / PDP titles. */}
          <View
            className="rounded-full mr-3 mt-1.5"
            style={{
              width: 3,
              height: 30,
              backgroundColor: C.sageDeep,
            }}
          />
          <View className="flex-1">
            <Text
              className="text-[10px] font-bold tracking-widest"
              style={{color: C.sageDeep, letterSpacing: 2}}>
              DISCOVER
            </Text>
            <Text
              className="font-black mt-0.5"
              style={{
                color: C.ink,
                fontSize: 26,
                letterSpacing: -0.8,
                lineHeight: 30,
              }}>
              Find your gear
            </Text>
          </View>
        </View>
        {/* "NEW DROPS" pill — gradient navy→blue so it reads as a
            premium chip, not a generic tag. */}
        <View
          style={{
            borderRadius: 999,
            overflow: 'hidden',
            shadowColor: C.sageDeep,
            shadowOpacity: 0.2,
            shadowOffset: {width: 0, height: 2},
            shadowRadius: 4,
            elevation: 2,
          }}>
          <Gradient
            colors={[C.sageDeep, C.goldDeep]}
            angle={120}
            borderRadius={999}>
            <View
              className="flex-row items-center px-2.5 py-1.5"
              pointerEvents="none">
              <Sparkles color="white" size={12} strokeWidth={2.4} fill="white" />
              <Text
                className="text-[10px] font-bold ml-1"
                style={{color: 'white', letterSpacing: 0.4}}>
                NEW DROPS
              </Text>
            </View>
          </Gradient>
        </View>
      </View>

      <View className="flex-row items-center" style={{gap: 8}}>
        <View className="flex-1">
          <SearchInput
            ref={searchRef}
            autoFocus={autoFocusSearch}
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search shoes, gear, brands…"
          />
        </View>
        {/* Categories drawer — opens the full menu tree from the
            seeded "main-menu". Cream-tinted to read as a secondary
            action vs. the primary (ink) filter button beside it. */}
        <TouchableOpacity
          className="w-11 h-11 rounded-xl items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          onPress={onOpenMenu}
          activeOpacity={0.7}
          accessibilityLabel="Browse all categories">
          <MenuIcon color={C.ink} size={18} />
        </TouchableOpacity>
        {/* Primary filter action — gradient so it pops against the
            cream-tinted menu button beside it and reads as the
            "money" action of the header. */}
        <View
          className="relative"
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            shadowColor: C.sageDeep,
            shadowOpacity: 0.3,
            shadowOffset: {width: 0, height: 3},
            shadowRadius: 6,
            elevation: 4,
          }}>
          {/* Inner layer clips the gradient to the rounded corners. The
              count badge lives on the OUTER wrapper (no overflow clip) so
              it's never cut off — previously overflow:hidden here ate it.
              Layout props go on the Gradient itself so the icon centres in
              the full 44×44 instead of collapsing to the top. */}
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              overflow: 'hidden',
            }}>
            <Gradient
              colors={[C.sageDeep, C.ink]}
              angle={135}
              borderRadius={12}
              style={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <TouchableOpacity
                style={{
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onPress={onOpenSheet}
                activeOpacity={0.85}
                accessibilityLabel="Sort and filter">
                <SlidersHorizontal
                  color="white"
                  size={20}
                  strokeWidth={2.4}
                />
              </TouchableOpacity>
            </Gradient>
          </View>
          {filterBadge > 0 ? (
            <View
              className="absolute -top-1.5 -right-1.5 rounded-full min-w-[18px] h-[18px] px-1 items-center justify-center"
              style={{
                backgroundColor: '#ffffff',
                borderWidth: 1,
                borderColor: C.border,
                shadowColor: '#000',
                shadowOpacity: 0.18,
                shadowOffset: {width: 0, height: 1},
                shadowRadius: 2,
                elevation: 3,
              }}>
              <Text
                className="text-[10px] font-bold"
                style={{color: C.sageDeep}}>
                {filterBadge}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ── Category pill row ─────────────────────────────────────────────────

interface CategoryPillRowProps {
  active: string;
  onSelect: (label: string) => void;
}

function CategoryPillRow({active, onSelect}: CategoryPillRowProps) {
  const categoriesQuery = useCategories();
  // Build the pill list from the API. "All" is always first, then
  // every category the backend returns (deduped by name for safety
  // in case the API hands us a slug-name mismatch). If the API is
  // down or returns nothing, only "All" shows — the section stays
  // functional rather than disappearing.
  const pills = [
    ALL_PILL,
    ...(categoriesQuery.data ?? []).map(c => ({
      label: c.name,
      icon: emojiFor(c.slug, c.name),
    })),
  ];
  return (
    <View style={{backgroundColor: C.surface}}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingVertical: 12,
          gap: 8,
        }}>
        {pills.map(pill => {
          const isActive = active === pill.label;
          // Active pill — gradient + tinted shadow, matches the
          // OrdersScreen filter pill grammar. Inactive pills stay
          // flat-cream so the active selection visually leads.
          if (isActive) {
            return (
              <View
                key={pill.label}
                style={{
                  borderRadius: 999,
                  overflow: 'hidden',
                  shadowColor: C.sageDeep,
                  shadowOpacity: 0.28,
                  shadowOffset: {width: 0, height: 3},
                  shadowRadius: 6,
                  elevation: 3,
                }}>
                <Gradient
                  colors={[C.sageDeep, C.ink]}
                  angle={135}
                  borderRadius={999}>
                  <TouchableOpacity
                    className="flex-row items-center px-4 py-2"
                    onPress={() => onSelect(pill.label)}
                    activeOpacity={0.85}>
                    <Text style={{fontSize: 14, marginRight: 6}}>
                      {pill.icon}
                    </Text>
                    <Text
                      className="text-xs font-semibold"
                      style={{color: 'white', letterSpacing: 0.2}}>
                      {pill.label}
                    </Text>
                  </TouchableOpacity>
                </Gradient>
              </View>
            );
          }
          return (
            <TouchableOpacity
              key={pill.label}
              className="flex-row items-center rounded-full px-4 py-2"
              style={{backgroundColor: C.surfaceWarm}}
              onPress={() => onSelect(pill.label)}
              activeOpacity={0.7}>
              <Text style={{fontSize: 14, marginRight: 6}}>{pill.icon}</Text>
              <Text
                className="text-xs font-semibold"
                style={{color: C.ink, letterSpacing: 0.2}}>
                {pill.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
