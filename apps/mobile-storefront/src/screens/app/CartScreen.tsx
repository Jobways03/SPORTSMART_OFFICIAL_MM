import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowRight,
  CheckCircle2,
  Heart,
  Leaf,
  Lock,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Tag,
  Ticket,
  Trash2,
  Truck,
  X,
} from 'lucide-react-native';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useCart} from '../../queries/useCart';
import {useStorefrontConfig} from '../../queries/useStorefrontConfig';
import {
  useWishlistLookup,
  useAddToWishlist,
  useRemoveFromWishlist,
} from '../../queries/useWishlist';
import {cartService} from '../../services/cart.service';
import {checkoutService} from '../../services/checkout.service';
import type {PreviewedCoupon} from '../../services/checkout.service';
import {
  clearCouponPreview,
  getCouponPreview,
  setCouponPreview,
} from '../../lib/coupon-preview';
import {ApiError} from '../../lib/api-client';
import {queryKeys} from '../../queries/keys';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {CachedImage} from '../../components/CachedImage';
import {ConfirmModal} from '../../components/ConfirmModal';
import {Gradient} from '../../components/Gradient';
import {formatINR} from '../../lib/format';
import type {CartStackParamList, AppTabParamList} from '../../navigation/types';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';

type Nav = NativeStackNavigationProp<CartStackParamList, 'Cart'>;
type RootNav = BottomTabNavigationProp<AppTabParamList>;

// Warm premium palette mirrors HomeScreen / BrowseScreen / PDP.
const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceSage: '#f5f5f5',
  surfaceCoral: '#fee2e2',
  surfaceGold: '#fecaca',
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

export function CartScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const query = useCart();
  const config = useStorefrontConfig();
  const [promo, setPromo] = useState('');
  // Coupon preview. `appliedCoupon` drives the discount line + reduced
  // total; it survives a tab switch via AsyncStorage and is re-validated
  // (and re-sent) at checkout, so it's advisory until place-order.
  const [appliedCoupon, setAppliedCoupon] = useState<PreviewedCoupon | null>(
    null,
  );
  const [couponError, setCouponError] = useState('');
  const [couponApplying, setCouponApplying] = useState(false);
  // Item awaiting delete confirmation — drives the ConfirmModal.
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  // Re-hydrate a coupon the customer previewed earlier this session.
  useEffect(() => {
    getCouponPreview().then(c => {
      if (c) setAppliedCoupon(c);
    });
  }, []);

  const updateMutation = useMutation({
    mutationFn: ({itemId, quantity}: {itemId: string; quantity: number}) =>
      cartService.updateItem(itemId, quantity),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.cart()}),
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => cartService.removeItem(itemId),
    onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.cart()}),
  });

  // Wishlist (the heart on each line) — productId → wishlistItemId.
  const wishlistLookup = useWishlistLookup();
  const addToWishlist = useAddToWishlist();
  const removeFromWishlist = useRemoveFromWishlist();

  if (query.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <Spinner fullscreen />
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

  const cart = query.data;
  const items = cart?.items ?? [];

  if (items.length === 0) return <EmptyCartView />;

  const subtotal = cart?.totalAmount ?? 0;
  const shippingFee =
    subtotal >= config.freeShippingThreshold ? 0 : config.shippingFee;
  const discountAmount = appliedCoupon?.discountAmount ?? 0;
  // Mirrors the backend's authoritative charge: subtotal − discount +
  // shipping. GST is included in the price (not added on top), so it's
  // shown as an inclusive note below, never summed into the total.
  const total = Math.max(0, subtotal + shippingFee - discountAmount);
  // The cart-item DTO doesn't carry the compare-at price (it's a
  // product-level field), so we surface savings only when shipping is
  // free — keeps the "Saving ₹X" badge honest until a richer cart
  // response lands. Phase 11 audit deferred plumbing line-level
  // compare-at through.
  const savingsFromCompare = shippingFee === 0 ? config.shippingFee : 0;

  const awayFromFreeShipping = Math.max(
    0,
    config.freeShippingThreshold - subtotal,
  );
  const freeShippingPct = Math.min(1, subtotal / config.freeShippingThreshold);

  const applyCoupon = async () => {
    const code = promo.trim().toUpperCase();
    setCouponError('');
    if (!code) {
      setCouponError('Enter a coupon code');
      return;
    }
    setCouponApplying(true);
    try {
      const res = await checkoutService.validateCoupon(
        code,
        subtotal,
        items.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
        })),
      );
      if (!res.data) {
        setCouponError(res.message || 'Invalid coupon');
        return;
      }
      setAppliedCoupon(res.data);
      await setCouponPreview(res.data);
      setPromo('');
    } catch (err) {
      // 400 = invalid code, 429 = rate-limited (body.retryAfterSeconds).
      // Prefer the server's message so the customer sees the exact rule.
      const e = err as ApiError;
      if (e?.status === 429) {
        const retry = (e.body as {retryAfterSeconds?: number})
          ?.retryAfterSeconds;
        setCouponError(
          retry
            ? `Too many attempts. Try again in ${retry}s`
            : 'Too many coupon attempts. Please try again later.',
        );
      } else {
        setCouponError(e?.body?.message || e?.message || 'Invalid coupon');
      }
    } finally {
      setCouponApplying(false);
    }
  };

  const removeCoupon = async () => {
    setAppliedCoupon(null);
    setPromo('');
    setCouponError('');
    await clearCouponPreview();
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>      {/* ── Header ─────────────────────────────────────────────── */}
      <View
        className="px-5 pt-2 pb-4"
        style={{backgroundColor: C.surface}}>
        <View className="flex-row items-end justify-between">
          <View className="flex-1 flex-row items-start">
            {/* Accent bar — matches the rhythm of home + PDP titles. */}
            <View
              className="rounded-full mr-3 mt-2"
              style={{
                width: 3,
                height: 28,
                backgroundColor: C.sageDeep,
              }}
            />
            <View className="flex-1">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.sageDeep, letterSpacing: 2}}>
                YOUR BAG
              </Text>
              <Text
                className="font-black mt-0.5"
                style={{
                  color: C.ink,
                  fontSize: 26,
                  letterSpacing: -0.8,
                  lineHeight: 30,
                }}>
                {cart?.itemCount ?? 0}{' '}
                {cart?.itemCount === 1 ? 'item' : 'items'}
              </Text>
            </View>
          </View>
          {savingsFromCompare > 0 ? (
            <View
              className="rounded-full px-3 py-1.5 flex-row items-center"
              style={{backgroundColor: C.surfaceSage}}>
              <Tag color={C.sageDeep} size={11} />
              <Text
                className="text-[11px] font-bold ml-1"
                style={{color: C.sageDeep}}>
                Saving {formatINR(savingsFromCompare)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={{paddingBottom: 200}}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={C.sageDeep}
          />
        }
        ListHeaderComponent={
          <>
            {/* ── Free shipping progress strip ─────────────────────── */}
            <View className="px-5 pt-4">
              <View
                className="rounded-2xl p-4"
                style={{
                  backgroundColor:
                    awayFromFreeShipping === 0
                      ? C.surfaceSage
                      : C.surfaceGold,
                  shadowColor: C.ink,
                  shadowOpacity: 0.06,
                  shadowOffset: {width: 0, height: 3},
                  shadowRadius: 8,
                  elevation: 2,
                }}>
                <View className="flex-row items-center mb-2.5">
                  <View
                    className="w-7 h-7 rounded-full items-center justify-center mr-2.5"
                    style={{
                      backgroundColor:
                        awayFromFreeShipping === 0
                          ? C.sage
                          : 'rgba(255,255,255,0.7)',
                    }}>
                    <Truck
                      color={
                        awayFromFreeShipping === 0 ? 'white' : C.goldDeep
                      }
                      size={13}
                    />
                  </View>
                  <Text
                    className="text-xs font-bold flex-1"
                    style={{
                      color:
                        awayFromFreeShipping === 0
                          ? C.sageDeep
                          : C.goldDeep,
                      letterSpacing: -0.1,
                    }}>
                    {awayFromFreeShipping === 0
                      ? "You've unlocked free shipping"
                      : `${formatINR(awayFromFreeShipping)} away from free shipping`}
                  </Text>
                  {awayFromFreeShipping === 0 ? (
                    <CheckCircle2 color={C.sageDeep} size={14} />
                  ) : (
                    <Text
                      className="text-[11px] font-black"
                      style={{color: C.goldDeep, letterSpacing: 0.3}}>
                      {Math.round(freeShippingPct * 100)}%
                    </Text>
                  )}
                </View>
                {/* Gradient progress bar — colour matches the state
                    (sage when complete, gold→coral when in progress).
                    Wrapper masks the fill to the track shape. */}
                <View
                  className="h-2 rounded-full overflow-hidden"
                  style={{backgroundColor: 'rgba(0,0,0,0.06)'}}>
                  <View
                    style={{
                      width: `${freeShippingPct * 100}%`,
                      height: '100%',
                    }}>
                    <Gradient
                      colors={
                        awayFromFreeShipping === 0
                          ? [C.sage, C.sageDeep]
                          : [C.gold, C.coral]
                      }
                      angle={90}
                      borderRadius={4}
                      style={{width: '100%', height: '100%'}}
                    />
                  </View>
                </View>
              </View>
            </View>

            {/* ── Section divider ─────────────────────────────────── */}
            <View className="px-5 pt-5 pb-2">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                ITEMS IN YOUR BAG
              </Text>
            </View>
          </>
        }
        ItemSeparatorComponent={() => <View style={{height: 10}} />}
        renderItem={({item}) => (
          <View className="px-5">
            <View
              className="rounded-2xl p-3 flex-row"
              style={{backgroundColor: C.surface}}>
              {/* Image */}
              <View
                className="w-20 h-20 rounded-xl overflow-hidden mr-3"
                style={{backgroundColor: C.surfaceWarm}}>
                {item.imageUrl ? (
                  <CachedImage
                    source={{uri: item.imageUrl}}
                    className="w-full h-full"
                    resizeMode="cover"
                  />
                ) : (
                  <View className="w-full h-full items-center justify-center">
                    <Text style={{fontSize: 26, opacity: 0.3}}>📦</Text>
                  </View>
                )}
              </View>

              {/* Body */}
              <View className="flex-1">
                {/* Title */}
                <Text
                  className="text-sm font-bold mb-1"
                  style={{
                    color: C.ink,
                    letterSpacing: -0.2,
                    lineHeight: 18,
                  }}
                  numberOfLines={2}>
                  {item.productTitle}
                </Text>

                {/* Variant chip */}
                {item.variantTitle ? (
                  <View
                    className="self-start rounded-full px-2 py-0.5 mb-2"
                    style={{backgroundColor: C.surfaceWarm}}>
                    <Text
                      className="text-[10px] font-semibold"
                      style={{color: C.textSecondary}}>
                      {item.variantTitle}
                    </Text>
                  </View>
                ) : null}

                {/* Price line */}
                <View className="flex-row items-baseline mb-2">
                  <Text
                    className="text-base font-bold"
                    style={{color: C.ink, letterSpacing: -0.3}}>
                    {formatINR(item.unitPrice * item.quantity)}
                  </Text>
                  <Text
                    className="text-[10px] ml-2"
                    style={{color: C.textTertiary}}>
                    ({formatINR(item.unitPrice)} × {item.quantity})
                  </Text>
                </View>

                {/* Controls row */}
                <View className="flex-row items-center">
                  {/* Qty stepper */}
                  <View
                    className="flex-row items-center rounded-full"
                    style={{backgroundColor: C.surfaceWarm}}>
                    <TouchableOpacity
                      className="w-8 h-8 items-center justify-center"
                      disabled={
                        item.quantity <= 1 || updateMutation.isPending
                      }
                      onPress={() =>
                        updateMutation.mutate({
                          itemId: item.id,
                          quantity: item.quantity - 1,
                        })
                      }
                      activeOpacity={0.7}>
                      <Text
                        className="text-base font-bold"
                        style={{
                          color: item.quantity <= 1 ? C.textMuted : C.ink,
                        }}>
                        −
                      </Text>
                    </TouchableOpacity>
                    <Text
                      className="text-sm font-bold px-2"
                      style={{
                        color: C.ink,
                        minWidth: 24,
                        textAlign: 'center',
                      }}>
                      {item.quantity}
                    </Text>
                    <TouchableOpacity
                      className="w-8 h-8 items-center justify-center"
                      disabled={updateMutation.isPending}
                      onPress={() =>
                        updateMutation.mutate({
                          itemId: item.id,
                          quantity: item.quantity + 1,
                        })
                      }
                      activeOpacity={0.7}>
                      <Text
                        className="text-base font-bold"
                        style={{color: C.ink}}>
                        +
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View className="flex-1" />

                  {/* Save / Remove icons */}
                  <TouchableOpacity
                    className="w-8 h-8 items-center justify-center mr-1"
                    disabled={
                      addToWishlist.isPending || removeFromWishlist.isPending
                    }
                    onPress={() => {
                      const wid = wishlistLookup?.get(item.productId);
                      if (wid) {
                        removeFromWishlist.mutate(wid);
                      } else {
                        addToWishlist.mutate({
                          productId: item.productId,
                          variantId: item.variantId ?? undefined,
                        });
                      }
                    }}
                    activeOpacity={0.7}
                    accessibilityLabel={
                      wishlistLookup?.get(item.productId)
                        ? 'Remove from wishlist'
                        : 'Add to wishlist'
                    }>
                    <Heart
                      color={
                        wishlistLookup?.get(item.productId)
                          ? C.coralDeep
                          : C.textTertiary
                      }
                      fill={
                        wishlistLookup?.get(item.productId)
                          ? C.coralDeep
                          : 'transparent'
                      }
                      size={16}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="w-8 h-8 items-center justify-center"
                    disabled={removeMutation.isPending}
                    onPress={() =>
                      setPendingDelete({id: item.id, title: item.productTitle})
                    }
                    activeOpacity={0.7}>
                    <Trash2 color={C.sageDeep} size={16} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}
        ListFooterComponent={
          <View>
            {/* ── Promo code field ─────────────────────────────── */}
            <View className="px-5 pt-5">
              <View
                className="rounded-2xl p-4"
                style={{backgroundColor: C.surface}}>
                {appliedCoupon ? (
                  /* Applied state — show the saving + a remove control. */
                  <>
                    <View className="flex-row items-center mb-3">
                      <Ticket color={C.sageDeep} size={14} />
                      <Text
                        className="text-sm font-bold ml-2"
                        style={{color: C.ink, letterSpacing: -0.2}}>
                        Coupon applied
                      </Text>
                    </View>
                    <View
                      className="flex-row items-center justify-between rounded-xl px-3 py-2.5"
                      style={{
                        backgroundColor: C.surfaceSage,
                        borderWidth: 1,
                        borderColor: C.sage,
                      }}>
                      <View className="flex-row items-center flex-1">
                        <CheckCircle2 color={C.sageDeep} size={16} />
                        <View className="ml-2 flex-1">
                          <Text
                            className="text-sm font-bold"
                            style={{color: C.ink, letterSpacing: -0.2}}>
                            {appliedCoupon.code}
                          </Text>
                          <Text
                            className="text-[11px] font-semibold mt-0.5"
                            style={{color: C.sageDeep}}>
                            You save {formatINR(appliedCoupon.discountAmount)}
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={removeCoupon}
                        hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                        className="w-7 h-7 items-center justify-center rounded-full"
                        style={{backgroundColor: C.surface}}
                        accessibilityLabel="Remove coupon">
                        <X color={C.textTertiary} size={14} />
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <View className="flex-row items-center mb-3">
                      <Ticket color={C.coralDeep} size={14} />
                      <Text
                        className="text-sm font-bold ml-2"
                        style={{color: C.ink, letterSpacing: -0.2}}>
                        Have a promo code?
                      </Text>
                    </View>
                    <View className="flex-row" style={{gap: 8}}>
                      <View
                        className="flex-1 rounded-xl px-4 py-2 justify-center"
                        style={{backgroundColor: C.surfaceWarm, minHeight: 42}}>
                        <TextInput
                          className="text-sm"
                          style={{color: C.ink}}
                          placeholder="Enter code"
                          placeholderTextColor={C.textMuted}
                          value={promo}
                          onChangeText={t => {
                            setPromo(t);
                            if (couponError) setCouponError('');
                          }}
                          autoCapitalize="characters"
                          editable={!couponApplying}
                          onSubmitEditing={applyCoupon}
                          returnKeyType="done"
                        />
                      </View>
                      {/* Apply button: gradient + actionable when there's a
                          code, a spinner while validating, flat-disabled
                          when empty. */}
                      {couponApplying ? (
                        <View style={{borderRadius: 12, overflow: 'hidden'}}>
                          <Gradient
                            colors={[C.sageDeep, C.ink]}
                            angle={135}
                            borderRadius={12}>
                            <View
                              className="px-5 items-center justify-center"
                              style={{minHeight: 42}}>
                              <ActivityIndicator color="white" size="small" />
                            </View>
                          </Gradient>
                        </View>
                      ) : promo ? (
                        <View
                          style={{
                            borderRadius: 12,
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
                            borderRadius={12}>
                            <TouchableOpacity
                              className="px-5 items-center justify-center"
                              style={{minHeight: 42}}
                              onPress={applyCoupon}
                              activeOpacity={0.85}>
                              <Text
                                className="text-xs font-bold"
                                style={{color: 'white', letterSpacing: 0.5}}>
                                APPLY
                              </Text>
                            </TouchableOpacity>
                          </Gradient>
                        </View>
                      ) : (
                        <TouchableOpacity
                          className="rounded-xl px-5 items-center justify-center"
                          style={{
                            backgroundColor: C.surfaceWarm,
                            minHeight: 42,
                          }}
                          activeOpacity={1}
                          disabled>
                          <Text
                            className="text-xs font-bold"
                            style={{color: C.textMuted, letterSpacing: 0.5}}>
                            APPLY
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {couponError ? (
                      <Text
                        className="text-[11px] font-semibold mt-2 ml-1"
                        style={{color: C.sageDeep}}>
                        {couponError}
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            </View>

            {/* ── Price summary ─────────────────────────────────── */}
            <View className="px-5 pt-3">
              <View
                className="rounded-2xl p-4"
                style={{backgroundColor: C.surface}}>
                <Text
                  className="text-[10px] font-bold tracking-widest mb-3"
                  style={{color: C.textTertiary, letterSpacing: 1.8}}>
                  ORDER SUMMARY
                </Text>
                <PriceRow
                  label={`Subtotal (${cart?.itemCount} items)`}
                  value={formatINR(subtotal)}
                />
                {appliedCoupon && discountAmount > 0 ? (
                  <PriceRow
                    label={`Coupon · ${appliedCoupon.code}`}
                    value={`− ${formatINR(discountAmount)}`}
                    accent={C.sageDeep}
                  />
                ) : null}
                <PriceRow
                  label="Shipping"
                  value={
                    shippingFee === 0 ? 'FREE' : formatINR(shippingFee)
                  }
                  accent={shippingFee === 0 ? C.sageDeep : undefined}
                />
                <PriceRow label="GST" value="Included in price" />
                <View
                  className="my-3"
                  style={{height: 1, backgroundColor: C.border}}
                />
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text
                      className="text-sm font-bold"
                      style={{color: C.ink, letterSpacing: -0.2}}>
                      Total
                    </Text>
                    <Text
                      className="text-[10px] mt-0.5"
                      style={{color: C.textTertiary}}>
                      Inclusive of all taxes
                    </Text>
                  </View>
                  <Text
                    className="font-black"
                    style={{
                      color: C.ink,
                      fontSize: 22,
                      letterSpacing: -0.6,
                    }}>
                    {formatINR(total)}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Trust strip ───────────────────────────────────── */}
            <View className="px-5 pt-3">
              <View
                className="rounded-2xl p-4 flex-row justify-around"
                style={{backgroundColor: C.surface}}>
                {[
                  {Icon: ShieldCheck, label: 'Secure pay', sub: 'Razorpay'},
                  {Icon: RotateCcw, label: 'Easy returns', sub: '7 days'},
                  {Icon: Truck, label: 'Fast delivery', sub: '24 hrs'},
                ].map(t => (
                  <View key={t.label} className="items-center flex-1">
                    <View
                      className="w-9 h-9 rounded-full items-center justify-center mb-1.5"
                      style={{backgroundColor: C.surfaceSage}}>
                      <t.Icon color={C.sageDeep} size={15} />
                    </View>
                    <Text
                      className="text-[10px] font-bold"
                      style={{color: C.ink}}>
                      {t.label}
                    </Text>
                    <Text
                      className="text-[9px] mt-0.5"
                      style={{color: C.textTertiary}}>
                      {t.sub}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ── Sustainability note ───────────────────────────── */}
            <View className="px-5 pt-3">
              <View
                className="rounded-2xl p-3 flex-row items-center"
                style={{backgroundColor: C.surfaceSage}}>
                <Leaf color={C.sageDeep} size={14} />
                <Text
                  className="text-[11px] ml-2 flex-1"
                  style={{color: C.sageDeep, fontWeight: '600'}}>
                  Carbon-offset shipping · Recycled packaging
                </Text>
              </View>
            </View>
          </View>
        }
      />

      {/* ── Sticky bottom checkout bar ────────────────────────── */}
      <View
        className="absolute bottom-0 left-0 right-0 px-5 pt-4 pb-4"
        style={{
          backgroundColor: C.surface,
          borderTopWidth: 1,
          borderTopColor: C.border,
        }}>
        <View className="flex-row items-center mb-3">
          <View className="flex-1">
            <Text
              className="text-[10px] font-bold tracking-widest"
              style={{color: C.textTertiary, letterSpacing: 1.5}}>
              TOTAL
            </Text>
            <View className="flex-row items-baseline">
              <Text
                className="font-black"
                style={{
                  color: C.ink,
                  fontSize: 22,
                  letterSpacing: -0.6,
                }}>
                {formatINR(total)}
              </Text>
              {savingsFromCompare + discountAmount > 0 ? (
                <Text
                  className="text-[10px] ml-2 font-semibold"
                  style={{color: C.sageDeep}}>
                  Saved {formatINR(savingsFromCompare + discountAmount)}
                </Text>
              ) : null}
            </View>
          </View>
          <View
            className="flex-row items-center rounded-full px-2.5 py-1"
            style={{backgroundColor: C.surfaceWarm}}>
            <Lock color={C.textSecondary} size={10} />
            <Text
              className="text-[10px] font-semibold ml-1"
              style={{color: C.textSecondary}}>
              Secure
            </Text>
          </View>
        </View>
        {/* Premium gradient CTA — same blue→ink treatment as the PDP
            "Buy now" so the conversion path feels continuous. */}
        <View
          style={{
            borderRadius: 16,
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
            borderRadius={16}>
            <TouchableOpacity
              testID="cart-checkout"
              className="py-4 flex-row items-center justify-center"
              onPress={() => nav.navigate('Checkout')}
              activeOpacity={0.85}>
              <Text
                className="text-white font-bold text-sm mr-2"
                style={{letterSpacing: -0.2}}>
                Proceed to checkout
              </Text>
              <ArrowRight color="white" size={16} />
            </TouchableOpacity>
          </Gradient>
        </View>
      </View>

      <ConfirmModal
        visible={!!pendingDelete}
        title="Remove item?"
        message={pendingDelete?.title}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingDelete) removeMutation.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function PriceRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-xs" style={{color: C.textSecondary}}>
        {label}
      </Text>
      <Text
        className="text-xs font-semibold"
        style={{color: accent ?? C.ink}}>
        {value}
      </Text>
    </View>
  );
}

function EmptyCartView() {
  const tabNav = useNavigation<RootNav>();
  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <View
        className="px-5 pt-2 pb-4"
        style={{backgroundColor: C.surface}}>
        <Text
          className="text-[10px] font-bold tracking-widest"
          style={{color: C.sageDeep, letterSpacing: 2}}>
          YOUR BAG
        </Text>
        <Text
          className="font-black mt-0.5"
          style={{
            color: C.ink,
            fontSize: 26,
            letterSpacing: -0.8,
          }}>
          Empty
        </Text>
      </View>
      <View className="flex-1 px-6 items-center justify-center">
        <View
          className="w-24 h-24 rounded-full items-center justify-center mb-6"
          style={{backgroundColor: C.surfaceWarm}}>
          <ShoppingBag color={C.ink} size={36} />
        </View>
        <Text
          className="text-xl font-black mb-2"
          style={{color: C.ink, letterSpacing: -0.5}}>
          Your bag is empty
        </Text>
        <Text
          className="text-sm text-center mb-8 leading-5"
          style={{color: C.textSecondary, maxWidth: 280}}>
          Browse our collections and tap the bag icon to start filling it up.
        </Text>
        <TouchableOpacity
          className="rounded-full px-8 py-3.5 flex-row items-center"
          style={{backgroundColor: C.ink}}
          onPress={() => tabNav.navigate('BrowseTab', {screen: 'Browse'})}
          activeOpacity={0.85}>
          <Text className="text-sm font-bold text-white mr-2">
            Start shopping
          </Text>
          <ArrowRight color="white" size={15} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
