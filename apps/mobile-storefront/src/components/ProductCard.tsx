import React, {useState} from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {Heart, ShoppingBag, Star} from 'lucide-react-native';
import type {ProductCardData} from '../services/catalog.service';
import {useAddToCart} from '../queries/useCart';
import {
  useWishlistLookup,
  useAddToWishlist,
  useRemoveFromWishlist,
} from '../queries/useWishlist';
import {CachedImage} from './CachedImage';
import {formatINR} from '../lib/format';

// Warm premium palette mirrors HomeScreen / BrowseScreen.
const C = {
  surface: '#ffffff',
  surfaceImage: '#fafafa',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  inkSoft: '#1a1a1a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',
  coral: '#fb923c',
  coralDeep: '#ea580c',
  sage: '#ef4444',
  sageDeep: '#dc2626',
  gold: '#b91c1c',
  goldDeep: '#991b1b',
};

interface Props {
  product: ProductCardData;
  onPress: (slug: string) => void;
  widthPercent?: number;
  /** Show the inline "Quick add" button. Defaults true on grid cards,
   *  callers can pass false in compact contexts (rails inside Home). */
  showQuickAdd?: boolean;
}

export function ProductCard({
  product,
  onPress,
  widthPercent,
  showQuickAdd = true,
}: Props) {
  // Wishlist (the heart) — derived from the shared wishlist query so the
  // filled/empty state is real and persists, not local-only.
  const wishlistLookup = useWishlistLookup();
  const addToWishlist = useAddToWishlist();
  const removeFromWishlist = useRemoveFromWishlist();
  const wishlistItemId = wishlistLookup?.get(product.id);
  const isWishlisted = !!wishlistItemId;
  const addToCart = useAddToCart();
  // Transient confirmation flags for the quick-add button — the mutation
  // itself is fire-and-forget (the cart query invalidates on success).
  const [justAdded, setJustAdded] = useState(false);
  const [justFailed, setJustFailed] = useState(false);

  const hasDiscount =
    product.compareAtPrice != null &&
    product.price != null &&
    product.compareAtPrice > product.price;

  const discountPct = hasDiscount
    ? Math.round(
        ((product.compareAtPrice! - product.price!) /
          product.compareAtPrice!) *
          100,
      )
    : 0;

  const isOutOfStock = product.totalAvailableStock === 0;
  const isLowStock =
    product.totalAvailableStock > 0 && product.totalAvailableStock <= 10;

  // Real review aggregate from the API. Null/zero when no approved
  // reviews exist yet — the rating row hides itself entirely (no fake
  // 4.x seeded from product id any more).
  const ratingLabel =
    product.averageRating != null && product.reviewCount && product.reviewCount > 0
      ? product.averageRating.toFixed(1)
      : null;
  const showRating = ratingLabel != null;

  // Real variant colors from the API (distinct COLOR option values
  // collapsed across variants, capped at 6 server-side). swatchCount
  // is the total distinct count so "+N" reflects reality.
  const swatches = product.swatches ?? [];
  const totalSwatches = product.swatchCount ?? swatches.length;
  const showSwatches = swatches.length > 0;

  const cleanedBrand = product.brandName
    ? product.brandName.replace(/\s*\([^)]*\)\s*/g, '').trim()
    : null;

  // Quick add: simple products go straight to the cart; variant products
  // (size/colour) route to the detail screen so the shopper can choose —
  // a card tap can't know which variant they mean.
  const isVariantProduct = !!product.hasVariants;
  const handleQuickAdd = () => {
    if (isVariantProduct) {
      onPress(product.slug);
      return;
    }
    addToCart.mutate(
      {productId: product.id, quantity: 1},
      {
        onSuccess: () => {
          setJustAdded(true);
          setTimeout(() => setJustAdded(false), 1500);
        },
        onError: () => {
          setJustFailed(true);
          setTimeout(() => setJustFailed(false), 1800);
        },
      },
    );
  };
  const quickAddLabel = isVariantProduct
    ? 'CHOOSE OPTIONS'
    : addToCart.isPending
      ? 'ADDING…'
      : justAdded
        ? 'ADDED'
        : justFailed
          ? 'TRY AGAIN'
          : 'QUICK ADD';
  const quickAddBg = justAdded
    ? C.sageDeep
    : justFailed
      ? C.coralDeep
      : C.ink;

  return (
    <TouchableOpacity
      onPress={() => onPress(product.slug)}
      activeOpacity={0.92}
      style={[
        widthPercent ? {width: `${widthPercent}%`} : undefined,
        {
          // Subtle elevation — softer than RN's default shadows. Renders
          // cleanly on both iOS and on web via box-shadow translation.
          shadowColor: '#0a0a0a',
          shadowOpacity: 0.04,
          shadowOffset: {width: 0, height: 4},
          shadowRadius: 12,
          elevation: 2,
        },
      ]}
      className="mb-5">
      {/* Image area */}
      <View
        className="rounded-2xl overflow-hidden aspect-square mb-2.5 relative"
        style={{backgroundColor: C.surfaceImage}}>
        {product.primaryImageUrl ? (
          <CachedImage
            source={{uri: product.primaryImageUrl}}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <View
            className="w-full h-full items-center justify-center"
            style={{backgroundColor: C.surfaceImage}}>
            <Text style={{fontSize: 40, opacity: 0.3}}>📦</Text>
          </View>
        )}

        {/* Top-left badge stack (discount + trending) */}
        <View
          className="absolute"
          style={{top: 10, left: 10, gap: 6}}>
          {hasDiscount ? (
            <View
              className="rounded-full px-2 py-0.5 self-start"
              style={{backgroundColor: C.coralDeep}}>
              <Text
                className="text-[10px] font-bold text-white"
                style={{letterSpacing: 0.3}}>
                {discountPct}% OFF
              </Text>
            </View>
          ) : null}
          {/* "TRENDING" was a fake seed-based flag; removed until a
              real signal (sales velocity, view count) ships. */}
        </View>

        {/* Wishlist heart top-right */}
        <TouchableOpacity
          className="absolute w-8 h-8 rounded-full items-center justify-center"
          style={{
            top: 8,
            right: 8,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
          }}
          onPress={e => {
            e.stopPropagation?.();
            if (wishlistItemId) {
              removeFromWishlist.mutate(wishlistItemId);
            } else {
              addToWishlist.mutate({productId: product.id});
            }
          }}
          disabled={addToWishlist.isPending || removeFromWishlist.isPending}
          activeOpacity={0.7}
          accessibilityLabel={
            isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'
          }>
          <Heart
            color={isWishlisted ? C.coralDeep : C.textTertiary}
            size={15}
            fill={isWishlisted ? C.coralDeep : 'transparent'}
          />
        </TouchableOpacity>

        {/* Out-of-stock veil */}
        {isOutOfStock ? (
          <View
            className="absolute inset-0 items-center justify-center"
            style={{backgroundColor: 'rgba(255,255,255,0.7)'}}>
            <Text
              className="text-[10px] font-bold tracking-widest"
              style={{color: C.coralDeep, letterSpacing: 1.5}}>
              SOLD OUT
            </Text>
          </View>
        ) : null}

        {/* Low-stock urgency strip pinned to the image bottom */}
        {isLowStock && !isOutOfStock ? (
          <View
            className="absolute left-0 right-0 px-2 py-1 flex-row items-center justify-center"
            style={{
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
            }}>
            <View
              className="w-1.5 h-1.5 rounded-full mr-1.5"
              style={{backgroundColor: C.coral}}
            />
            <Text
              className="text-[10px] font-bold text-white"
              style={{letterSpacing: 0.3}}>
              Only {product.totalAvailableStock} left
            </Text>
          </View>
        ) : null}
      </View>

      {/* Body — fixed-height container ensures every card occupies
          the same vertical space so the 2-column grid stays aligned.
          Each row inside has a reserved height; optional rows render
          an empty placeholder of the same height when their content
          is missing. */}
      {/* Body container — minHeight was 184 when rating + swatches
          slots were always reserved. Now both rows are conditional,
          so the floor drops to 140 (title + price + CTA). Cards in a
          mixed-data row stay roughly aligned because most data
          differences are within ~20pt. */}
      <View style={{minHeight: 140}}>
        {/* Brand — fixed 14pt slot, blank placeholder when missing */}
        <View style={{height: 14, marginBottom: 2}}>
          {cleanedBrand ? (
            <Text
              className="text-[10px] font-bold uppercase"
              style={{color: C.textTertiary, letterSpacing: 1.2}}
              numberOfLines={1}>
              {cleanedBrand}
            </Text>
          ) : null}
        </View>

        {/* Title — 2-line fixed slot */}
        <Text
          className="text-sm font-semibold mb-1.5"
          style={{
            color: C.ink,
            letterSpacing: -0.2,
            lineHeight: 18,
            height: 36,
          }}
          numberOfLines={2}>
          {product.title}
        </Text>

        {/* Rating row — only rendered when there are approved reviews.
            No reserved-height slot any more; the card collapses
            ~22pt (16pt row + 6pt margin) when this is absent. */}
        {showRating ? (
          <View
            className="flex-row items-center mb-1.5"
            style={{height: 16}}>
            <Star color={C.gold} fill={C.gold} size={11} />
            <Text
              className="text-[11px] font-semibold ml-1"
              style={{color: C.ink}}>
              {ratingLabel}
            </Text>
            <Text
              className="text-[10px] ml-1"
              style={{color: C.textTertiary}}>
              ({(product.reviewCount ?? 0).toLocaleString('en-IN')})
            </Text>
          </View>
        ) : null}

        {/* Swatches — only rendered when the product has at least one
            COLOR option. Collapses ~22pt (14pt row + 8pt margin) when
            absent (e.g. shuttlecocks, helmets, anything without a
            visible color variant). */}
        {showSwatches ? (
          <View
            className="flex-row items-center mb-2"
            style={{gap: 5, height: 14}}>
            {swatches.map((c, i) => (
              <View
                key={`${c}-${i}`}
                className="rounded-full"
                style={{
                  width: 11,
                  height: 11,
                  backgroundColor: c,
                  // White swatches need an outline to stay visible
                  // against the warm cream card background.
                  borderWidth:
                    c.toLowerCase() === '#ffffff' || c.toLowerCase() === '#fff'
                      ? 0.5
                      : 0,
                  borderColor: C.border,
                }}
              />
            ))}
            {/* "+N" only when the product has more distinct colors
                than the 6 rendered. */}
            {totalSwatches > swatches.length ? (
              <Text
                className="text-[10px] ml-1"
                style={{color: C.textTertiary}}>
                +{totalSwatches - swatches.length}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Price block — fixed 38pt slot (primary line + savings/spacer) */}
        <View style={{height: 38, marginBottom: 8}}>
          <View className="flex-row items-baseline">
            <Text
              className="font-bold"
              style={{
                color: C.ink,
                fontSize: 16,
                letterSpacing: -0.3,
              }}>
              {formatINR(product.price)}
            </Text>
            {hasDiscount ? (
              <Text
                className="text-xs line-through ml-2"
                style={{color: C.textMuted}}>
                {formatINR(product.compareAtPrice)}
              </Text>
            ) : null}
          </View>
          {/* Savings or free-shipping cue — always renders so the
              QUICK ADD button below lands at the same Y on every card. */}
          <Text
            className="text-[10px] font-semibold mt-0.5"
            style={{
              color: hasDiscount ? C.sageDeep : C.textMuted,
            }}>
            {hasDiscount
              ? `Save ${formatINR(
                  product.compareAtPrice! - product.price!,
                )}`
              : 'Free shipping on this item'}
          </Text>
        </View>

        {/* Quick add — fixed 32pt slot, pushed to the bottom */}
        <View style={{marginTop: 'auto'}}>
          {showQuickAdd && !isOutOfStock ? (
            <TouchableOpacity
              className="rounded-full py-2 flex-row items-center justify-center"
              style={{
                backgroundColor: quickAddBg,
                height: 32,
              }}
              onPress={e => {
                e.stopPropagation?.();
                handleQuickAdd();
              }}
              disabled={addToCart.isPending}
              activeOpacity={0.85}>
              <ShoppingBag color="white" size={12} />
              <Text
                className="text-[11px] font-bold text-white ml-1.5"
                style={{letterSpacing: 0.3}}
                numberOfLines={1}>
                {quickAddLabel}
              </Text>
            </TouchableOpacity>
          ) : (
            // Empty slot keeps card heights even when CTA hidden.
            <View style={{height: 32}} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}
