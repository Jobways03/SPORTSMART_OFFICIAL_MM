import React, {useMemo, useState} from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gradient} from '../../components/Gradient';
import {useNavigation, CommonActions} from '@react-navigation/native';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {
  ArrowRight,
  ChevronLeft,
  Heart,
  Share2,
  ShoppingBag,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react-native';
import {useWishlist, useRemoveFromWishlist} from '../../queries/useWishlist';
import {showAlert} from '../../lib/dialog';
import {useAddToCart} from '../../queries/useCart';
import {SkeletonRowList} from '../../components/Skeleton';
import {ErrorState} from '../../components/ErrorState';
import {formatINR} from '../../lib/format';
import type {AppTabParamList} from '../../navigation/types';

type Nav = BottomTabNavigationProp<AppTabParamList, 'AccountTab'>;

// Warm premium palette mirrors the rest of the app.
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

// Decorative tints cycled per item — wishlist item DTO has no image
// URL so we colour the thumbnail tile to give the list visual rhythm.
const TILE_TINTS = [
  C.surfaceSage,
  C.surfaceCoral,
  C.surfaceGold,
  C.surfaceMauve,
  C.surfaceWarm,
];

// 9 sport emoji cycled to play the role of a product image until the
// wishlist API surfaces a real primaryImageUrl.
const TILE_EMOJI = ['🏏', '⚽', '🏃', '🏋️', '🏸', '🎾', '🏊', '🚴', '🎯'];

const FILTERS = [
  {label: 'All', match: () => true},
  {
    label: 'In stock',
    match: (item: any) =>
      item.product.status === 'ACTIVE' &&
      (item.variant?.status ?? 'ACTIVE') === 'ACTIVE',
  },
  {label: 'On sale', match: () => false}, // placeholder until compare-at lands on wishlist DTO
];

function timeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86_400_000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  } catch {
    return '';
  }
}

export function WishlistScreen() {
  const nav = useNavigation<Nav>();
  const query = useWishlist();
  const remove = useRemoveFromWishlist();
  const addToCart = useAddToCart();
  const [filter, setFilter] = useState('All');

  const onOpenProduct = (slug: string) => {
    nav.dispatch(
      CommonActions.navigate({
        name: 'BrowseTab',
        params: {screen: 'ProductDetail', params: {productSlug: slug}},
      }),
    );
  };

  // Derive data + useMemo BEFORE the conditional early returns so the
  // hook count stays stable across loading → success renders.
  const items = query.data?.items ?? [];

  const stats = useMemo(() => {
    const totalValue = items.reduce((sum, item) => {
      const price =
        item.variant?.price != null
          ? Number(item.variant.price)
          : item.product.basePrice != null
          ? Number(item.product.basePrice)
          : 0;
      return sum + price;
    }, 0);
    const inStock = items.filter(
      i =>
        i.product.status === 'ACTIVE' &&
        (i.variant?.status ?? 'ACTIVE') === 'ACTIVE',
    ).length;
    return {totalValue, inStock};
  }, [items]);

  const activeFilter = FILTERS.find(f => f.label === filter) ?? FILTERS[0];
  const filteredItems = items.filter(activeFilter.match);

  if (query.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
        <Header nav={nav} count={0} />
        <SkeletonRowList />
      </SafeAreaView>
    );
  }
  if (query.isError) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <ErrorState onRetry={query.refetch} />
      </SafeAreaView>
    );
  }

  if (items.length === 0) return <EmptyWishlist nav={nav} />;

  const onMoveToBag = (item: typeof items[number]) => {
    addToCart.mutate(
      {
        productId: item.productId,
        variantId: item.variantId ?? undefined,
        quantity: 1,
      },
      {
        onSuccess: () => {
          remove.mutate(item.id);
        },
        onError: err =>
          showAlert(
            "Couldn't move to bag",
            err instanceof Error ? err.message : 'Try again.',
          ),
      },
    );
  };

  const onRemove = (item: typeof items[number]) =>
    showAlert('Remove from wishlist?', item.product.title, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => remove.mutate(item.id),
      },
    ]);

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} count={items.length} />

      <FlatList
        data={filteredItems}
        keyExtractor={item => item.id}
        contentContainerStyle={{paddingBottom: 24}}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={C.sageDeep}
          />
        }
        ListHeaderComponent={
          <>
            {/* ── Stats hero — warm coral gradient (kept warm to
                preserve the emotional "favourites" feel against the
                rest of the cool-blue app). ────────────────────── */}
            <View className="px-5 pt-4">
              <View
                style={{
                  borderRadius: 20,
                  overflow: 'hidden',
                  shadowColor: C.coralDeep,
                  shadowOpacity: 0.26,
                  shadowOffset: {width: 0, height: 10},
                  shadowRadius: 18,
                  elevation: 8,
                }}>
                <Gradient
                  colors={[C.coralDeep, '#9a3412']}
                  angle={135}
                  borderRadius={20}
                  style={{minHeight: 130}}>
                  <View
                    className="absolute rounded-full"
                    style={{
                      width: 240,
                      height: 240,
                      right: -80,
                      top: -80,
                      backgroundColor: C.coral,
                      opacity: 0.28,
                    }}
                  />
                  <View
                    className="absolute rounded-full"
                    style={{
                      width: 160,
                      height: 160,
                      left: -50,
                      bottom: -60,
                      backgroundColor: 'white',
                      opacity: 0.08,
                    }}
                  />
                  <View className="p-5">
                    <View className="flex-row items-start">
                      <View
                        className="w-12 h-12 rounded-2xl items-center justify-center mr-3"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.16)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.28)',
                        }}>
                        <Heart color="white" size={22} fill="white" />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-[10px] font-bold tracking-widest"
                          style={{
                            color: 'rgba(255,255,255,0.78)',
                            letterSpacing: 2,
                          }}>
                          YOUR FAVOURITES
                        </Text>
                        <Text
                          className="font-black mt-0.5"
                          style={{
                            color: 'white',
                            fontSize: 24,
                            letterSpacing: -0.7,
                            lineHeight: 28,
                          }}>
                          {items.length}{' '}
                          {items.length === 1 ? 'item' : 'items'} saved
                        </Text>
                        <Text
                          className="text-xs mt-1"
                          style={{color: 'rgba(255,255,255,0.82)'}}>
                          Total value · {formatINR(stats.totalValue)}
                        </Text>
                      </View>
                    </View>

                    {/* Inline action chips — primary "Move all" gets
                        a white inverted pill (max contrast on coral),
                        Share uses frosted-glass border. */}
                    <View className="flex-row mt-4" style={{gap: 8}}>
                      <TouchableOpacity
                        className="flex-1 rounded-full py-2.5 flex-row items-center justify-center"
                        style={{backgroundColor: 'white'}}
                        activeOpacity={0.85}
                        onPress={() => {
                          const queue = items.filter(activeFilter.match);
                          queue.forEach(onMoveToBag);
                        }}>
                        <ShoppingBag color={C.coralDeep} size={12} />
                        <Text
                          className="text-[11px] font-bold ml-1.5"
                          style={{
                            color: C.coralDeep,
                            letterSpacing: 0.3,
                          }}>
                          Move all to bag
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="rounded-full px-4 flex-row items-center justify-center"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.14)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.32)',
                        }}
                        activeOpacity={0.85}>
                        <Share2 color="white" size={12} />
                        <Text
                          className="text-[11px] font-bold ml-1.5"
                          style={{color: 'white'}}>
                          Share
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Gradient>
              </View>
            </View>

            {/* ── Filter pills ─────────────────────────────────── */}
            <View className="pt-5 pb-1">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{paddingHorizontal: 20, gap: 8}}>
                {FILTERS.map(f => {
                  const count = items.filter(f.match).length;
                  const isActive = filter === f.label;
                  return (
                    <TouchableOpacity
                      key={f.label}
                      className="rounded-full px-4 py-2 flex-row items-center"
                      style={{
                        backgroundColor: isActive ? C.ink : C.surface,
                      }}
                      onPress={() => setFilter(f.label)}
                      activeOpacity={0.7}>
                      <Text
                        className="text-xs font-bold"
                        style={{
                          color: isActive ? 'white' : C.ink,
                          letterSpacing: 0.2,
                        }}>
                        {f.label}
                      </Text>
                      {count > 0 ? (
                        <View
                          className="ml-2 rounded-full px-1.5"
                          style={{
                            backgroundColor: isActive
                              ? 'rgba(255,255,255,0.2)'
                              : C.surfaceWarm,
                            minWidth: 18,
                            height: 16,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}>
                          <Text
                            className="text-[10px] font-bold"
                            style={{
                              color: isActive ? 'white' : C.textSecondary,
                            }}>
                            {count}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View className="px-5 pt-4 pb-2 flex-row items-center justify-between">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                {filter === 'All'
                  ? 'ALL FAVOURITES'
                  : `${filter.toUpperCase()} · ${filteredItems.length}`}
              </Text>
              <Text
                className="text-[11px] font-semibold"
                style={{color: C.textTertiary}}>
                {stats.inStock} in stock
              </Text>
            </View>
          </>
        }
        ItemSeparatorComponent={() => <View style={{height: 10}} />}
        renderItem={({item, index}) => {
          const tint = TILE_TINTS[index % TILE_TINTS.length];
          const emoji = TILE_EMOJI[index % TILE_EMOJI.length];
          const price =
            item.variant?.price != null
              ? Number(item.variant.price)
              : item.product.basePrice != null
              ? Number(item.product.basePrice)
              : null;
          const inStock =
            item.product.status === 'ACTIVE' &&
            (item.variant?.status ?? 'ACTIVE') === 'ACTIVE';

          // Deterministic rating per product id for visual flair.
          const seed = item.productId.charCodeAt(item.productId.length - 1);
          const rating = (4.2 + ((seed % 7) / 10)).toFixed(1);

          return (
            <View className="px-5">
              <View
                className="rounded-2xl p-3 flex-row"
                style={{backgroundColor: C.surface}}>
                {/* Image-tile placeholder (no image URL on the wishlist DTO) */}
                <TouchableOpacity
                  className="rounded-xl items-center justify-center mr-3"
                  style={{
                    width: 86,
                    height: 86,
                    backgroundColor: tint,
                  }}
                  onPress={() => onOpenProduct(item.product.slug)}
                  activeOpacity={0.85}>
                  <Text style={{fontSize: 36}}>{emoji}</Text>
                </TouchableOpacity>

                {/* Body */}
                <View className="flex-1">
                  <TouchableOpacity
                    onPress={() => onOpenProduct(item.product.slug)}
                    activeOpacity={0.7}>
                    {/* Title + remove on first row */}
                    <View className="flex-row items-start mb-1">
                      <Text
                        className="text-sm font-bold flex-1 mr-2"
                        style={{
                          color: C.ink,
                          letterSpacing: -0.2,
                          lineHeight: 18,
                        }}
                        numberOfLines={2}>
                        {item.product.title}
                      </Text>
                      <TouchableOpacity
                        className="w-7 h-7 rounded-full items-center justify-center"
                        style={{backgroundColor: C.surfaceWarm}}
                        onPress={() => onRemove(item)}
                        activeOpacity={0.7}
                        accessibilityLabel="Remove from wishlist">
                        <Trash2 color={C.sageDeep} size={13} />
                      </TouchableOpacity>
                    </View>

                    {/* Variant SKU chip */}
                    {item.variant?.sku ? (
                      <View
                        className="self-start rounded-full px-2 py-0.5 mb-1"
                        style={{backgroundColor: C.surfaceWarm}}>
                        <Text
                          className="text-[10px] font-semibold"
                          style={{color: C.textSecondary}}>
                          {item.variant.sku}
                        </Text>
                      </View>
                    ) : null}

                    {/* Rating + added-when meta */}
                    <View className="flex-row items-center mb-2">
                      <Star color={C.gold} fill={C.gold} size={10} />
                      <Text
                        className="text-[10px] font-semibold ml-1"
                        style={{color: C.ink}}>
                        {rating}
                      </Text>
                      <View
                        className="mx-1.5 w-0.5 h-0.5 rounded-full"
                        style={{backgroundColor: C.textMuted}}
                      />
                      <Text
                        className="text-[10px]"
                        style={{color: C.textTertiary}}>
                        Added {timeAgo(item.createdAt)}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* Bottom row: price + Move to bag */}
                  <View className="flex-row items-center">
                    <View className="flex-1">
                      <Text
                        className="text-base font-bold"
                        style={{color: C.ink, letterSpacing: -0.3}}>
                        {formatINR(price)}
                      </Text>
                      {!inStock ? (
                        <Text
                          className="text-[10px] font-bold mt-0.5"
                          style={{color: C.coralDeep}}>
                          Currently unavailable
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity
                      className="rounded-full px-4 py-2 flex-row items-center"
                      style={{
                        backgroundColor: inStock ? C.ink : C.surfaceWarm,
                      }}
                      disabled={!inStock || addToCart.isPending}
                      onPress={() => onMoveToBag(item)}
                      activeOpacity={0.85}>
                      <ShoppingBag
                        color={inStock ? 'white' : C.textMuted}
                        size={11}
                      />
                      <Text
                        className="text-[11px] font-bold ml-1.5"
                        style={{
                          color: inStock ? 'white' : C.textMuted,
                          letterSpacing: 0.3,
                        }}>
                        {addToCart.isPending ? 'Moving…' : 'MOVE TO BAG'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          );
        }}
        ListFooterComponent={
          <View className="px-5 pt-6">
            <View
              className="rounded-2xl overflow-hidden p-5 relative"
              style={{backgroundColor: C.surfaceSage}}>
              <View
                className="absolute rounded-full"
                style={{
                  width: 160,
                  height: 160,
                  right: -50,
                  bottom: -60,
                  backgroundColor: C.sage,
                  opacity: 0.18,
                }}
              />
              <View className="flex-row items-center mb-2">
                <Sparkles color={C.sageDeep} size={14} />
                <Text
                  className="text-[10px] font-bold tracking-widest ml-2"
                  style={{color: C.sageDeep, letterSpacing: 1.8}}>
                  STAY NOTIFIED
                </Text>
              </View>
              <Text
                className="font-black mb-1"
                style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
                We'll email when prices drop
              </Text>
              <Text
                className="text-xs mb-4"
                style={{color: C.inkSoft, maxWidth: '85%'}}>
                Get price-drop alerts and stock-back-in notifications for
                everything in your wishlist.
              </Text>
              <TouchableOpacity
                className="rounded-full px-5 py-2.5 self-start"
                style={{backgroundColor: C.ink}}
                activeOpacity={0.85}>
                <Text className="text-[11px] font-bold text-white">
                  Enable alerts
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center py-16 px-6">
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-3"
              style={{backgroundColor: C.surfaceWarm}}>
              <Heart color={C.textMuted} size={26} />
            </View>
            <Text
              className="text-sm font-bold"
              style={{color: C.ink, letterSpacing: -0.2}}>
              No {filter.toLowerCase()} matches
            </Text>
            <Text
              className="text-xs text-center mt-1"
              style={{color: C.textTertiary}}>
              Switch the filter above to see other items.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function Header({nav, count}: {nav: Nav; count: number}) {
  return (
    <View
      className="flex-row items-center px-4 py-3"
      style={{
        backgroundColor: C.surface,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
      }}>
      <TouchableOpacity
        onPress={() => nav.goBack()}
        className="w-10 h-10 rounded-full items-center justify-center"
        style={{backgroundColor: C.surfaceWarm}}
        activeOpacity={0.7}>
        <ChevronLeft color={C.ink} size={20} />
      </TouchableOpacity>
      <View className="flex-1 ml-3">
        <Text
          className="text-[10px] font-bold tracking-widest"
          style={{color: C.coralDeep, letterSpacing: 2}}>
          FAVOURITES
        </Text>
        <Text
          className="font-black"
          style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
          Wishlist
        </Text>
      </View>
      <View
        className="rounded-full px-2.5 py-1 flex-row items-center"
        style={{backgroundColor: C.surfaceCoral}}>
        <Heart color={C.coralDeep} size={10} fill={C.coralDeep} />
        <Text
          className="text-[11px] font-bold ml-1"
          style={{color: C.coralDeep}}>
          {count}
        </Text>
      </View>
    </View>
  );
}

function EmptyWishlist({nav}: {nav: Nav}) {
  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} count={0} />
      <View className="flex-1 items-center justify-center px-6">
        {/* Layered coral medallion — outer warm ring + inner gradient
            heart, matches the OrdersScreen empty-state pattern. */}
        <View
          className="w-28 h-28 rounded-full items-center justify-center mb-6"
          style={{
            backgroundColor: C.surfaceCoral,
            borderWidth: 2,
            borderColor: C.surface,
            shadowColor: C.coralDeep,
            shadowOpacity: 0.2,
            shadowOffset: {width: 0, height: 8},
            shadowRadius: 16,
            elevation: 6,
          }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              overflow: 'hidden',
            }}>
            <Gradient
              colors={[C.coralDeep, '#9a3412']}
              angle={135}
              borderRadius={40}
              style={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Heart color="white" size={34} fill="white" />
            </Gradient>
          </View>
        </View>
        <Text
          className="text-xl font-black mb-2"
          style={{color: C.ink, letterSpacing: -0.5}}>
          Save the gear you love
        </Text>
        <Text
          className="text-sm text-center mb-8 leading-5"
          style={{color: C.textSecondary, maxWidth: 280}}>
          Tap the heart on any product to save it here. Wishlists make
          finding your picks again easy — and we'll alert you on price drops.
        </Text>
        {/* Premium gradient CTA — funnel family. */}
        <View
          style={{
            borderRadius: 32,
            overflow: 'hidden',
            shadowColor: C.sageDeep,
            shadowOpacity: 0.32,
            shadowOffset: {width: 0, height: 6},
            shadowRadius: 12,
            elevation: 8,
          }}>
          <Gradient
            colors={[C.sageDeep, C.ink]}
            angle={135}
            borderRadius={32}>
            <TouchableOpacity
              className="px-8 py-3.5 flex-row items-center"
              onPress={() =>
                nav.navigate('BrowseTab', {screen: 'Browse'})
              }
              activeOpacity={0.85}>
              <Text
                className="text-sm font-bold text-white mr-2"
                style={{letterSpacing: -0.2}}>
                Browse products
              </Text>
              <ArrowRight color="white" size={15} />
            </TouchableOpacity>
          </Gradient>
        </View>
      </View>
    </SafeAreaView>
  );
}
