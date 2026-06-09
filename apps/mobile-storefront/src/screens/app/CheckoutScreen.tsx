import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Gradient} from '../../components/Gradient';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Edit3,
  Gift,
  Lock,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Truck,
  Wallet,
  Zap,
} from 'lucide-react-native';
import {
  useCheckoutInitiate,
  usePlaceOrder,
  useRemoveUnserviceable,
  useRetryPayment,
  useShippingQuote,
  useVerifyPayment,
} from '../../queries/useCheckout';
import {useAddresses} from '../../queries/useAddresses';
import {useProfile} from '../../queries/useProfile';
import {useWalletBalance} from '../../queries/useWallet';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {CachedImage} from '../../components/CachedImage';
import {showAlert} from '../../lib/dialog';
import {formatINR} from '../../lib/format';
import {newIdempotencyKey} from '../../lib/idempotency';
import {openRazorpayCheckout} from '../../lib/razorpay';
import {feeInRupees, ShippingOption} from '../../services/shipping.service';
import type {
  CheckoutData,
  PreviewedCoupon,
} from '../../services/checkout.service';
import {clearCouponPreview, getCouponPreview} from '../../lib/coupon-preview';
import {Events, track} from '../../lib/analytics';
import type {CartStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<CartStackParamList, 'Checkout'>;

// Warm premium palette mirrors HomeScreen / Cart / PDP.
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

const STEPS = ['Bag', 'Checkout', 'Payment', 'Done'];

export function CheckoutScreen() {
  const nav = useNavigation<Nav>();
  const addressesQuery = useAddresses();
  const profileQuery = useProfile();
  const walletQuery = useWalletBalance();
  const initiate = useCheckoutInitiate();
  const removeUnserviceable = useRemoveUnserviceable();
  const placeOrder = usePlaceOrder();
  const retryPayment = useRetryPayment();
  const verifyPayment = useVerifyPayment();

  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [selectedShippingId, setSelectedShippingId] = useState<string | null>(null);
  // Default to COD: online pay needs Razorpay keys (RAZORPAY_KEY_ID/SECRET),
  // which aren't configured in this environment — selecting it makes
  // place-order fail at the gateway and cancel the order. COD works
  // out of the box, so it's the safe default until Razorpay is wired up.
  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'COD'>('COD');
  const [error, setError] = useState<string | null>(null);
  const [payInProgress, setPayInProgress] = useState(false);
  // Coupon the customer previewed in the cart. Re-validated against this
  // checkout's serviceable subtotal (below) so a stale preview is dropped,
  // then re-sent to place-order where the backend applies it for real.
  const [appliedCoupon, setAppliedCoupon] = useState<PreviewedCoupon | null>(
    null,
  );
  // Opt-in to spend wallet balance on this order. Mirrors the web checkout's
  // "Use wallet balance" toggle; the server clamps the amount to
  // min(balance, order total) and debits it at place-order.
  const [walletApplied, setWalletApplied] = useState(false);

  const idemKeyRef = useRef<string>(newIdempotencyKey());
  const couponHydratedRef = useRef(false);

  const defaultAddress = useMemo(
    () =>
      (addressesQuery.data ?? []).find(a => a.isDefault) ??
      (addressesQuery.data ?? [])[0] ??
      null,
    [addressesQuery.data],
  );

  useEffect(() => {
    if (!defaultAddress) return;
    idemKeyRef.current = newIdempotencyKey();
    initiate.mutate(defaultAddress.id, {
      onSuccess: res => {
        if (res.data) {
          setCheckout(res.data);
          setError(null);
          track(Events.CheckoutInitiated, {
            itemCount: res.data.itemCount,
            total: res.data.serviceableAmount,
            allServiceable: res.data.allServiceable,
          });
        }
      },
      onError: err =>
        setError(err instanceof Error ? err.message : 'Could not start checkout'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAddress?.id]);

  const subtotalAfterUnserviceable = checkout?.serviceableAmount ?? 0;
  const subtotalPaise = Math.round(subtotalAfterUnserviceable * 100);
  const shippingQuery = useShippingQuote(subtotalPaise, !!checkout?.allServiceable);
  const shippingOptions = shippingQuery.data ?? [];

  useEffect(() => {
    if (shippingOptions.length === 0) {
      if (selectedShippingId !== null) setSelectedShippingId(null);
      return;
    }
    const stillValid = shippingOptions.some(o => o.optionId === selectedShippingId);
    if (!stillValid) {
      const cheapest = [...shippingOptions].sort(
        (a, b) => Number(a.feeInPaise) - Number(b.feeInPaise),
      )[0];
      setSelectedShippingId(cheapest?.optionId ?? null);
    }
  }, [shippingOptions, selectedShippingId]);

  // Pick up the coupon the customer previewed in the cart and reflect it
  // here. We trust the cart's validation for display — the backend
  // re-validates and applies it authoritatively at place-order, so the
  // worst case is a stale preview that the server corrects on the charge.
  useEffect(() => {
    if (!checkout || couponHydratedRef.current) return;
    couponHydratedRef.current = true;
    getCouponPreview().then(stored => {
      if (stored?.code) setAppliedCoupon(stored);
    });
  }, [checkout]);

  if (initiate.isPending && !checkout) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <Spinner fullscreen />
      </SafeAreaView>
    );
  }

  if (error || (!initiate.isPending && !checkout && defaultAddress)) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <ErrorState
          title="Couldn't start checkout"
          message={error ?? 'Try again from your cart.'}
          onRetry={() => {
            if (!defaultAddress) return;
            idemKeyRef.current = newIdempotencyKey();
            initiate.mutate(defaultAddress.id);
          }}
        />
      </SafeAreaView>
    );
  }

  // While addresses are still loading we don't yet know whether the
  // user has one — show the spinner instead of flashing the no-address
  // state (or, before this fix, a blank screen).
  if (addressesQuery.isLoading && !checkout) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <Spinner fullscreen />
      </SafeAreaView>
    );
  }

  // ── No-address empty state ─────────────────────────────────────
  // Must come BEFORE the `!checkout` bail below: checkout never
  // initiates without an address (see the effect above), so otherwise
  // this screen renders blank for customers with no saved address.
  if (!defaultAddress) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
        <CheckoutHeader nav={nav} />
        <View className="flex-1 items-center justify-center px-6">
          <View
            className="w-24 h-24 rounded-full items-center justify-center mb-6"
            style={{backgroundColor: C.surfaceWarm}}>
            <MapPin color={C.ink} size={36} />
          </View>
          <Text
            className="text-xl font-black mb-2"
            style={{color: C.ink, letterSpacing: -0.5}}>
            Add a shipping address
          </Text>
          <Text
            className="text-sm text-center mb-8 leading-5"
            style={{color: C.textSecondary, maxWidth: 280}}>
            You'll need somewhere for us to send the order before we can check out.
          </Text>
          <TouchableOpacity
            className="rounded-full px-8 py-3.5 flex-row items-center"
            style={{backgroundColor: C.ink}}
            onPress={() =>
              nav.getParent()?.navigate('AccountTab', {
                screen: 'AddressForm',
                params: {},
              })
            }
            activeOpacity={0.85}>
            <Text className="text-sm font-bold text-white mr-2">Add address</Text>
            <ArrowRight color="white" size={15} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Address exists but checkout hasn't resolved yet — transient (the
  // pending/error guards above normally cover it). Safe fallback so the
  // main render below never dereferences a null `checkout`.
  if (!checkout) return null;

  const selectedShipping = shippingOptions.find(
    o => o.optionId === selectedShippingId,
  ) ?? null;
  const shippingFee = selectedShipping ? feeInRupees(selectedShipping) : 0;
  const total = subtotalAfterUnserviceable + shippingFee;
  const discountAmount = appliedCoupon?.discountAmount ?? 0;
  // What the order costs before wallet — mirrors the backend's authoritative
  // charge: subtotal − discount + shipping. GST is included in the price
  // (not added on top) and COD carries no surcharge, so neither is added.
  const orderBeforeWallet = Math.max(0, total - discountAmount);
  // Wallet apply — clamp to (balance ∩ order), exactly like the server
  // (checkout.service: walletDebit = min(walletApplyAmountInPaise, chargedTotal)).
  const walletBalanceInPaise = walletQuery.data?.balanceInPaise ?? 0;
  const walletBalanceInRupees = walletBalanceInPaise / 100;
  const walletApplyAmount = walletApplied
    ? Math.min(walletBalanceInRupees, orderBeforeWallet)
    : 0;
  const walletApplyAmountInPaise = walletApplied
    ? Math.round(walletApplyAmount * 100)
    : 0;
  // What's left to collect via Razorpay/COD after wallet. 0 ⟹ the wallet
  // covers the whole order; the server marks it PAID and we skip the gateway.
  const payable = Math.max(0, orderBeforeWallet - walletApplyAmount);

  // Partial wallet + ONLINE is unsafe on the current backend: retryPayment
  // charges the FULL order total (not the wallet-reduced balance) and its
  // Razorpay handoff shape doesn't match this client — so a wallet-applied
  // ONLINE order would double-charge or strand unpaid. Until that server path
  // is fixed, when wallet leaves a balance we collect the remainder via COD
  // (the shipping mapper nets the wallet share out of the COD-at-door amount,
  // so there's no double collection). A FULL wallet order (payable === 0) is
  // safe on either method — the server marks it PAID with no gateway call.
  const onlineLockedByWallet = walletApplied && payable > 0;
  const effectivePaymentMethod: 'ONLINE' | 'COD' = onlineLockedByWallet
    ? 'COD'
    : paymentMethod;

  const onPay = async () => {
    if (!checkout.allServiceable) {
      showAlert(
        'Remove unserviceable items first',
        "Some items in your cart can't be shipped to your address.",
      );
      return;
    }
    if (subtotalAfterUnserviceable <= 0) {
      showAlert('Cart is empty', 'Add items before checkout.');
      return;
    }
    setPayInProgress(true);
    track(Events.PaymentStarted, {total, shippingFee});
    try {
      const placeRes = await placeOrder.mutateAsync({
        payload: {
          paymentMethod: effectivePaymentMethod,
          shippingOptionId: selectedShippingId,
          ...(appliedCoupon ? {couponCode: appliedCoupon.code} : {}),
          // Only send when applying — server skips wallet when 0/omitted.
          ...(walletApplyAmountInPaise > 0 ? {walletApplyAmountInPaise} : {}),
        },
        idempotencyKey: idemKeyRef.current,
      });
      const orderNumber = placeRes.data?.orderNumber;
      if (!orderNumber) {
        showAlert(
          'Order placed but no confirmation',
          'Check My Orders — your order may still have been created.',
        );
        return;
      }
      // Order exists now → the coupon (if any) has been consumed
      // server-side. Drop the cart-side preview so it can't bleed into a
      // future order, regardless of how payment resolves below.
      await clearCouponPreview();
      // Wallet covered the entire order (payable === 0). The backend marked it
      // PAID and skipped the gateway (for ONLINE: payment.fullyCoveredByWallet;
      // for COD: nothing left to collect). Land on the confirmed/paid screen —
      // NOT as COD, since there's no cash to collect on delivery.
      if (payable <= 0) {
        nav.replace('OrderConfirmation', {orderNumber, paid: true});
        return;
      }
      // COD doesn't go through Razorpay — the order is confirmed (pay the
      // remaining balance on delivery), so it lands on the confirmed screen as
      // a COD order, not the online "payment pending / finish payment" state.
      if (effectivePaymentMethod === 'COD') {
        nav.replace('OrderConfirmation', {orderNumber, paid: true, cod: true});
        return;
      }
      const retryRes = await retryPayment.mutateAsync(orderNumber);
      const handoff = retryRes.data;
      if (!handoff?.razorpayOrderId) {
        showAlert(
          'Payment session failed',
          retryRes.message || 'Open My Orders and tap Retry payment.',
        );
        nav.replace('OrderConfirmation', {orderNumber, paid: false});
        return;
      }
      const sheet = await openRazorpayCheckout({
        razorpayOrderId: handoff.razorpayOrderId,
        amountInPaise: handoff.amountInPaise,
        currency: handoff.currency,
        orderNumber,
        customerName: defaultAddress.fullName,
        customerPhone: defaultAddress.phone,
        customerEmail: profileQuery.data?.email ?? null,
      });
      if (sheet.status === 'success') {
        track(Events.PaymentSucceeded, {orderNumber, total});
        try {
          await verifyPayment.mutateAsync({
            razorpayOrderId: sheet.razorpayOrderId!,
            razorpayPaymentId: sheet.razorpayPaymentId!,
            razorpaySignature: sheet.razorpaySignature!,
          });
        } catch (err) {
          showAlert(
            'Payment recorded but not verified',
            err instanceof Error
              ? err.message
              : 'Our system will verify with Razorpay shortly. Check My Orders.',
          );
        }
        nav.replace('OrderConfirmation', {orderNumber, paid: true});
      } else if (sheet.status === 'dismissed') {
        track(Events.PaymentDismissed, {orderNumber});
        nav.replace('OrderConfirmation', {orderNumber, paid: false});
      } else {
        track(Events.PaymentFailed, {orderNumber, reason: sheet.error});
        showAlert('Payment failed', sheet.error ?? 'Try again.');
      }
    } catch (err) {
      idemKeyRef.current = newIdempotencyKey();
      showAlert(
        'Could not place order',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setPayInProgress(false);
    }
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <CheckoutHeader nav={nav} />
      <StepIndicator current={1} />

      <ScrollView
        contentContainerStyle={{paddingBottom: 160}}
        showsVerticalScrollIndicator={false}>
        {/* ── Address card ─────────────────────────────────────── */}
        <View className="px-5 pt-4">
          <View
            className="rounded-2xl p-4"
            style={{backgroundColor: C.surface}}>
            <View className="flex-row items-start">
              <View
                className="w-10 h-10 rounded-full items-center justify-center mr-3"
                style={{backgroundColor: C.surfaceSage}}>
                <MapPin color={C.sageDeep} size={17} />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center mb-1">
                  <Text
                    className="text-[10px] font-bold tracking-widest"
                    style={{color: C.textTertiary, letterSpacing: 1.8}}>
                    DELIVER TO
                  </Text>
                  {defaultAddress.isDefault ? (
                    <View
                      className="ml-2 rounded-full px-1.5 py-0.5"
                      style={{backgroundColor: C.surfaceGold}}>
                      <Text
                        className="text-[9px] font-bold"
                        style={{color: C.goldDeep, letterSpacing: 0.3}}>
                        DEFAULT
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  className="text-sm font-bold mb-0.5"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  {defaultAddress.fullName}
                </Text>
                <Text
                  className="text-xs leading-5"
                  style={{color: C.textSecondary}}>
                  {defaultAddress.addressLine1}
                  {defaultAddress.addressLine2
                    ? `, ${defaultAddress.addressLine2}`
                    : ''}
                  , {defaultAddress.city}, {defaultAddress.state}{' '}
                  {defaultAddress.postalCode}
                </Text>
                <Text
                  className="text-[11px] mt-1"
                  style={{color: C.textTertiary}}>
                  📞 {defaultAddress.phone}
                </Text>
              </View>
              <TouchableOpacity
                className="rounded-full px-3 py-1.5 flex-row items-center"
                style={{backgroundColor: C.surfaceWarm}}
                onPress={() =>
                  nav.getParent()?.navigate('AccountTab', {screen: 'Addresses'})
                }
                activeOpacity={0.7}>
                <Edit3 color={C.ink} size={11} />
                <Text
                  className="text-[11px] font-bold ml-1"
                  style={{color: C.ink}}>
                  Change
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Items section ─────────────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl"
            style={{backgroundColor: C.surface, overflow: 'hidden'}}>
            <View className="px-4 pt-4 pb-2 flex-row items-center justify-between">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                ITEMS · {checkout.itemCount}
              </Text>
            </View>
            {checkout.items.map((item, idx) => (
              <View
                key={item.cartItemId}
                className="px-4 py-3 flex-row"
                style={{
                  opacity: item.serviceable ? 1 : 0.55,
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderTopColor: C.border,
                }}>
                <View
                  className="w-14 h-14 rounded-xl overflow-hidden mr-3"
                  style={{backgroundColor: C.surfaceWarm}}>
                  {item.imageUrl ? (
                    <CachedImage
                      source={{uri: item.imageUrl}}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                  ) : (
                    <View className="w-full h-full items-center justify-center">
                      <Text style={{fontSize: 22, opacity: 0.3}}>📦</Text>
                    </View>
                  )}
                </View>
                <View className="flex-1">
                  <Text
                    className="text-xs font-bold"
                    style={{color: C.ink, letterSpacing: -0.1}}
                    numberOfLines={2}>
                    {item.productTitle}
                  </Text>
                  {item.variantTitle ? (
                    <Text
                      className="text-[10px] mt-0.5"
                      style={{color: C.textTertiary}}>
                      {item.variantTitle}
                    </Text>
                  ) : null}
                  <View className="flex-row items-center mt-1">
                    <Text
                      className="text-[11px] font-semibold"
                      style={{color: C.textSecondary}}>
                      Qty {item.quantity} · {formatINR(item.unitPrice)}
                    </Text>
                  </View>
                  {!item.serviceable ? (
                    <View className="flex-row items-center mt-1">
                      <AlertTriangle color={C.sageDeep} size={11} />
                      <Text
                        className="text-[10px] ml-1"
                        style={{color: C.sageDeep, fontWeight: '600'}}>
                        {item.unserviceableReason ?? 'Not deliverable'}
                      </Text>
                    </View>
                  ) : item.estimatedDeliveryDays ? (
                    <View className="flex-row items-center mt-1">
                      <Truck color={C.sageDeep} size={11} />
                      <Text
                        className="text-[10px] ml-1"
                        style={{color: C.sageDeep, fontWeight: '600'}}>
                        Delivers in ~{item.estimatedDeliveryDays} days
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  className="text-sm font-bold ml-2"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  {formatINR(item.lineTotal)}
                </Text>
              </View>
            ))}

            {!checkout.allServiceable ? (
              <TouchableOpacity
                className="m-4 mt-2 rounded-xl px-3 py-3 flex-row items-center"
                style={{backgroundColor: C.surfaceCoral}}
                disabled={removeUnserviceable.isPending}
                onPress={() => {
                  removeUnserviceable.mutate(undefined, {
                    onSuccess: res => {
                      if (res.data) setCheckout(res.data);
                    },
                    onError: err =>
                      showAlert(
                        'Could not remove',
                        err instanceof Error ? err.message : 'Try again.',
                      ),
                  });
                }}
                activeOpacity={0.85}>
                <AlertTriangle color={C.sageDeep} size={14} />
                <Text
                  className="text-xs ml-2 flex-1 font-semibold"
                  style={{color: C.sageDeep}}>
                  {checkout.unserviceableCount}{' '}
                  {checkout.unserviceableCount === 1 ? 'item is' : 'items are'}{' '}
                  not deliverable
                </Text>
                <Text
                  className="text-xs font-bold"
                  style={{color: C.coralDeep}}>
                  {removeUnserviceable.isPending ? 'Removing…' : 'REMOVE'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* ── Shipping options ───────────────────────────────────── */}
        {shippingOptions.length > 0 ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surface}}>
              <View className="flex-row items-center mb-3">
                <View
                  className="w-8 h-8 rounded-full items-center justify-center mr-2"
                  style={{backgroundColor: C.surfaceSage}}>
                  <Truck color={C.sageDeep} size={14} />
                </View>
                <Text
                  className="text-sm font-bold"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Shipping method
                </Text>
              </View>
              {shippingOptions.map(opt => {
                const selected = opt.optionId === selectedShippingId;
                const fee = feeInRupees(opt);
                const isFree = Number(opt.feeInPaise) === 0;
                return (
                  <TouchableOpacity
                    key={opt.optionId}
                    className="flex-row items-center rounded-xl px-3 py-3 mb-2"
                    style={{
                      backgroundColor: selected ? C.surfaceSage : C.surfaceWarm,
                      borderWidth: 1.5,
                      borderColor: selected ? C.sage : 'transparent',
                    }}
                    onPress={() => setSelectedShippingId(opt.optionId)}
                    activeOpacity={0.7}>
                    <View
                      className="w-5 h-5 rounded-full items-center justify-center mr-3"
                      style={{
                        borderWidth: 2,
                        borderColor: selected ? C.sageDeep : C.textMuted,
                        backgroundColor: selected ? C.sageDeep : 'transparent',
                      }}>
                      {selected ? <Check color="white" size={11} /> : null}
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-sm font-bold"
                        style={{
                          color: C.ink,
                          letterSpacing: -0.2,
                        }}>
                        {opt.optionName}
                      </Text>
                      {opt.description ? (
                        <Text
                          className="text-[11px] mt-0.5"
                          style={{color: C.textSecondary}}>
                          {opt.description}
                        </Text>
                      ) : opt.estimatedDays ? (
                        <Text
                          className="text-[11px] mt-0.5"
                          style={{color: C.textSecondary}}>
                          Arrives in ~{opt.estimatedDays} days
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      className="text-sm font-bold"
                      style={{
                        color: isFree ? C.sageDeep : C.ink,
                      }}>
                      {isFree ? 'FREE' : formatINR(fee)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ── Payment method ─────────────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl p-4"
            style={{backgroundColor: C.surface}}>
            <View className="flex-row items-center mb-3">
              <View
                className="w-8 h-8 rounded-full items-center justify-center mr-2"
                style={{backgroundColor: C.surfaceGold}}>
                <CreditCard color={C.goldDeep} size={14} />
              </View>
              <Text
                className="text-sm font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                Payment method
              </Text>
            </View>

            {/* ONLINE option — locked while wallet covers part of the order
                (see onlineLockedByWallet rationale above). */}
            <TouchableOpacity
              className="rounded-xl px-3 py-3 mb-2 flex-row items-center"
              style={{
                backgroundColor:
                  effectivePaymentMethod === 'ONLINE' ? C.surfaceGold : C.surfaceWarm,
                borderWidth: 1.5,
                borderColor:
                  effectivePaymentMethod === 'ONLINE' ? C.gold : 'transparent',
                opacity: onlineLockedByWallet ? 0.45 : 1,
              }}
              disabled={onlineLockedByWallet}
              onPress={() => setPaymentMethod('ONLINE')}
              activeOpacity={0.7}>
              <View
                className="w-5 h-5 rounded-full items-center justify-center mr-3"
                style={{
                  borderWidth: 2,
                  borderColor:
                    effectivePaymentMethod === 'ONLINE' ? C.goldDeep : C.textMuted,
                  backgroundColor:
                    effectivePaymentMethod === 'ONLINE' ? C.goldDeep : 'transparent',
                }}>
                {effectivePaymentMethod === 'ONLINE' ? (
                  <Check color="white" size={11} />
                ) : null}
              </View>
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text
                    className="text-sm font-bold"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    Pay online
                  </Text>
                  <View
                    className="ml-2 rounded-full px-1.5 py-0.5"
                    style={{backgroundColor: C.ink}}>
                    <Text
                      className="text-[9px] font-bold text-white"
                      style={{letterSpacing: 0.3}}>
                      RAZORPAY
                    </Text>
                  </View>
                </View>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{color: C.textSecondary}}>
                  {onlineLockedByWallet
                    ? 'Remove wallet to pay the full amount online'
                    : 'UPI · Cards · Wallets · Netbanking'}
                </Text>
              </View>
            </TouchableOpacity>

            {/* COD option */}
            <TouchableOpacity
              className="rounded-xl px-3 py-3 flex-row items-center"
              style={{
                backgroundColor:
                  effectivePaymentMethod === 'COD' ? C.surfaceGold : C.surfaceWarm,
                borderWidth: 1.5,
                borderColor: effectivePaymentMethod === 'COD' ? C.gold : 'transparent',
              }}
              onPress={() => setPaymentMethod('COD')}
              activeOpacity={0.7}>
              <View
                className="w-5 h-5 rounded-full items-center justify-center mr-3"
                style={{
                  borderWidth: 2,
                  borderColor:
                    effectivePaymentMethod === 'COD' ? C.goldDeep : C.textMuted,
                  backgroundColor:
                    effectivePaymentMethod === 'COD' ? C.goldDeep : 'transparent',
                }}>
                {effectivePaymentMethod === 'COD' ? (
                  <Check color="white" size={11} />
                ) : null}
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-bold"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Cash on delivery
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{color: C.textSecondary}}>
                  {walletApplied && walletApplyAmount > 0 && payable > 0
                    ? `Pay ${formatINR(payable)} balance when your order arrives`
                    : 'Pay when your order arrives'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Use wallet balance ────────────────────────────────── */}
        {walletBalanceInPaise > 0 ? (
          <View className="px-5 pt-3">
            <TouchableOpacity
              className="rounded-2xl p-4 flex-row items-center"
              style={{
                backgroundColor: C.surface,
                borderWidth: 1.5,
                borderColor: walletApplied ? C.sage : 'transparent',
              }}
              onPress={() => setWalletApplied(v => !v)}
              activeOpacity={0.8}>
              <View
                className="w-10 h-10 rounded-full items-center justify-center mr-3"
                style={{backgroundColor: C.surfaceSage}}>
                <Wallet color={C.sageDeep} size={17} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-bold"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Use wallet balance
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{color: C.textSecondary}}>
                  {walletApplied
                    ? `${formatINR(walletApplyAmount)} applied · ${formatINR(
                        walletBalanceInRupees,
                      )} available`
                    : `${formatINR(
                        walletBalanceInRupees,
                      )} available · pay any part from your wallet`}
                </Text>
              </View>
              <View
                className="w-6 h-6 rounded-md items-center justify-center"
                style={{
                  borderWidth: 2,
                  borderColor: walletApplied ? C.sageDeep : C.textMuted,
                  backgroundColor: walletApplied ? C.sageDeep : 'transparent',
                }}>
                {walletApplied ? <Check color="white" size={13} /> : null}
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Offer banner ──────────────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl p-3 flex-row items-center"
            style={{backgroundColor: C.surfaceCoral}}>
            <Gift color={C.coralDeep} size={14} />
            <Text
              className="text-[11px] ml-2 flex-1 font-semibold"
              style={{color: C.coralDeep}}>
              5% extra cashback with HDFC cards
            </Text>
            <Text
              className="text-[10px] font-bold"
              style={{color: C.coralDeep, letterSpacing: 0.3}}>
              KNOW MORE
            </Text>
          </View>
        </View>

        {/* ── Order summary ─────────────────────────────────────── */}
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
              label={`Subtotal (${checkout.itemCount} ${
                checkout.itemCount === 1 ? 'item' : 'items'
              })`}
              value={formatINR(subtotalAfterUnserviceable)}
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
              value={shippingFee === 0 ? 'FREE' : formatINR(shippingFee)}
              accent={shippingFee === 0 ? C.sageDeep : undefined}
            />
            <PriceRow label="GST" value="Included in price" />
            {walletApplied && walletApplyAmount > 0 ? (
              <PriceRow
                label="Wallet applied"
                value={`− ${formatINR(walletApplyAmount)}`}
                accent={C.sageDeep}
              />
            ) : null}
            <View
              className="my-3"
              style={{height: 1, backgroundColor: C.border}}
            />
            <View className="flex-row items-center justify-between">
              <View>
                <Text
                  className="text-sm font-bold"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Total payable
                </Text>
                <Text
                  className="text-[10px] mt-0.5"
                  style={{color: C.textTertiary}}>
                  All taxes included
                </Text>
              </View>
              <Text
                className="font-black"
                style={{color: C.ink, fontSize: 22, letterSpacing: -0.6}}>
                {formatINR(payable)}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Trust row ─────────────────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl px-4 py-4 flex-row justify-around"
            style={{backgroundColor: C.surface}}>
            {[
              {Icon: ShieldCheck, label: '100% secure', sub: 'SSL encrypted'},
              {Icon: RotateCcw, label: 'Easy returns', sub: '7 days'},
              {Icon: Zap, label: 'Fast delivery', sub: '24 hrs metros'},
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
      </ScrollView>

      {/* ── Sticky bottom pay bar ─────────────────────────────── */}
      <View
        className="absolute bottom-0 left-0 right-0 px-5 pt-4 pb-4"
        style={{
          backgroundColor: C.surface,
          borderTopWidth: 1,
          borderTopColor: C.border,
          shadowColor: C.ink,
          shadowOpacity: 0.08,
          shadowOffset: {width: 0, height: -6},
          shadowRadius: 16,
          elevation: 12,
        }}>
        <View className="flex-row items-center mb-3">
          <View className="flex-1">
            <Text
              className="text-[10px] font-bold tracking-widest"
              style={{color: C.textTertiary, letterSpacing: 1.5}}>
              TOTAL PAYABLE
            </Text>
            <Text
              className="font-black"
              style={{color: C.ink, fontSize: 22, letterSpacing: -0.6}}>
              {formatINR(payable)}
            </Text>
          </View>
          <View
            className="flex-row items-center rounded-full px-2.5 py-1"
            style={{backgroundColor: C.surfaceSage}}>
            <Lock color={C.sageDeep} size={10} />
            <Text
              className="text-[10px] font-bold ml-1"
              style={{color: C.sageDeep, letterSpacing: 0.3}}>
              SECURE
            </Text>
          </View>
        </View>
        {/* Premium gradient CTA — same blue→ink treatment as PDP
            "Buy now" and Cart "Proceed to checkout" so the conversion
            funnel feels like one continuous premium gesture. */}
        {payInProgress || !checkout.allServiceable ? (
          <TouchableOpacity
            className="rounded-2xl py-4 flex-row items-center justify-center"
            style={{backgroundColor: C.textMuted}}
            disabled
            activeOpacity={1}>
            {payInProgress ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold text-sm">
                Resolve serviceability to continue
              </Text>
            )}
          </TouchableOpacity>
        ) : (
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
                testID="checkout-place-order"
                className="py-4 flex-row items-center justify-center"
                onPress={onPay}
                activeOpacity={0.85}>
                <Text
                  className="text-white font-bold text-sm mr-2"
                  style={{letterSpacing: -0.2}}>
                  {payable <= 0
                    ? 'Place order · Paid by wallet'
                    : effectivePaymentMethod === 'COD'
                      ? 'Place order · COD'
                      : `Pay ${formatINR(payable)} now`}
                </Text>
                <ArrowRight color="white" size={16} />
              </TouchableOpacity>
            </Gradient>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function CheckoutHeader({nav}: {nav: Nav}) {
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
          style={{color: C.sageDeep, letterSpacing: 2}}>
          REVIEW & PAY
        </Text>
        <Text
          className="font-black"
          style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
          Checkout
        </Text>
      </View>
    </View>
  );
}

function StepIndicator({current}: {current: number}) {
  return (
    <View
      className="px-5 py-4 flex-row items-center"
      style={{backgroundColor: C.surface}}>
      {STEPS.map((label, idx) => {
        const isDone = idx < current;
        const isCurrent = idx === current;
        const isActive = isDone || isCurrent;
        return (
          <React.Fragment key={label}>
            <View className="items-center" style={{width: 44}}>
              {/* Step circle — gradient when active so the "you are
                  here" indicator pops without needing a label. */}
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  overflow: 'hidden',
                  shadowColor: isActive ? C.sageDeep : 'transparent',
                  shadowOpacity: isCurrent ? 0.35 : 0,
                  shadowOffset: {width: 0, height: 3},
                  shadowRadius: 6,
                  elevation: isCurrent ? 4 : 0,
                }}>
                {isActive ? (
                  <Gradient
                    colors={[C.sageDeep, C.ink]}
                    angle={135}
                    borderRadius={14}
                    style={{
                      width: '100%',
                      height: '100%',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    {isDone ? (
                      <Check color="white" size={14} strokeWidth={3} />
                    ) : (
                      <Text
                        className="text-[11px] font-black"
                        style={{color: 'white'}}>
                        {idx + 1}
                      </Text>
                    )}
                  </Gradient>
                ) : (
                  <View
                    style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: C.surfaceWarm,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: 14,
                    }}>
                    <Text
                      className="text-[11px] font-bold"
                      style={{color: C.textTertiary}}>
                      {idx + 1}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                className="text-[9px] font-black mt-1.5"
                style={{
                  color: isCurrent
                    ? C.ink
                    : isDone
                      ? C.sageDeep
                      : C.textMuted,
                  letterSpacing: 0.4,
                }}>
                {label.toUpperCase()}
              </Text>
            </View>
            {/* Connector line — gradient when the step before it has
                completed, flat border otherwise. Sits centred with
                the circles by offsetting up by the label height. */}
            {idx < STEPS.length - 1 ? (
              <View
                className="flex-1 mx-1"
                style={{
                  height: 2,
                  marginBottom: 16,
                  borderRadius: 1,
                  backgroundColor: idx < current ? 'transparent' : C.border,
                  overflow: 'hidden',
                }}>
                {idx < current ? (
                  <Gradient
                    colors={[C.sageDeep, C.ink]}
                    angle={90}
                    style={{width: '100%', height: '100%'}}
                  />
                ) : null}
              </View>
            ) : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

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
