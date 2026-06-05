import React, {useEffect, useMemo, useState} from 'react';
import {
  Dimensions,
  FlatList,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useRoute, useNavigation} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Award,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Heart,
  Info,
  Leaf,
  RotateCcw,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Star,
  Truck,
  Zap,
} from 'lucide-react-native';
import {CachedImage} from '../../components/CachedImage';
import {Gradient} from '../../components/Gradient';
import {ProductCard} from '../../components/ProductCard';
import {useProduct, useProducts} from '../../queries/useProducts';
import {useAddToCart} from '../../queries/useCart';
import {
  useAddToWishlist,
  useRemoveFromWishlist,
  useWishlistLookup,
} from '../../queries/useWishlist';
import {useProductReviews} from '../../queries/useProductReviews';
import {showAlert} from '../../lib/dialog';
import {Events, track} from '../../lib/analytics';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {formatINR} from '../../lib/format';
import type {Variant} from '../../services/catalog.service';
import type {BrowseStackParamList} from '../../navigation/types';

type Route = RouteProp<BrowseStackParamList, 'ProductDetail'>;
type Nav = NativeStackNavigationProp<BrowseStackParamList, 'ProductDetail'>;

// Warm premium palette mirrors HomeScreen / BrowseScreen.
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

const {width: SCREEN_W} = Dimensions.get('window');
// Image area is the inner phone-frame width on web; on native it's the
// full screen. We cap at 414 so the carousel doesn't stretch absurdly
// on a tablet-sized RN-Web viewport.
const IMAGE_W = Math.min(SCREEN_W, 414);

// Fixed marketing trust badges — these are policy promises, not
// data. They stay co-located with the screen so the icons can be
// real React components rather than string lookups.
const HIGHLIGHT_FEATURES = [
  {Icon: Truck, label: 'Free shipping', sub: 'Over ₹999'},
  {Icon: RotateCcw, label: '7-day returns', sub: 'Hassle-free'},
  {Icon: ShieldCheck, label: '100% authentic', sub: 'Verified seller'},
  {Icon: Award, label: '1-yr warranty', sub: 'Manufacturer'},
];

// Human-readable date — used by review timestamps. We avoid a date
// library for bundle size; "2w ago" / "3mo ago" is enough fidelity.
function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function ProductDetailScreen() {
  const {params} = useRoute<Route>();
  const nav = useNavigation<Nav>();
  const query = useProduct(params.productSlug);
  const addToCart = useAddToCart();
  const wishlistLookup = useWishlistLookup();
  const addToWishlist = useAddToWishlist();
  const removeFromWishlist = useRemoveFromWishlist();

  // Related products — pull 6 from the catalog for the "You may also
  // like" rail. Always fetched (PDP gets a few KB of data either way).
  const relatedQuery = useProducts({page: 1, limit: 6});

  // Per-product reviews — separate endpoint so the PDP renders fast
  // even before this resolves. Sections that depend on reviews hide
  // themselves while loading or when empty.
  const reviewsQuery = useProductReviews(params.productSlug);

  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [descExpanded, setDescExpanded] = useState(false);
  const [specsExpanded, setSpecsExpanded] = useState(false);

  const product = query.data;

  useEffect(() => {
    if (product?.hasVariants && product.variants.length > 0) {
      setSelectedVariant(product.variants[0]);
    } else {
      setSelectedVariant(null);
    }
    setQuantity(1);
  }, [product?.id]);

  useEffect(() => {
    if (!product) return;
    track(Events.ProductViewed, {
      productId: product.id,
      productSlug: product.slug,
      brand: product.brand?.name,
      categoryName: product.category?.name,
      price: product.price,
    });
  }, [product?.id]);

  if (query.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <Spinner fullscreen />
      </SafeAreaView>
    );
  }
  if (query.isError || !product) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <ErrorState
          title="Couldn't load this product"
          onRetry={query.refetch}
        />
      </SafeAreaView>
    );
  }

  const displayPrice = selectedVariant?.price ?? product.price;
  const displayCompareAt =
    selectedVariant?.compareAtPrice ?? product.compareAtPrice;
  const hasDiscount =
    displayCompareAt != null &&
    displayPrice != null &&
    displayCompareAt > displayPrice;
  const discountPct = hasDiscount
    ? Math.round(
        ((displayCompareAt! - displayPrice!) / displayCompareAt!) * 100,
      )
    : 0;
  const savings = hasDiscount ? displayCompareAt! - displayPrice! : 0;

  const inStock = selectedVariant ? selectedVariant.inStock : product.inStock;
  const stockQty = selectedVariant?.totalStock ?? product.totalAvailableStock ?? 0;
  const isLowStock = inStock && stockQty > 0 && stockQty <= 10;

  const images =
    product.images.length > 0 ? product.images : selectedVariant?.images ?? [];
  const wishlistItemId = wishlistLookup?.get(product.id);
  const isWishlisted = !!wishlistItemId;

  // Aggregate review stats — prefer the dedicated reviews endpoint
  // when it responds, fall back to the product payload (catalog may
  // denormalize averageRating + reviewCount for list display).
  const reviewSummary = reviewsQuery.data?.summary;
  const reviewsList = reviewsQuery.data?.reviews ?? [];
  const averageRating =
    reviewSummary?.averageRating ?? product.averageRating ?? null;
  const reviewCount =
    reviewSummary?.reviewCount ?? product.reviewCount ?? 0;
  const overallRatingLabel = averageRating != null
    ? averageRating.toFixed(1)
    : null;
  const hasReviews = reviewCount > 0;

  // Specs — populated by the storefront-filters / metafields backend
  // migration. We render the section only when the product actually
  // carries metafields, so older API versions degrade silently.
  const specRows = (product.metafields ?? []).map(m => ({
    key: m.label || `${m.namespace}.${m.key}`,
    value: m.value,
  }));
  const hasSpecs = specRows.length > 0;

  const cleanedBrand = product.brand?.name
    ? product.brand.name.replace(/\s*\([^)]*\)\s*/g, '').trim()
    : null;

  const relatedProducts = (relatedQuery.data?.products ?? []).filter(
    p => p.id !== product.id,
  );

  const onAddToCart = (buyNow = false) => {
    if (!inStock) return;
    addToCart.mutate(
      {productId: product.id, variantId: selectedVariant?.id, quantity},
      {
        onSuccess: () => {
          track(Events.CartItemAdded, {
            productId: product.id,
            variantId: selectedVariant?.id,
            unitPrice: displayPrice,
          });
          if (buyNow) {
            nav.getParent()?.navigate('CartTab', {screen: 'Cart'});
          } else {
            showAlert('Added to cart', product.title);
          }
        },
        onError: err =>
          showAlert(
            'Could not add to cart',
            err instanceof Error ? err.message : 'Try again.',
          ),
      },
    );
  };

  const onToggleWishlist = () => {
    if (isWishlisted && wishlistItemId) {
      removeFromWishlist.mutate(wishlistItemId);
    } else {
      addToWishlist.mutate({
        productId: product.id,
        variantId: selectedVariant?.id,
      });
      track(Events.WishlistItemAdded, {
        productId: product.id,
        variantId: selectedVariant?.id,
      });
    }
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      {/* ── Top action bar — floating over the image ───────────── */}
      <View
        className="flex-row items-center px-4 py-3"
        style={{backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border}}>
        <TouchableOpacity
          onPress={() => nav.goBack()}
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          activeOpacity={0.7}>
          <ChevronLeft color={C.ink} size={20} />
        </TouchableOpacity>
        <Text
          className="flex-1 text-sm font-semibold ml-3"
          style={{color: C.ink, letterSpacing: -0.2}}
          numberOfLines={1}>
          {product.title}
        </Text>
        <TouchableOpacity
          className="w-10 h-10 rounded-full items-center justify-center mr-2"
          style={{backgroundColor: C.surfaceWarm}}
          activeOpacity={0.7}>
          <Share2 color={C.ink} size={17} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onToggleWishlist}
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          disabled={addToWishlist.isPending || removeFromWishlist.isPending}
          accessibilityLabel={
            isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'
          }>
          <Heart
            color={isWishlisted ? C.coralDeep : C.ink}
            fill={isWishlisted ? C.coralDeep : 'transparent'}
            size={17}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 120}}
        showsVerticalScrollIndicator={false}>
        {/* ── Image carousel ────────────────────────────────────── */}
        <View style={{backgroundColor: C.surface}}>
          {images.length > 0 ? (
            <View className="relative">
              <FlatList
                data={images}
                keyExtractor={img => img.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={e => {
                  const idx = Math.round(
                    e.nativeEvent.contentOffset.x / IMAGE_W,
                  );
                  setActiveImage(idx);
                }}
                renderItem={({item}) => (
                  <View style={{backgroundColor: C.surfaceWarm}}>
                    <CachedImage
                      source={{uri: item.url}}
                      style={{width: IMAGE_W, height: IMAGE_W}}
                      resizeMode="cover"
                    />
                  </View>
                )}
              />

              {/* Subtle bottom fade so chips + the title block below
                  read cleanly against any image background. */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 80,
                }}>
                <Gradient
                  colors={['rgba(15,23,42,0)', 'rgba(15,23,42,0.18)']}
                  angle={180}
                  style={{width: '100%', height: '100%'}}
                />
              </View>

              {/* Discount ribbon — coral gradient with a tilted
                  presentation that feels like a sale tag pinned to
                  the corner of the image. */}
              {hasDiscount ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 16,
                    left: 16,
                    shadowColor: C.coralDeep,
                    shadowOpacity: 0.32,
                    shadowOffset: {width: 0, height: 4},
                    shadowRadius: 8,
                    elevation: 4,
                  }}>
                  <Gradient
                    colors={[C.coral, C.coralDeep]}
                    angle={135}
                    borderRadius={8}>
                    <View
                      className="px-3 py-1.5 flex-row items-center"
                      pointerEvents="none">
                      <Zap color="white" size={11} fill="white" />
                      <Text
                        className="text-xs font-black text-white ml-1"
                        style={{letterSpacing: 0.5}}>
                        {discountPct}% OFF
                      </Text>
                    </View>
                  </Gradient>
                </View>
              ) : null}

              {/* Trending / authentic chip (top-right complement to
                  the wishlist action bar above). Kept subtle so it
                  doesn't fight the discount ribbon. */}
              {!hasDiscount && product.totalAvailableStock > 0 ? (
                <View
                  className="absolute rounded-full px-2.5 py-1 flex-row items-center"
                  style={{
                    top: 16,
                    left: 16,
                    backgroundColor: 'rgba(255,255,255,0.92)',
                  }}>
                  <ShieldCheck color={C.sageDeep} size={11} />
                  <Text
                    className="text-[10px] font-bold ml-1"
                    style={{color: C.sageDeep, letterSpacing: 0.3}}>
                    100% AUTHENTIC
                  </Text>
                </View>
              ) : null}

              {/* Image counter pill — frosted-glass style on the
                  bottom-right corner. */}
              {images.length > 1 ? (
                <View
                  className="absolute rounded-full px-2.5 py-1 flex-row items-center"
                  style={{
                    bottom: 16,
                    right: 16,
                    backgroundColor: 'rgba(15,23,42,0.7)',
                  }}>
                  <View
                    className="w-1.5 h-1.5 rounded-full mr-1.5"
                    style={{backgroundColor: 'white'}}
                  />
                  <Text
                    className="text-[10px] font-bold text-white"
                    style={{letterSpacing: 0.3}}>
                    {activeImage + 1} / {images.length}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View
              style={{
                width: IMAGE_W,
                height: IMAGE_W,
                backgroundColor: C.surfaceWarm,
              }}
              className="items-center justify-center">
              <Text style={{fontSize: 64, opacity: 0.3}}>📦</Text>
            </View>
          )}

          {/* Thumbnails strip */}
          {images.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingVertical: 12,
                gap: 8,
              }}>
              {images.map((img, idx) => (
                <TouchableOpacity
                  key={img.id}
                  className="rounded-xl overflow-hidden"
                  style={{
                    width: 56,
                    height: 56,
                    borderWidth: idx === activeImage ? 2 : 1,
                    borderColor:
                      idx === activeImage ? C.ink : C.border,
                  }}
                  onPress={() => setActiveImage(idx)}
                  activeOpacity={0.85}>
                  <CachedImage
                    source={{uri: img.url}}
                    style={{width: '100%', height: '100%'}}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}
        </View>

        {/* ── Title + brand + rating block ──────────────────────── */}
        <View className="px-5 pt-5" style={{backgroundColor: C.surface}}>
          {cleanedBrand ? (
            <View className="flex-row items-center mb-3">
              <Text
                className="text-[10px] font-bold uppercase"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                {cleanedBrand}
              </Text>
              <View
                className="ml-2 rounded-full px-2 py-0.5 flex-row items-center"
                style={{backgroundColor: C.surfaceSage}}>
                <ShieldCheck color={C.sageDeep} size={10} />
                <Text
                  className="text-[9px] font-bold ml-1"
                  style={{color: C.sageDeep, letterSpacing: 0.4}}>
                  AUTHENTIC
                </Text>
              </View>
            </View>
          ) : null}

          {/* Title with accent bar — matches the rhythm of section
              headers across the rest of the app. */}
          <View className="flex-row items-start">
            <View
              className="rounded-full mr-3 mt-2"
              style={{
                width: 3,
                height: 24,
                backgroundColor: C.sageDeep,
              }}
            />
            <Text
              className="flex-1 font-black"
              style={{
                color: C.ink,
                fontSize: 26,
                letterSpacing: -0.8,
                lineHeight: 32,
              }}>
              {product.title}
            </Text>
          </View>

          {/* Rating row — hides until we actually have a rating */}
          {overallRatingLabel ? (
            <View className="flex-row items-center mt-3">
              <View
                className="flex-row items-center rounded-full px-2.5 py-1"
                style={{backgroundColor: C.surfaceGold}}>
                <Star color={C.goldDeep} fill={C.goldDeep} size={11} />
                <Text
                  className="text-xs font-bold ml-1"
                  style={{color: C.goldDeep}}>
                  {overallRatingLabel}
                </Text>
              </View>
              {reviewCount > 0 ? (
                <Text
                  className="text-xs ml-2"
                  style={{color: C.textSecondary}}>
                  {reviewCount.toLocaleString('en-IN')} reviews
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Price block — premium treatment with ticket-style
              savings tag when discounted. */}
          <View className="mt-5 mb-4">
            <View className="flex-row items-baseline flex-wrap">
              <Text
                className="font-black"
                style={{
                  color: C.ink,
                  fontSize: 34,
                  letterSpacing: -1.2,
                  lineHeight: 38,
                }}>
                {formatINR(displayPrice)}
              </Text>
              {hasDiscount ? (
                <Text
                  className="text-base line-through ml-3"
                  style={{color: C.textMuted}}>
                  {formatINR(displayCompareAt)}
                </Text>
              ) : null}
            </View>

            {hasDiscount ? (
              <View className="flex-row items-center mt-2 flex-wrap" style={{gap: 8}}>
                {/* Savings ticket — coral gradient pill, white text,
                    feels like a price tag you'd peel off a box. */}
                <Gradient
                  colors={[C.coral, C.coralDeep]}
                  angle={120}
                  borderRadius={6}
                  style={{
                    shadowColor: C.coralDeep,
                    shadowOpacity: 0.32,
                    shadowOffset: {width: 0, height: 3},
                    shadowRadius: 6,
                    elevation: 3,
                  }}>
                  <View
                    className="flex-row items-center px-2.5 py-1"
                    pointerEvents="none">
                    <Zap color="white" size={11} />
                    <Text
                      className="text-[11px] font-black ml-1"
                      style={{
                        color: 'white',
                        letterSpacing: 0.3,
                      }}>
                      SAVE {formatINR(savings)}
                    </Text>
                  </View>
                </Gradient>
                <Text
                  className="text-[11px] font-bold"
                  style={{color: C.coralDeep, letterSpacing: 0.3}}>
                  {discountPct}% OFF
                </Text>
              </View>
            ) : null}

            <Text
              className="text-[11px] mt-2"
              style={{color: C.textTertiary}}>
              Inclusive of all taxes · Free shipping over ₹999
            </Text>
          </View>

          {/* Stock urgency */}
          {isLowStock ? (
            <View
              className="rounded-xl px-3 py-2 flex-row items-center mb-4"
              style={{backgroundColor: C.surfaceCoral}}>
              <Zap color={C.coralDeep} size={14} />
              <Text
                className="text-xs font-bold ml-2"
                style={{color: C.coralDeep}}>
                Hurry, only {stockQty} left!
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Variant selector ───────────────────────────────────── */}
        {product.hasVariants && product.variants.length > 0 ? (
          <View
            className="px-5 pb-5 pt-1"
            style={{backgroundColor: C.surface}}>
            <Text
              className="text-sm font-bold mb-3"
              style={{color: C.ink, letterSpacing: -0.2}}>
              Choose variant
            </Text>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {product.variants.map(v => {
                const isSelected = v.id === selectedVariant?.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    className="rounded-xl px-4 py-2.5"
                    style={{
                      borderWidth: 1.5,
                      borderColor: isSelected ? C.ink : C.border,
                      backgroundColor: isSelected ? C.ink : C.surface,
                    }}
                    onPress={() => setSelectedVariant(v)}
                    activeOpacity={0.7}>
                    <Text
                      className="text-sm font-semibold"
                      style={{color: isSelected ? 'white' : C.ink}}>
                      {v.title || 'Default'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Size picker now derives only from real variants. Products
            without sized variants intentionally show nothing here —
            we no longer fake a size grid that adds nothing to cart. */}

        {/* ── Quantity stepper ──────────────────────────────────── */}
        <View
          className="px-5 pb-5 flex-row items-center justify-between"
          style={{backgroundColor: C.surface}}>
          <Text
            className="text-sm font-bold"
            style={{color: C.ink, letterSpacing: -0.2}}>
            Quantity
          </Text>
          <View
            className="flex-row items-center rounded-full"
            style={{backgroundColor: C.surfaceWarm}}>
            <TouchableOpacity
              className="w-10 h-10 items-center justify-center"
              onPress={() => setQuantity(q => Math.max(1, q - 1))}
              activeOpacity={0.7}>
              <Text className="text-lg font-bold" style={{color: C.ink}}>
                −
              </Text>
            </TouchableOpacity>
            <Text
              className="px-3 text-base font-bold"
              style={{color: C.ink, minWidth: 32, textAlign: 'center'}}>
              {quantity}
            </Text>
            <TouchableOpacity
              className="w-10 h-10 items-center justify-center"
              onPress={() => setQuantity(q => Math.min(stockQty || 99, q + 1))}
              activeOpacity={0.7}>
              <Text className="text-lg font-bold" style={{color: C.ink}}>
                +
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Feature highlights row ────────────────────────────── */}
        <View
          className="mt-3 px-5 py-5"
          style={{backgroundColor: C.surface}}>
          <View
            className="flex-row flex-wrap"
            style={{justifyContent: 'space-between', rowGap: 16}}>
            {HIGHLIGHT_FEATURES.map(f => (
              <View
                key={f.label}
                style={{width: '23%'}}
                className="items-center">
                <View
                  className="w-11 h-11 rounded-full items-center justify-center mb-1.5"
                  style={{backgroundColor: C.surfaceSage}}>
                  <f.Icon color={C.sageDeep} size={18} />
                </View>
                <Text
                  className="text-[10px] font-bold text-center"
                  style={{color: C.ink, letterSpacing: -0.1}}>
                  {f.label}
                </Text>
                <Text
                  className="text-[9px] text-center mt-0.5"
                  style={{color: C.textTertiary}}>
                  {f.sub}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Description ───────────────────────────────────────── */}
        {(product.shortDescription || product.description) ? (
          <View
            className="mt-3 px-5 py-5"
            style={{backgroundColor: C.surface}}>
            <Text
              className="text-sm font-bold mb-2"
              style={{color: C.ink, letterSpacing: -0.2}}>
              About this product
            </Text>
            {product.shortDescription ? (
              <Text
                className="text-sm leading-6 mb-2"
                style={{color: C.inkSoft}}>
                {product.shortDescription}
              </Text>
            ) : null}
            {product.description ? (
              <>
                <Text
                  className="text-sm leading-6"
                  style={{color: C.textSecondary}}
                  numberOfLines={descExpanded ? undefined : 3}>
                  {product.description.replace(/<[^>]+>/g, '')}
                </Text>
                <TouchableOpacity
                  className="flex-row items-center mt-2"
                  onPress={() => setDescExpanded(v => !v)}
                  activeOpacity={0.7}>
                  <Text
                    className="text-xs font-bold mr-1"
                    style={{color: C.sageDeep}}>
                    {descExpanded ? 'Show less' : 'Read more'}
                  </Text>
                  {descExpanded ? (
                    <ChevronUp color={C.sageDeep} size={13} />
                  ) : (
                    <ChevronDown color={C.sageDeep} size={13} />
                  )}
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        ) : null}

        {/* ── Specifications ─────────────────────────────────────── */}
        <View
          className="mt-3"
          style={{backgroundColor: C.surface}}>
          {hasSpecs ? (
            <>
              <TouchableOpacity
                className="px-5 py-4 flex-row items-center justify-between"
                onPress={() => setSpecsExpanded(v => !v)}
                activeOpacity={0.7}>
                <View className="flex-row items-center">
                  <Info color={C.ink} size={15} />
                  <Text
                    className="text-sm font-bold ml-2"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    Specifications
                  </Text>
                </View>
                {specsExpanded ? (
                  <ChevronUp color={C.textTertiary} size={16} />
                ) : (
                  <ChevronDown color={C.textTertiary} size={16} />
                )}
              </TouchableOpacity>
              {specsExpanded ? (
                <View className="px-5 pb-4">
                  {specRows.map(row => (
                    <View
                      key={row.key}
                      className="flex-row py-2 border-b"
                      style={{borderColor: C.border}}>
                      <Text
                        className="text-xs flex-1"
                        style={{color: C.textTertiary}}>
                        {row.key}
                      </Text>
                      <Text
                        className="text-xs font-medium flex-1"
                        style={{color: C.ink}}>
                        {row.value}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>

        {/* ── Reviews summary — entire section hides until the
             reviews endpoint returns at least one review. No more
             fake testimonials filling space pre-launch. ───────── */}
        {hasReviews && overallRatingLabel ? (
          <View
            className="mt-3 px-5 py-5"
            style={{backgroundColor: C.surface}}>
            <View className="flex-row items-end justify-between mb-4">
              <Text
                className="text-sm font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                Ratings & reviews
              </Text>
              <TouchableOpacity activeOpacity={0.7}>
                <Text
                  className="text-xs font-semibold"
                  style={{color: C.sageDeep}}>
                  See all →
                </Text>
              </TouchableOpacity>
            </View>

            {/* Overall + breakdown bars */}
            <View className="flex-row mb-5">
              <View
                className="items-center pr-5 mr-5"
                style={{borderRightWidth: 1, borderRightColor: C.border}}>
                <Text
                  className="font-black"
                  style={{
                    color: C.ink,
                    fontSize: 40,
                    letterSpacing: -1.5,
                    lineHeight: 42,
                  }}>
                  {overallRatingLabel}
                </Text>
                <View className="flex-row mt-1">
                  {Array.from({length: 5}).map((_, i) => (
                    <Star
                      key={i}
                      color={
                        averageRating != null && i < Math.round(averageRating)
                          ? C.gold
                          : C.border
                      }
                      fill={
                        averageRating != null && i < Math.round(averageRating)
                          ? C.gold
                          : 'transparent'
                      }
                      size={12}
                    />
                  ))}
                </View>
                <Text
                  className="text-[10px] mt-1"
                  style={{color: C.textTertiary}}>
                  {reviewCount.toLocaleString('en-IN')}
                </Text>
              </View>
              <View className="flex-1">
                {[5, 4, 3, 2, 1].map(stars => {
                  const pct =
                    reviewSummary?.ratingBreakdown?.[String(stars)] ?? 0;
                  return (
                    <View
                      key={stars}
                      className="flex-row items-center mb-1.5">
                      <Text
                        className="text-[10px] font-semibold"
                        style={{color: C.textSecondary, width: 12}}>
                        {stars}
                      </Text>
                      <Star color={C.gold} fill={C.gold} size={9} />
                      <View
                        className="flex-1 mx-2 rounded-full overflow-hidden"
                        style={{height: 5, backgroundColor: C.surfaceWarm}}>
                        <View
                          className="rounded-full"
                          style={{
                            height: 5,
                            width: `${Math.max(0, Math.min(1, pct)) * 100}%`,
                            backgroundColor: C.gold,
                          }}
                        />
                      </View>
                      <Text
                        className="text-[10px]"
                        style={{
                          color: C.textTertiary,
                          width: 30,
                          textAlign: 'right',
                        }}>
                        {Math.round(Math.max(0, Math.min(1, pct)) * 100)}%
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Individual review cards — capped at 3 on the PDP; the
                "See all" link above takes the user to a future
                dedicated reviews screen. */}
            {reviewsList.slice(0, 3).map(r => (
              <View
                key={r.id}
                className="pt-4 mt-1 border-t"
                style={{borderColor: C.border}}>
                <View className="flex-row items-center mb-2">
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mr-3"
                    style={{backgroundColor: C.surfaceSage}}>
                    <Text
                      className="text-xs font-bold"
                      style={{color: C.sageDeep}}>
                      {r.authorName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center">
                      <Text
                        className="text-xs font-bold"
                        style={{color: C.ink}}>
                        {r.authorName}
                      </Text>
                      {r.verifiedBuyer ? (
                        <View
                          className="ml-2 rounded-full px-1.5"
                          style={{backgroundColor: C.surfaceSage}}>
                          <Text
                            className="text-[9px] font-bold"
                            style={{color: C.sageDeep}}>
                            VERIFIED
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <View className="flex-row items-center mt-0.5">
                      {Array.from({
                        length: Math.max(1, Math.min(5, Math.round(r.rating))),
                      }).map((_, i) => (
                        <Star
                          key={i}
                          color={C.gold}
                          fill={C.gold}
                          size={9}
                        />
                      ))}
                      <Text
                        className="text-[10px] ml-2"
                        style={{color: C.textTertiary}}>
                        {timeAgo(r.createdAt)}
                      </Text>
                    </View>
                  </View>
                </View>
                {r.title ? (
                  <Text
                    className="text-sm font-bold mb-1"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    {r.title}
                  </Text>
                ) : null}
                <Text
                  className="text-xs leading-5"
                  style={{color: C.textSecondary}}>
                  {r.body}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Sustainability strip ──────────────────────────────── */}
        <View className="px-5 mt-3">
          <View
            className="rounded-2xl p-4 flex-row items-center"
            style={{backgroundColor: C.surfaceSage}}>
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{backgroundColor: C.sage}}>
              <Leaf color="white" size={18} />
            </View>
            <View className="flex-1">
              <Text
                className="text-sm font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                Sustainably shipped
              </Text>
              <Text
                className="text-xs mt-0.5"
                style={{color: C.textSecondary}}>
                Carbon-offset · 100% recycled packaging
              </Text>
            </View>
          </View>
        </View>

        {/* ── Related products ──────────────────────────────────── */}
        {relatedProducts.length > 0 ? (
          <View className="pt-7">
            <View className="px-5 mb-3 flex-row items-end justify-between">
              <View>
                <Text
                  className="text-lg font-bold"
                  style={{color: C.ink, letterSpacing: -0.3}}>
                  You may also like
                </Text>
                <Text
                  className="text-xs mt-0.5"
                  style={{color: C.textTertiary}}>
                  Picks based on this product
                </Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{paddingHorizontal: 20, gap: 12}}>
              {relatedProducts.slice(0, 6).map(p => (
                <View key={p.id} style={{width: 160}}>
                  <ProductCard
                    product={p}
                    widthPercent={100}
                    showQuickAdd={false}
                    onPress={slug =>
                      nav.push('ProductDetail', {productSlug: slug})
                    }
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Sticky bottom action bar ──────────────────────────── */}
      <View
        className="absolute bottom-0 left-0 right-0 px-4 pt-3 pb-4 flex-row items-center"
        style={{
          backgroundColor: C.surface,
          borderTopWidth: 1,
          borderTopColor: C.border,
          gap: 10,
          // Lifted shadow above the bar for depth so the page content
          // doesn't feel like it bleeds into the CTA strip.
          shadowColor: C.ink,
          shadowOpacity: 0.08,
          shadowOffset: {width: 0, height: -6},
          shadowRadius: 16,
          elevation: 12,
        }}>
        <TouchableOpacity
          className="w-12 h-12 rounded-2xl items-center justify-center"
          style={{
            backgroundColor: isWishlisted ? C.surfaceCoral : C.surfaceWarm,
            borderWidth: 1,
            borderColor: isWishlisted ? C.coral : C.border,
          }}
          onPress={onToggleWishlist}
          disabled={addToWishlist.isPending || removeFromWishlist.isPending}
          activeOpacity={0.7}
          accessibilityLabel={
            isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'
          }>
          <Heart
            color={isWishlisted ? C.coralDeep : C.ink}
            fill={isWishlisted ? C.coralDeep : 'transparent'}
            size={20}
          />
        </TouchableOpacity>

        <TouchableOpacity
          className="flex-1 rounded-2xl flex-row items-center justify-center"
          style={{
            backgroundColor: inStock ? C.sageDeep : C.surfaceWarm,
            borderWidth: inStock ? 0 : 1.5,
            borderColor: C.border,
            height: 50,
          }}
          onPress={() => onAddToCart(false)}
          disabled={!inStock || addToCart.isPending}
          activeOpacity={0.85}>
          <ShoppingBag color={inStock ? 'white' : C.textMuted} size={16} />
          <Text
            className="text-sm font-bold ml-2"
            style={{
              color: inStock ? 'white' : C.textMuted,
              letterSpacing: -0.2,
            }}>
            {addToCart.isPending ? 'Adding…' : 'Add to cart'}
          </Text>
        </TouchableOpacity>

        {/* Buy now — same solid red as Add to cart (plain TouchableOpacity,
            no Gradient) so the label centres and there's no black half.
            Flat grey when out of stock. */}
        {inStock ? (
          <TouchableOpacity
            className="flex-1 rounded-2xl items-center justify-center"
            style={{
              backgroundColor: C.sageDeep,
              height: 50,
              shadowColor: C.sageDeep,
              shadowOpacity: 0.32,
              shadowOffset: {width: 0, height: 4},
              shadowRadius: 10,
              elevation: 6,
            }}
            onPress={() => onAddToCart(true)}
            disabled={addToCart.isPending}
            activeOpacity={0.85}>
            <Text
              className="text-sm font-bold text-white"
              style={{letterSpacing: -0.2}}>
              Buy now
            </Text>
          </TouchableOpacity>
        ) : (
          <View
            className="flex-1 rounded-2xl items-center justify-center"
            style={{backgroundColor: C.textMuted, height: 50}}>
            <Text className="text-sm font-bold text-white">
              Out of stock
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
