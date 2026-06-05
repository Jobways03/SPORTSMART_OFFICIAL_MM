import React from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {showAlert} from '../../lib/dialog';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gradient} from '../../components/Gradient';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp} from '@react-navigation/native';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Headphones,
  Info,
  Package,
  RotateCcw,
  Truck,
  Wallet,
  X,
  XCircle,
} from 'lucide-react-native';
import {
  useCancelReturn,
  useMarkReturnHandedOver,
  useReturnDetail,
} from '../../queries/useReturns';
import {getReturnStatusLabel} from '../../services/returns.service';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {CachedImage} from '../../components/CachedImage';
import {formatINR} from '../../lib/format';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'ReturnDetail'>;
type Route = RouteProp<AccountStackParamList, 'ReturnDetail'>;

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

const REASON_LABELS: Record<string, string> = {
  DEFECTIVE: 'Defective product',
  WRONG_ITEM: 'Wrong item received',
  NOT_AS_DESCRIBED: 'Not as described',
  DAMAGED_IN_TRANSIT: 'Damaged in transit',
  CHANGED_MIND: 'Changed mind',
  SIZE_FIT_ISSUE: 'Size / fit issue',
  QUALITY_ISSUE: 'Quality issue',
  OTHER: 'Other',
};

const CANCELLABLE = new Set(['REQUESTED', 'APPROVED', 'PICKUP_SCHEDULED']);

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' {
  const s = status.toUpperCase();
  if (s === 'REFUNDED' || s === 'COMPLETED') return 'success';
  if (s === 'REJECTED' || s === 'CANCELLED') return 'danger';
  if (s === 'RECEIVED' || s === 'PICKED_UP') return 'info';
  return 'warning'; // REQUESTED / APPROVED / PICKUP_SCHEDULED
}

// Each tone maps to a dark gradient + accent + eyebrow color, mirroring
// the OrderDetail hero recipe. Success = confident blue gradient, warning
// = navy with indigo, danger = dark coral, info = navy + indigo.
function toneToHero(tone: ReturnType<typeof statusTone>) {
  switch (tone) {
    case 'success':
      return {
        gradient: [C.ink, C.sageDeep] as const,
        accent: C.sage,
        deep: C.surfaceSage,
        glow: C.sage,
      };
    case 'warning':
      return {
        gradient: [C.ink, C.goldDeep] as const,
        accent: C.gold,
        deep: C.surfaceGold,
        glow: C.gold,
      };
    case 'danger':
      return {
        gradient: ['#7c2d12', C.coralDeep] as const,
        accent: C.coral,
        deep: C.surfaceCoral,
        glow: C.coral,
      };
    case 'info':
    default:
      return {
        gradient: [C.ink, C.goldDeep] as const,
        accent: C.gold,
        deep: C.surfaceGold,
        glow: C.gold,
      };
  }
}

function statusStep(status: string): number {
  const s = status.toUpperCase();
  if (s === 'REFUNDED' || s === 'COMPLETED') return 4;
  if (s === 'RECEIVED') return 3;
  if (s === 'PICKED_UP') return 2;
  if (s === 'APPROVED' || s === 'PICKUP_SCHEDULED' || s === 'REQUESTED') return 1;
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

export function ReturnDetailScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const query = useReturnDetail(params.returnId);
  const cancelMutation = useCancelReturn();
  const handedOverMutation = useMarkReturnHandedOver();

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
          title="Couldn't load this return"
          onRetry={query.refetch}
        />
      </SafeAreaView>
    );
  }

  const ret = query.data;
  const tone = statusTone(ret.status);
  const hero = toneToHero(tone);
  const step = statusStep(ret.status);
  const cancellable = CANCELLABLE.has(ret.status);
  const isInProgress = step > 0 && step < 4;
  const isRejected = ret.status === 'REJECTED' || ret.status === 'CANCELLED';

  const onCancel = () => {
    showAlert(
      'Cancel this return?',
      'You can request the return again later if it is still within the return window.',
      [
        {text: 'Keep return', style: 'cancel'},
        {
          text: 'Cancel return',
          style: 'destructive',
          onPress: () => {
            cancelMutation.mutate(ret.id, {
              onError: err =>
                showAlert(
                  'Could not cancel',
                  err instanceof Error ? err.message : 'Try again.',
                ),
            });
          },
        },
      ],
    );
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
            RETURN DETAILS
          </Text>
          <Text
            className="font-black"
            style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}
            numberOfLines={1}>
            #{ret.returnNumber}
          </Text>
        </View>
        <TouchableOpacity
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          onPress={() =>
            nav.navigate('CreateTicket', {
              relatedReturnNumber: ret.returnNumber,
            })
          }
          activeOpacity={0.7}>
          <Headphones color={C.ink} size={17} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 32}}
        showsVerticalScrollIndicator={false}>
        {/* ── Status hero — dark gradient mirrors OrderDetail ── */}
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
              style={{minHeight: 200}}>
              <View
                className="absolute rounded-full"
                style={{
                  width: 260,
                  height: 260,
                  right: -80,
                  top: -90,
                  backgroundColor: hero.glow,
                  opacity: 0.24,
                }}
              />
              <View className="p-5">
                <View className="flex-row items-start mb-3">
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
                      <XCircle color="white" size={22} />
                    ) : (
                      <RotateCcw color="white" size={22} />
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
                      {getReturnStatusLabel(ret.status)}
                    </Text>
                    {ret.masterOrder?.orderNumber ? (
                      <Text
                        className="text-xs mt-1"
                        style={{color: 'rgba(255,255,255,0.78)'}}>
                        For order #{ret.masterOrder.orderNumber}
                      </Text>
                    ) : null}
                    <Text
                      className="text-[11px] mt-0.5"
                      style={{color: 'rgba(255,255,255,0.65)'}}>
                      Started {formatDateTime(ret.createdAt)}
                    </Text>
                  </View>
                </View>

                {/* Return # / items / refund chips — frosted glass */}
                <View className="flex-row mt-3" style={{gap: 8}}>
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
                      RETURN
                    </Text>
                    <View className="flex-row items-center mt-0.5">
                      <Text
                        className="text-xs font-bold flex-1"
                        style={{color: 'white', letterSpacing: -0.2}}
                        numberOfLines={1}>
                        #{ret.returnNumber}
                      </Text>
                      <Copy color="rgba(255,255,255,0.6)" size={11} />
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
                      ITEMS
                    </Text>
                    <Text
                      className="text-xs font-bold mt-0.5"
                      style={{color: 'white', letterSpacing: -0.2}}>
                      {ret.items.length}
                    </Text>
                  </View>
                  {ret.refundAmount != null ? (
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
                        REFUND
                      </Text>
                      <Text
                        className="text-xs font-bold mt-0.5"
                        style={{color: 'white', letterSpacing: -0.2}}>
                        {formatINR(Number(ret.refundAmount))}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Gradient>
          </View>
        </View>

        {/* ── Rejection reason callout ──────────────────────────── */}
        {ret.rejectionReason ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-4 flex-row items-start"
              style={{backgroundColor: C.surfaceCoral}}>
              <AlertCircle color={C.sageDeep} size={16} style={{marginTop: 2}} />
              <View className="flex-1 ml-2">
                <Text
                  className="text-[10px] font-bold tracking-widest mb-1"
                  style={{color: C.sageDeep, letterSpacing: 1.5}}>
                  REASON FOR REJECTION
                </Text>
                <Text
                  className="text-sm leading-5"
                  style={{color: C.ink}}>
                  {ret.rejectionReason}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* ── Progress timeline (in-flight) ────────────────────── */}
        {isInProgress ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-5"
              style={{backgroundColor: C.surface}}>
              <Text
                className="text-[10px] font-bold tracking-widest mb-4"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                RETURN PROGRESS
              </Text>
              <View className="flex-row items-center mb-3">
                {[RotateCcw, Package, Truck, Wallet].map((Icon, idx) => {
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
              <View className="flex-row">
                {['Requested', 'Picked up', 'Received', 'Refunded'].map(
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

        {/* ── Refund summary ──────────────────────────────────── */}
        {ret.refundAmount != null ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-4 flex-row items-center"
              style={{backgroundColor: C.surfaceSage}}>
              <View
                className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                style={{backgroundColor: C.sage}}>
                <Wallet color="white" size={20} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] font-bold tracking-widest"
                  style={{color: C.sageDeep, letterSpacing: 1.5}}>
                  REFUND
                </Text>
                <Text
                  className="text-xl font-black mt-0.5"
                  style={{color: C.ink, letterSpacing: -0.5}}>
                  {formatINR(Number(ret.refundAmount))}
                </Text>
                {ret.refundMethod ? (
                  <Text
                    className="text-[11px] mt-0.5"
                    style={{color: C.inkSoft}}>
                    Via {ret.refundMethod}
                    {ret.refundProcessedAt
                      ? ` · processed ${formatDateTime(ret.refundProcessedAt)}`
                      : ' · processing'}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {/* ── Pickup details card ──────────────────────────────── */}
        {ret.pickupScheduledAt || ret.pickupTrackingNumber ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surface}}>
              <View className="flex-row items-center mb-3">
                <View
                  className="w-8 h-8 rounded-full items-center justify-center mr-2"
                  style={{backgroundColor: C.surfaceGold}}>
                  <Truck color={C.goldDeep} size={14} />
                </View>
                <Text
                  className="text-sm font-bold"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Pickup details
                </Text>
              </View>
              {ret.pickupScheduledAt ? (
                <View className="flex-row mb-2">
                  <Text
                    className="text-xs flex-1"
                    style={{color: C.textTertiary}}>
                    Scheduled
                  </Text>
                  <Text
                    className="text-xs font-semibold"
                    style={{color: C.ink}}>
                    {formatDateTime(ret.pickupScheduledAt)}
                  </Text>
                </View>
              ) : null}
              {ret.pickupCourier ? (
                <View className="flex-row mb-2">
                  <Text
                    className="text-xs flex-1"
                    style={{color: C.textTertiary}}>
                    Courier
                  </Text>
                  <Text
                    className="text-xs font-semibold"
                    style={{color: C.ink}}>
                    {ret.pickupCourier}
                  </Text>
                </View>
              ) : null}
              {ret.pickupTrackingNumber ? (
                <View className="flex-row">
                  <Text
                    className="text-xs flex-1"
                    style={{color: C.textTertiary}}>
                    Tracking
                  </Text>
                  <Text
                    className="text-xs font-semibold"
                    style={{color: C.ink}}>
                    {ret.pickupTrackingNumber}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ── Items card ───────────────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl overflow-hidden"
            style={{backgroundColor: C.surface}}>
            <View className="px-4 pt-4 pb-2">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                ITEMS RETURNED · {ret.items.length}
              </Text>
            </View>
            {ret.items.map((item, idx) => (
              <View
                key={item.id}
                className="px-4 py-3 flex-row"
                style={
                  idx === 0
                    ? undefined
                    : {borderTopWidth: 1, borderTopColor: C.border}
                }>
                <View
                  className="w-14 h-14 rounded-xl overflow-hidden mr-3"
                  style={{backgroundColor: C.surfaceWarm}}>
                  {item.orderItem?.imageUrl ? (
                    <CachedImage
                      source={{uri: item.orderItem.imageUrl}}
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
                    {item.orderItem?.productTitle ?? 'Item'}
                  </Text>
                  {item.orderItem?.variantTitle ? (
                    <Text
                      className="text-[10px] mt-0.5"
                      style={{color: C.textTertiary}}>
                      {item.orderItem.variantTitle}
                    </Text>
                  ) : null}
                  <View className="flex-row items-center mt-1.5" style={{gap: 6}}>
                    <View
                      className="rounded-full px-2 py-0.5"
                      style={{backgroundColor: C.surfaceWarm}}>
                      <Text
                        className="text-[10px] font-bold"
                        style={{color: C.ink}}>
                        QTY {item.quantity}
                      </Text>
                    </View>
                    <View
                      className="rounded-full px-2 py-0.5"
                      style={{backgroundColor: C.surfaceSage}}>
                      <Text
                        className="text-[10px] font-bold"
                        style={{color: C.sageDeep}}>
                        {REASON_LABELS[item.reasonCategory] ??
                          item.reasonCategory}
                      </Text>
                    </View>
                  </View>
                  {item.reasonDetail ? (
                    <Text
                      className="text-[11px] mt-1.5 leading-4"
                      style={{color: C.textSecondary}}
                      numberOfLines={3}>
                      "{item.reasonDetail}"
                    </Text>
                  ) : null}
                  {item.qcQuantityApproved != null &&
                  item.qcQuantityApproved < item.quantity ? (
                    <View
                      className="rounded-lg px-2 py-1 mt-2 flex-row items-center self-start"
                      style={{backgroundColor: C.surfaceGold}}>
                      <AlertCircle color={C.goldDeep} size={10} />
                      <Text
                        className="text-[10px] font-semibold ml-1"
                        style={{color: C.goldDeep}}>
                        {item.qcQuantityApproved} of {item.quantity} approved
                        after QC
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ── Status history timeline ──────────────────────────── */}
        {ret.statusHistory && ret.statusHistory.length > 0 ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-5"
              style={{backgroundColor: C.surface}}>
              <Text
                className="text-[10px] font-bold tracking-widest mb-4"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                ACTIVITY LOG
              </Text>
              {ret.statusHistory.map((event, idx, all) => {
                const isLast = idx === all.length - 1;
                const evTone = statusTone(event.toStatus);
                const evHero = toneToHero(evTone);
                // Soft surface tint per tone for the timeline marker
                // (timeline reads as a calm history, not a hero).
                const evSoftBg =
                  evTone === 'success'
                    ? C.surfaceSage
                    : evTone === 'warning'
                      ? C.surfaceGold
                      : evTone === 'danger'
                        ? C.surfaceCoral
                        : C.surfaceMauve;
                return (
                  <View key={event.id} className="flex-row">
                    <View className="items-center mr-3">
                      <View
                        className="w-8 h-8 rounded-full items-center justify-center"
                        style={{backgroundColor: evSoftBg}}>
                        <View
                          className="w-2.5 h-2.5 rounded-full"
                          style={{backgroundColor: evHero.accent}}
                        />
                      </View>
                      {!isLast ? (
                        <View
                          style={{
                            width: 2,
                            flex: 1,
                            backgroundColor: C.border,
                            marginTop: 2,
                            marginBottom: 2,
                          }}
                        />
                      ) : null}
                    </View>
                    <View className={`flex-1 ${isLast ? 'pb-0' : 'pb-4'}`}>
                      <Text
                        className="text-sm font-bold"
                        style={{color: C.ink, letterSpacing: -0.2}}>
                        {getReturnStatusLabel(event.toStatus)}
                      </Text>
                      <Text
                        className="text-[11px] mt-0.5"
                        style={{color: C.textTertiary}}>
                        {formatDateTime(event.createdAt)}
                      </Text>
                      {event.notes ? (
                        <Text
                          className="text-[11px] mt-1 leading-4"
                          style={{color: C.textSecondary}}>
                          {event.notes}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ── Actions ─────────────────────────────────────────── */}
        <View className="px-5 pt-4" style={{gap: 10}}>
          {ret.status === 'PICKUP_SCHEDULED' ? (
            <TouchableOpacity
              className="rounded-2xl py-3.5 flex-row items-center justify-center"
              style={{
                backgroundColor: handedOverMutation.isPending
                  ? C.textMuted
                  : C.ink,
              }}
              disabled={handedOverMutation.isPending}
              onPress={() => {
                showAlert(
                  'Mark as handed over?',
                  'Confirm you handed the package to the pickup courier.',
                  [
                    {text: 'Cancel', style: 'cancel'},
                    {
                      text: 'Confirm',
                      onPress: () => handedOverMutation.mutate(ret.id),
                    },
                  ],
                );
              }}
              activeOpacity={0.85}>
              <CheckCircle2 color="white" size={16} />
              <Text className="text-sm font-bold text-white ml-2">
                {handedOverMutation.isPending
                  ? 'Updating…'
                  : 'I handed over the package'}
              </Text>
            </TouchableOpacity>
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
                relatedReturnNumber: ret.returnNumber,
              })
            }
            activeOpacity={0.85}>
            <Headphones color={C.ink} size={16} />
            <Text
              className="text-sm font-bold ml-2"
              style={{color: C.ink}}>
              Need help with this return?
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
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel return'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
