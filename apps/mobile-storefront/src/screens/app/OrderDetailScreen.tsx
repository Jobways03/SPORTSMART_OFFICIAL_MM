import React from 'react';
import {
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {showAlert} from '../../lib/dialog';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp} from '@react-navigation/native';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  Headphones,
  MapPin,
  Package,
  RotateCcw,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react-native';
import {useCancelOrder, useOrder} from '../../queries/useOrders';
import {useRetryPayment, useVerifyPayment} from '../../queries/useCheckout';
import {useProfile} from '../../queries/useProfile';
import {Gradient} from '../../components/Gradient';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {ConfirmModal} from '../../components/ConfirmModal';
import {formatINR} from '../../lib/format';
import {
  canCancelOrder,
  orderStatusLabel,
  orderStatusTone,
} from '../../lib/orderStatus';
import {openRazorpayCheckout} from '../../lib/razorpay';
import {InvoiceList} from '../../components/InvoiceList';
import {CachedImage} from '../../components/CachedImage';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'OrderDetail'>;
type Route = RouteProp<AccountStackParamList, 'OrderDetail'>;

// Warm premium palette mirrors the rest of the app.
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

// Each tone gets a 2-stop gradient + accent + a "deep" colour for
// the eyebrow text. Dark gradients mean the hero card now has the
// same depth treatment as the HomeScreen + OrderConfirmation heroes.
function toneToHero(tone: ReturnType<typeof orderStatusTone>) {
  switch (tone) {
    case 'success':
      // Delivered / paid — confident blue gradient, sky-tinted glow.
      return {
        gradient: [C.ink, C.sageDeep] as const,
        accent: C.sage,
        deep: C.surfaceSage,
        glow: C.sage,
      };
    case 'warning':
      // In progress / awaiting — navy with indigo warmth.
      return {
        gradient: [C.ink, C.goldDeep] as const,
        accent: C.gold,
        deep: C.surfaceGold,
        glow: C.gold,
      };
    case 'danger':
      // Cancelled / failed — keep the warm coral signal but darker.
      return {
        gradient: ['#7c2d12', C.coralDeep] as const,
        accent: C.coral,
        deep: C.surfaceCoral,
        glow: C.coral,
      };
    default:
      // Info / pending — same navy as warning to avoid muddy palette
      return {
        gradient: [C.ink, C.goldDeep] as const,
        accent: C.gold,
        deep: C.surfaceGold,
        glow: C.gold,
      };
  }
}

function statusToStep(orderStatus: string): number {
  if (orderStatus === 'DELIVERED') return 4;
  if (orderStatus === 'SHIPPED') return 3;
  if (orderStatus === 'PROCESSING') return 2;
  if (orderStatus === 'CONFIRMED' || orderStatus === 'PENDING') return 1;
  return 0;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function estimatedDeliveryWindow(orderCreatedAt: string): string {
  try {
    const created = new Date(orderCreatedAt).getTime();
    const start = new Date(created + 3 * 24 * 60 * 60 * 1000);
    const end = new Date(created + 5 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) =>
      d.toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'});
    return `${fmt(start)} — ${fmt(end)}`;
  } catch {
    return '3–5 days';
  }
}

type TimelineStage = {
  key: string;
  label: string;
  time: string | null;
  state: 'done' | 'current' | 'pending';
};

// Maps each raw MasterOrder status onto a customer-facing milestone rank
// so the timeline can mark steps done / current / pending. Only two real
// timestamps exist (placed = createdAt, delivered = a sub-order's
// deliveredAt); intermediate steps show the milestone without a time.
const TIMELINE_STATUS_RANK: Record<string, number> = {
  PLACED: 0,
  PENDING_VERIFICATION: 0,
  VERIFIED: 1,
  ROUTED_TO_SELLER: 1,
  SELLER_ACCEPTED: 1,
  PACKED: 2,
  SHIPPED: 3,
  DISPATCHED: 3,
  DELIVERED: 4,
};

function buildOrderTimeline(order: {
  orderStatus: string;
  createdAt: string;
  subOrders: {deliveredAt: string | null}[];
}): TimelineStage[] {
  if (order.orderStatus === 'CANCELLED') {
    return [
      {key: 'placed', label: 'Order placed', time: order.createdAt, state: 'done'},
      {key: 'cancelled', label: 'Cancelled', time: null, state: 'current'},
    ];
  }
  const rank = TIMELINE_STATUS_RANK[order.orderStatus] ?? 0;
  const deliveredAt =
    order.subOrders.find(s => s.deliveredAt)?.deliveredAt ?? null;
  const defs = [
    {key: 'placed', label: 'Order placed', rank: 0, time: order.createdAt},
    {key: 'confirmed', label: 'Confirmed', rank: 1, time: null},
    {key: 'packed', label: 'Packed', rank: 2, time: null},
    {key: 'shipped', label: 'Shipped', rank: 3, time: null},
    {key: 'delivered', label: 'Delivered', rank: 4, time: deliveredAt},
  ];
  return defs.map(d => ({
    key: d.key,
    label: d.label,
    time: d.time,
    state: d.rank < rank ? 'done' : d.rank === rank ? 'current' : 'pending',
  }));
}

export function OrderDetailScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const query = useOrder(params.orderNumber);
  const cancelMutation = useCancelOrder();
  const retryMutation = useRetryPayment();
  const verifyMutation = useVerifyPayment();
  const profileQuery = useProfile();
  const [retrying, setRetrying] = React.useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);

  if (query.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <Spinner fullscreen />
      </SafeAreaView>
    );
  }
  if (query.isError || !query.data) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <ErrorState
          title="Couldn't load this order"
          onRetry={query.refetch}
        />
      </SafeAreaView>
    );
  }

  const order = query.data;
  const tone = orderStatusTone(order.orderStatus, order.paymentStatus);
  const hero = toneToHero(tone);
  const cancellable = canCancelOrder(order.orderStatus);
  const step = statusToStep(order.orderStatus);

  const canRetryPayment =
    order.paymentMethod !== 'COD' &&
    order.paymentStatus !== 'PAID' &&
    order.paymentStatus !== 'CANCELLED' &&
    order.orderStatus !== 'CANCELLED' &&
    order.orderStatus !== 'DELIVERED';

  const onRetryPayment = async () => {
    setRetrying(true);
    try {
      const retryRes = await retryMutation.mutateAsync(order.orderNumber);
      const handoff = retryRes.data;
      if (!handoff?.razorpayOrderId) {
        showAlert(
          'Payment session failed',
          retryRes.message || 'Try again in a moment.',
        );
        return;
      }
      const sheet = await openRazorpayCheckout({
        razorpayOrderId: handoff.razorpayOrderId,
        amountInPaise: handoff.amountInPaise,
        currency: handoff.currency,
        orderNumber: order.orderNumber,
        customerName: order.shippingAddressSnapshot?.fullName ?? null,
        customerPhone: order.shippingAddressSnapshot?.phone ?? null,
        customerEmail: profileQuery.data?.email ?? null,
      });
      if (sheet.status === 'success') {
        try {
          await verifyMutation.mutateAsync({
            razorpayOrderId: sheet.razorpayOrderId!,
            razorpayPaymentId: sheet.razorpayPaymentId!,
            razorpaySignature: sheet.razorpaySignature!,
          });
        } catch (err) {
          showAlert(
            'Payment recorded but not verified',
            err instanceof Error
              ? err.message
              : 'Our system will reconcile shortly.',
          );
        }
        query.refetch();
      } else if (sheet.status === 'error') {
        showAlert('Payment failed', sheet.error ?? 'Try again.');
      }
    } catch (err) {
      showAlert(
        'Could not start payment',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setRetrying(false);
    }
  };

  const onCancel = () => setShowCancelConfirm(true);

  const confirmCancel = () => {
    setShowCancelConfirm(false);
    cancelMutation.mutate(order.orderNumber, {
      onError: err =>
        setCancelError(err instanceof Error ? err.message : 'Try again.'),
    });
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
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
            ORDER DETAILS
          </Text>
          <Text
            className="font-black"
            style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}
            numberOfLines={1}>
            #{order.orderNumber}
          </Text>
        </View>
        <TouchableOpacity
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          onPress={() =>
            nav.navigate('CreateTicket', {
              relatedOrderNumber: order.orderNumber,
            })
          }
          activeOpacity={0.7}>
          <Headphones color={C.ink} size={17} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 32}}
        showsVerticalScrollIndicator={false}>
        {/* ── Status hero ─────────────────────────────────────── */}
        <View className="px-5 pt-4">
          <View
            style={{
              borderRadius: 24,
              overflow: 'hidden',
              shadowColor: hero.gradient[1],
              shadowOpacity: 0.24,
              shadowOffset: {width: 0, height: 10},
              shadowRadius: 16,
              elevation: 8,
            }}>
            <Gradient
              colors={[...hero.gradient]}
              angle={150}
              borderRadius={24}
              style={{minHeight: 160}}>
              <View
                className="absolute rounded-full"
                style={{
                  width: 240,
                  height: 240,
                  right: -70,
                  top: -80,
                  backgroundColor: hero.glow,
                  opacity: 0.22,
                }}
              />
              <View className="p-5">
                <View className="flex-row items-start">
                  <View
                    className="w-12 h-12 rounded-2xl items-center justify-center mr-3"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.16)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.25)',
                    }}>
                    {tone === 'success' ? (
                      <CheckCircle2 color="white" size={22} />
                    ) : tone === 'danger' ? (
                      <AlertCircle color="white" size={22} />
                    ) : (
                      <Package color="white" size={22} />
                    )}
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-[10px] font-bold tracking-widest mb-1"
                      style={{color: hero.deep, letterSpacing: 2}}>
                      STATUS
                    </Text>
                    <Text
                      className="font-black"
                      style={{
                        color: 'white',
                        fontSize: 22,
                        letterSpacing: -0.6,
                        lineHeight: 26,
                      }}>
                      {orderStatusLabel(
                        order.orderStatus,
                        order.paymentStatus,
                      )}
                    </Text>
                    <Text
                      className="text-xs mt-1"
                      style={{color: 'rgba(255,255,255,0.75)'}}>
                      Placed {formatDateTime(order.createdAt)}
                    </Text>
                  </View>
                </View>

                {/* Order # / Total / Items chips — frosted glass over
                    the gradient so they read crisply on the dark
                    surface but still feel like part of the card. */}
                <View
                  className="flex-row mt-5"
                  style={{gap: 8}}>
                  <View
                    className="flex-1 rounded-2xl px-3 py-2.5"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.18)',
                    }}>
                    <Text
                      className="text-[9px] font-bold tracking-widest"
                      style={{
                        color: 'rgba(255,255,255,0.65)',
                        letterSpacing: 1.5,
                      }}>
                      ORDER
                    </Text>
                    <View className="flex-row items-center mt-0.5">
                      <Text
                        className="text-xs font-bold flex-1"
                        style={{color: 'white', letterSpacing: -0.2}}
                        numberOfLines={1}>
                        #{order.orderNumber}
                      </Text>
                      <Copy
                        color="rgba(255,255,255,0.6)"
                        size={11}
                      />
                    </View>
                  </View>
                  <View
                    className="flex-1 rounded-2xl px-3 py-2.5"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.18)',
                    }}>
                    <Text
                      className="text-[9px] font-bold tracking-widest"
                      style={{
                        color: 'rgba(255,255,255,0.65)',
                        letterSpacing: 1.5,
                      }}>
                      TOTAL
                    </Text>
                    <Text
                      className="text-xs font-bold mt-0.5"
                      style={{color: 'white', letterSpacing: -0.2}}>
                      {formatINR(order.totalAmount)}
                    </Text>
                  </View>
                  <View
                    className="flex-1 rounded-2xl px-3 py-2.5"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.12)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.18)',
                    }}>
                    <Text
                      className="text-[9px] font-bold tracking-widest"
                      style={{
                        color: 'rgba(255,255,255,0.65)',
                        letterSpacing: 1.5,
                      }}>
                      ITEMS
                    </Text>
                    <Text
                      className="text-xs font-bold mt-0.5"
                      style={{color: 'white', letterSpacing: -0.2}}>
                      {order.itemCount}
                    </Text>
                  </View>
                </View>
              </View>
            </Gradient>
          </View>
        </View>

        {/* ── Live progress timeline ───────────────────────────── */}
        {step > 0 ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-5"
              style={{backgroundColor: C.surface}}>
              <View className="flex-row items-center justify-between mb-4">
                <Text
                  className="text-[10px] font-bold tracking-widest"
                  style={{color: C.textTertiary, letterSpacing: 1.8}}>
                  DELIVERY PROGRESS
                </Text>
                {step < 4 ? (
                  <Text
                    className="text-[10px] font-bold"
                    style={{color: C.sageDeep, letterSpacing: 0.3}}>
                    EST. {estimatedDeliveryWindow(order.createdAt).split(' — ')[0]}
                  </Text>
                ) : null}
              </View>

              {/* Horizontal timeline */}
              <View className="flex-row items-center mb-3">
                {[Package, CreditCard, Truck, Gift].map((Icon, idx) => {
                  const done = idx + 1 <= step;
                  const isLast = idx === 3;
                  return (
                    <React.Fragment key={idx}>
                      <View
                        className="w-9 h-9 rounded-full items-center justify-center"
                        style={{
                          backgroundColor: done ? C.ink : C.surfaceWarm,
                        }}>
                        <Icon
                          color={done ? 'white' : C.textTertiary}
                          size={14}
                        />
                      </View>
                      {!isLast ? (
                        <View
                          className="flex-1 mx-1"
                          style={{
                            height: 2,
                            backgroundColor:
                              idx + 1 < step ? C.ink : C.border,
                          }}
                        />
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </View>

              {/* Step labels */}
              <View className="flex-row">
                {['Confirmed', 'Packed', 'Shipped', 'Delivered'].map(
                  (label, idx) => {
                    const done = idx + 1 <= step;
                    return (
                      <View key={label} className="flex-1 items-center">
                        <Text
                          className="text-[10px] font-bold"
                          style={{
                            color: done ? C.ink : C.textMuted,
                          }}>
                          {label}
                        </Text>
                      </View>
                    );
                  },
                )}
              </View>
            </View>
          </View>
        ) : null}

        {/* ── Estimated delivery card (only when not delivered) ─── */}
        {order.orderStatus !== 'DELIVERED' && order.orderStatus !== 'CANCELLED' ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-4 flex-row items-center"
              style={{backgroundColor: C.surfaceGold}}>
              <View
                className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                style={{backgroundColor: C.gold}}>
                <Truck color="white" size={20} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] font-bold tracking-widest"
                  style={{color: C.goldDeep, letterSpacing: 1.5}}>
                  ESTIMATED DELIVERY
                </Text>
                <Text
                  className="text-sm font-bold mt-0.5"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  {estimatedDeliveryWindow(order.createdAt)}
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{color: C.inkSoft}}>
                  Tracking link arrives by email when shipped
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* ── Retry payment CTA (pending payments) ──────────────── */}
        {canRetryPayment ? (
          <View className="px-5 pt-3">
            <View
              style={{
                borderRadius: 16,
                overflow: 'hidden',
                shadowColor: C.sageDeep,
                shadowOpacity: 0.28,
                shadowOffset: {width: 0, height: 6},
                shadowRadius: 12,
                elevation: 6,
              }}>
              <Gradient
                colors={[C.sageDeep, C.ink]}
                angle={135}
                borderRadius={16}>
                <TouchableOpacity
                  className="p-4 flex-row items-center"
                  onPress={onRetryPayment}
                  disabled={retrying}
                  activeOpacity={0.85}>
                  <View
                    className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.16)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.25)',
                    }}>
                    <CreditCard color="white" size={20} />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-[10px] font-bold tracking-widest"
                      style={{
                        color: 'rgba(255,255,255,0.7)',
                        letterSpacing: 1.8,
                      }}>
                      ACTION NEEDED
                    </Text>
                    <Text
                      className="text-sm font-bold text-white mt-0.5"
                      style={{letterSpacing: -0.2}}>
                      {retrying ? 'Opening payment…' : 'Retry payment'}
                    </Text>
                    <Text
                      className="text-[11px] mt-0.5"
                      style={{color: 'rgba(255,255,255,0.7)'}}>
                      Complete payment to confirm your order
                    </Text>
                  </View>
                  <ChevronLeft
                    color="white"
                    size={18}
                    style={{transform: [{rotate: '180deg'}]}}
                  />
                </TouchableOpacity>
              </Gradient>
            </View>
          </View>
        ) : null}

        {/* ── Shipping address ─────────────────────────────────── */}
        {order.shippingAddressSnapshot ? (
          <View className="px-5 pt-3">
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
                  <Text
                    className="text-[10px] font-bold tracking-widest"
                    style={{color: C.textTertiary, letterSpacing: 1.8}}>
                    DELIVER TO
                  </Text>
                  <Text
                    className="text-sm font-bold mt-0.5 mb-0.5"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    {order.shippingAddressSnapshot.fullName}
                  </Text>
                  <Text
                    className="text-xs leading-5"
                    style={{color: C.textSecondary}}>
                    {order.shippingAddressSnapshot.addressLine1}
                    {order.shippingAddressSnapshot.addressLine2
                      ? `, ${order.shippingAddressSnapshot.addressLine2}`
                      : ''}
                    , {order.shippingAddressSnapshot.city},{' '}
                    {order.shippingAddressSnapshot.state}{' '}
                    {order.shippingAddressSnapshot.postalCode}
                  </Text>
                  <Text
                    className="text-[11px] mt-1"
                    style={{color: C.textTertiary}}>
                    📞 {order.shippingAddressSnapshot.phone}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* ── Order timeline ───────────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl p-4"
            style={{backgroundColor: C.surface}}>
            <View className="flex-row items-center mb-4">
              <View
                className="w-10 h-10 rounded-full items-center justify-center mr-3"
                style={{backgroundColor: C.surfaceSage}}>
                <Package color={C.sageDeep} size={17} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] font-bold tracking-widest"
                  style={{color: C.textTertiary, letterSpacing: 1.8}}>
                  ORDER TIMELINE
                </Text>
                <Text
                  className="text-sm font-bold mt-0.5"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  {orderStatusLabel(order.orderStatus, order.paymentStatus)}
                </Text>
              </View>
            </View>
            {buildOrderTimeline(order).map((stage, i, arr) => {
              const isLast = i === arr.length - 1;
              const done = stage.state === 'done';
              const current = stage.state === 'current';
              const reached = done || current;
              const cancelled = stage.key === 'cancelled';
              const accent = cancelled ? C.coralDeep : C.sageDeep;
              return (
                <View key={stage.key} className="flex-row">
                  {/* Rail — dot + connecting line down to the next dot */}
                  <View className="items-center mr-3" style={{width: 22}}>
                    <View
                      style={{
                        width: current ? 14 : 12,
                        height: current ? 14 : 12,
                        borderRadius: 999,
                        marginTop: 2,
                        backgroundColor: reached ? accent : C.surface,
                        borderWidth: reached ? 0 : 2,
                        borderColor: C.border,
                      }}
                    />
                    {!isLast ? (
                      <View
                        style={{
                          flex: 1,
                          width: 2,
                          marginVertical: 2,
                          backgroundColor: done ? C.sageDeep : C.border,
                        }}
                      />
                    ) : null}
                  </View>
                  {/* Content */}
                  <View
                    className="flex-1"
                    style={{paddingBottom: isLast ? 0 : 18}}>
                    <Text
                      className="text-sm"
                      style={{
                        color: reached
                          ? cancelled
                            ? C.coralDeep
                            : C.ink
                          : C.textTertiary,
                        fontWeight: current ? '800' : reached ? '600' : '500',
                        letterSpacing: -0.2,
                      }}>
                      {stage.label}
                    </Text>
                    {stage.time ? (
                      <Text
                        className="text-[11px] mt-0.5"
                        style={{color: C.textTertiary}}>
                        {formatDateTime(stage.time)}
                      </Text>
                    ) : current ? (
                      <Text
                        className="text-[11px] mt-0.5"
                        style={{color: accent, fontWeight: '600'}}>
                        {cancelled ? 'Order was cancelled' : 'In progress'}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Sub-orders / shipments ───────────────────────────── */}
        {order.subOrders.map((sub, idx) => (
          <View key={sub.id} className="px-5 pt-3">
            <View
              className="rounded-2xl overflow-hidden"
              style={{backgroundColor: C.surface}}>
              <View
                className="px-4 py-3 flex-row items-center justify-between"
                style={{backgroundColor: C.surfaceWarm}}>
                <View className="flex-row items-center">
                  <Package color={C.ink} size={14} />
                  <Text
                    className="text-xs font-bold ml-2"
                    style={{color: C.ink, letterSpacing: -0.1}}>
                    Shipment {idx + 1} of {order.subOrders.length}
                  </Text>
                </View>
                <View
                  className="rounded-full px-2.5 py-1"
                  style={{backgroundColor: C.surface}}>
                  <Text
                    className="text-[10px] font-bold"
                    style={{color: C.sageDeep, letterSpacing: 0.3}}>
                    {sub.fulfillmentStatus}
                  </Text>
                </View>
              </View>

              <View className="px-4 pt-3 pb-4">
                {sub.items.map((item, itemIdx) => (
                  <View
                    key={item.id}
                    className="flex-row py-2"
                    style={
                      itemIdx > 0
                        ? {borderTopWidth: 1, borderTopColor: C.border}
                        : undefined
                    }>
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
                      <Text
                        className="text-[11px] mt-0.5 font-semibold"
                        style={{color: C.textSecondary}}>
                        Qty {item.quantity} · {formatINR(item.unitPrice)}
                      </Text>
                    </View>
                    <Text
                      className="text-sm font-bold ml-2"
                      style={{color: C.ink, letterSpacing: -0.2}}>
                      {formatINR(item.totalPrice)}
                    </Text>
                  </View>
                ))}

                {sub.ithinkTrackingUrl ? (
                  <TouchableOpacity
                    className="mt-3 rounded-xl px-3 py-3 flex-row items-center"
                    style={{backgroundColor: C.surfaceSage}}
                    onPress={() => Linking.openURL(sub.ithinkTrackingUrl!)}
                    activeOpacity={0.7}>
                    <Truck color={C.sageDeep} size={14} />
                    <View className="ml-2 flex-1">
                      <Text
                        className="text-xs font-bold"
                        style={{color: C.sageDeep, letterSpacing: -0.1}}>
                        Track shipment
                      </Text>
                      {sub.ithinkLogistic ? (
                        <Text
                          className="text-[10px] mt-0.5"
                          style={{color: C.sageDeep}}>
                          via {sub.ithinkLogistic}
                        </Text>
                      ) : null}
                    </View>
                    <ExternalLink color={C.sageDeep} size={13} />
                  </TouchableOpacity>
                ) : sub.trackingNumber ? (
                  <View
                    className="mt-3 rounded-xl px-3 py-3"
                    style={{backgroundColor: C.surfaceWarm}}>
                    <Text
                      className="text-[10px] font-bold tracking-widest"
                      style={{color: C.textTertiary, letterSpacing: 1.5}}>
                      TRACKING
                    </Text>
                    <Text
                      className="text-xs font-bold mt-0.5"
                      style={{color: C.ink}}>
                      {sub.courierName ?? 'Courier'} · {sub.trackingNumber}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        ))}

        {/* ── Payment summary ──────────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl p-4"
            style={{backgroundColor: C.surface}}>
            <Text
              className="text-[10px] font-bold tracking-widest mb-3"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              PAYMENT SUMMARY
            </Text>
            {(() => {
              // OrderDetail only carries totalAmount + optional shipping
              // breakdown + applied discount. Subtotal is derived by
              // subtracting shipping (taxes are baked into the line
              // items per Indian GST inclusive-pricing convention).
              const shippingFee = order.shipping
                ? Number(order.shipping.feeInRupees)
                : 0;
              const discountAmount = order.appliedDiscount
                ? Number(order.appliedDiscount.discountAmount)
                : 0;
              const subtotal =
                order.totalAmount - shippingFee + discountAmount;
              return (
                <>
                  <PriceRow
                    label={`Subtotal (${order.itemCount} ${
                      order.itemCount === 1 ? 'item' : 'items'
                    })`}
                    value={formatINR(subtotal)}
                  />
                  {discountAmount > 0 ? (
                    <PriceRow
                      label={`Discount${
                        order.appliedDiscount?.code
                          ? ` (${order.appliedDiscount.code})`
                          : ''
                      }`}
                      value={`− ${formatINR(discountAmount)}`}
                      accent={C.sageDeep}
                    />
                  ) : null}
                  <PriceRow
                    label={
                      order.shipping?.optionName
                        ? `Shipping (${order.shipping.optionName})`
                        : 'Shipping'
                    }
                    value={
                      shippingFee === 0 ? 'FREE' : formatINR(shippingFee)
                    }
                    accent={shippingFee === 0 ? C.sageDeep : undefined}
                  />
                </>
              );
            })()}
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
                  Paid via {order.paymentMethod} · Tax included
                </Text>
              </View>
              <Text
                className="font-black"
                style={{color: C.ink, fontSize: 22, letterSpacing: -0.6}}>
                {formatINR(order.totalAmount)}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Invoices ─────────────────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl p-4"
            style={{backgroundColor: C.surface}}>
            <InvoiceList orderId={order.id} />
          </View>
        </View>

        {/* ── Actions ─────────────────────────────────────────── */}
        <View className="px-5 pt-3" style={{gap: 10}}>
          {order.orderStatus === 'DELIVERED' ? (
            <View
              style={{
                borderRadius: 16,
                overflow: 'hidden',
                shadowColor: C.sageDeep,
                shadowOpacity: 0.28,
                shadowOffset: {width: 0, height: 4},
                shadowRadius: 10,
                elevation: 5,
              }}>
              <Gradient
                colors={[C.sageDeep, C.ink]}
                angle={135}
                borderRadius={16}>
                <TouchableOpacity
                  className="py-3.5 flex-row items-center justify-center"
                  onPress={() =>
                    nav.navigate('CreateReturn', {
                      masterOrderId: order.id,
                    })
                  }
                  activeOpacity={0.85}>
                  <RotateCcw color="white" size={16} />
                  <Text
                    className="text-sm font-bold text-white ml-2"
                    style={{letterSpacing: -0.2}}>
                    Start a return
                  </Text>
                </TouchableOpacity>
              </Gradient>
            </View>
          ) : null}

          <TouchableOpacity
            className="rounded-2xl py-3.5 flex-row items-center justify-center"
            style={{
              backgroundColor: C.surface,
              borderWidth: 1,
              borderColor: C.border,
            }}
            onPress={() =>
              nav.navigate('CreateTicket', {
                relatedOrderNumber: order.orderNumber,
              })
            }
            activeOpacity={0.85}>
            <Headphones color={C.ink} size={16} />
            <Text
              className="text-sm font-bold ml-2"
              style={{color: C.ink}}>
              Need help with this order?
            </Text>
          </TouchableOpacity>

          {cancellable ? (
            <TouchableOpacity
              className="rounded-2xl py-3.5 flex-row items-center justify-center"
              style={{
                backgroundColor: C.surfaceCoral,
                opacity: cancelMutation.isPending ? 0.5 : 1,
              }}
              onPress={onCancel}
              disabled={cancelMutation.isPending}
              activeOpacity={0.85}>
              <X color={C.coralDeep} size={16} />
              <Text
                className="text-sm font-bold ml-2"
                style={{color: C.coralDeep}}>
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel order'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Trust footer ────────────────────────────────────── */}
        <View className="px-5 pt-5">
          <View
            className="rounded-2xl px-4 py-4 flex-row justify-around"
            style={{backgroundColor: C.surface}}>
            {[
              {Icon: ShieldCheck, label: 'Secure pay'},
              {Icon: RotateCcw, label: '7-day returns'},
              {Icon: Truck, label: 'Fast delivery'},
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
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={showCancelConfirm}
        title="Cancel this order?"
        message="Refunds are processed back to your original payment method."
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        destructive
        onConfirm={confirmCancel}
        onCancel={() => setShowCancelConfirm(false)}
      />
      <ConfirmModal
        visible={!!cancelError}
        title="Could not cancel"
        message={cancelError ?? undefined}
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setCancelError(null)}
        onCancel={() => setCancelError(null)}
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
