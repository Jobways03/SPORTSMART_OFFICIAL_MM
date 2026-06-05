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
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Headphones,
  Package,
  RotateCcw,
  Truck,
  Wallet,
  XCircle,
} from 'lucide-react-native';
import {useReturns} from '../../queries/useReturns';
import {getReturnStatusLabel} from '../../services/returns.service';
import {SkeletonList} from '../../components/Skeleton';
import {ErrorState} from '../../components/ErrorState';
import {formatINR} from '../../lib/format';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'Returns'>;

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

// Map return status → warm palette tone. Status string is what comes
// from the backend (REQUESTED / APPROVED / PICKED_UP / RECEIVED /
// REFUNDED / REJECTED / CANCELLED / etc).
function statusPalette(status: string): {bg: string; fg: string; ring: string} {
  const s = status.toUpperCase();
  if (s === 'REFUNDED' || s === 'COMPLETED' || s === 'RECEIVED') {
    return {bg: C.surfaceSage, fg: C.sageDeep, ring: C.sage};
  }
  if (s === 'REJECTED' || s === 'CANCELLED') {
    return {bg: C.surfaceCoral, fg: C.coralDeep, ring: C.coral};
  }
  // Default = in-progress (REQUESTED / APPROVED / PICKED_UP)
  return {bg: C.surfaceGold, fg: C.goldDeep, ring: C.gold};
}

const FILTERS = [
  {label: 'All', match: () => true},
  {
    label: 'Active',
    match: (r: any) =>
      ['REQUESTED', 'APPROVED', 'PICKED_UP', 'RECEIVED'].includes(
        (r.status ?? '').toUpperCase(),
      ),
  },
  {
    label: 'Refunded',
    match: (r: any) =>
      ['REFUNDED', 'COMPLETED'].includes((r.status ?? '').toUpperCase()),
  },
  {
    label: 'Rejected',
    match: (r: any) =>
      ['REJECTED', 'CANCELLED'].includes((r.status ?? '').toUpperCase()),
  },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

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

export function ReturnsScreen() {
  const nav = useNavigation<Nav>();
  const query = useReturns();
  const [filter, setFilter] = useState('All');

  // Derive data + useMemo BEFORE any conditional returns so the hook
  // count stays constant across renders (Rules of Hooks).
  const returns = query.data?.returns ?? [];
  const activeFilter = FILTERS.find(f => f.label === filter) ?? FILTERS[0];
  const filtered = returns.filter(activeFilter.match);

  const stats = useMemo(() => {
    const active = returns.filter(r =>
      ['REQUESTED', 'APPROVED', 'PICKED_UP', 'RECEIVED'].includes(
        (r.status ?? '').toUpperCase(),
      ),
    ).length;
    const refunded = returns
      .filter(r =>
        ['REFUNDED', 'COMPLETED'].includes((r.status ?? '').toUpperCase()),
      )
      .reduce((sum, r) => sum + (r.refundAmount ? Number(r.refundAmount) : 0), 0);
    return {active, refunded};
  }, [returns]);

  if (query.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
        <Header nav={nav} count={0} />
        <SkeletonList />
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

  if (returns.length === 0) return <EmptyReturns nav={nav} />;

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} count={query.data?.pagination.total ?? returns.length} />

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{paddingBottom: 32}}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={C.sageDeep}
          />
        }
        ListHeaderComponent={
          <>
            {/* ── Stats / how-it-works card — dark gradient hero ── */}
            <View className="px-5 pt-4">
              <View
                style={{
                  borderRadius: 20,
                  overflow: 'hidden',
                  shadowColor: C.sageDeep,
                  shadowOpacity: 0.22,
                  shadowOffset: {width: 0, height: 10},
                  shadowRadius: 18,
                  elevation: 8,
                }}>
                <Gradient
                  colors={[C.ink, C.sageDeep]}
                  angle={140}
                  borderRadius={20}
                  style={{minHeight: 130}}>
                  <View
                    className="absolute rounded-full"
                    style={{
                      width: 240,
                      height: 240,
                      right: -80,
                      top: -90,
                      backgroundColor: C.sage,
                      opacity: 0.28,
                    }}
                  />
                  <View
                    className="absolute rounded-full"
                    style={{
                      width: 180,
                      height: 180,
                      left: -50,
                      bottom: -60,
                      backgroundColor: C.coral,
                      opacity: 0.14,
                    }}
                  />
                  <View className="p-5">
                    <View className="flex-row items-start mb-4">
                      <View
                        className="w-12 h-12 rounded-2xl items-center justify-center mr-3"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.16)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.25)',
                        }}>
                        <RotateCcw color="white" size={22} />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-[10px] font-bold tracking-widest"
                          style={{
                            color: 'rgba(255,255,255,0.78)',
                            letterSpacing: 2,
                          }}>
                          EASY RETURNS · 7-DAY WINDOW
                        </Text>
                        <Text
                          className="font-black mt-0.5"
                          style={{
                            color: 'white',
                            fontSize: 20,
                            letterSpacing: -0.4,
                            lineHeight: 24,
                          }}>
                          Free pickup at your doorstep
                        </Text>
                        <Text
                          className="text-xs mt-1"
                          style={{
                            color: 'rgba(255,255,255,0.78)',
                          }}>
                          Refunds in 3–5 days to your wallet or bank
                        </Text>
                      </View>
                    </View>
                    {/* Stats split — frosted divider, accent rules
                        beneath each value match the system rhythm. */}
                    <View
                      className="flex-row pt-4 border-t"
                      style={{
                        borderColor: 'rgba(255,255,255,0.14)',
                      }}>
                      <View className="flex-1">
                        <Text
                          className="text-[10px] font-bold tracking-widest"
                          style={{
                            color: 'rgba(255,255,255,0.65)',
                            letterSpacing: 1.5,
                          }}>
                          ACTIVE
                        </Text>
                        <Text
                          className="font-black mt-0.5"
                          style={{
                            color: 'white',
                            fontSize: 18,
                            letterSpacing: -0.4,
                          }}>
                          {stats.active}
                        </Text>
                        <View
                          className="rounded-full mt-1.5"
                          style={{
                            height: 2,
                            width: 16,
                            backgroundColor: C.sage,
                          }}
                        />
                      </View>
                      <View
                        style={{
                          width: 1,
                          backgroundColor: 'rgba(255,255,255,0.14)',
                        }}
                      />
                      <View className="flex-1 items-end">
                        <Text
                          className="text-[10px] font-bold tracking-widest"
                          style={{
                            color: 'rgba(255,255,255,0.65)',
                            letterSpacing: 1.5,
                          }}>
                          REFUNDED
                        </Text>
                        <Text
                          className="font-black mt-0.5"
                          style={{
                            color: 'white',
                            fontSize: 18,
                            letterSpacing: -0.4,
                          }}>
                          {formatINR(stats.refunded)}
                        </Text>
                        <View
                          className="rounded-full mt-1.5"
                          style={{
                            height: 2,
                            width: 16,
                            backgroundColor: C.coral,
                          }}
                        />
                      </View>
                    </View>
                  </View>
                </Gradient>
              </View>
            </View>

            {/* ── Filter pills — gradient active state ────────── */}
            <View className="pt-5 pb-1">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{paddingHorizontal: 20, gap: 8}}>
                {FILTERS.map(f => {
                  const count = returns.filter(f.match).length;
                  const isActive = filter === f.label;

                  const inner = (
                    <View className="flex-row items-center">
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
                              ? 'rgba(255,255,255,0.22)'
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
                    </View>
                  );

                  if (isActive) {
                    return (
                      <View
                        key={f.label}
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
                            className="px-4 py-2"
                            onPress={() => setFilter(f.label)}
                            activeOpacity={0.85}>
                            {inner}
                          </TouchableOpacity>
                        </Gradient>
                      </View>
                    );
                  }

                  return (
                    <TouchableOpacity
                      key={f.label}
                      className="rounded-full px-4 py-2"
                      style={{backgroundColor: C.surface}}
                      onPress={() => setFilter(f.label)}
                      activeOpacity={0.7}>
                      {inner}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View className="px-5 pt-4 pb-2">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                {filter === 'All'
                  ? `ALL RETURNS · ${filtered.length}`
                  : `${filter.toUpperCase()} · ${filtered.length}`}
              </Text>
            </View>
          </>
        }
        ItemSeparatorComponent={() => <View style={{height: 10}} />}
        renderItem={({item}) => {
          const palette = statusPalette(item.status);
          const statusLabel = getReturnStatusLabel(item.status);
          const upper = item.status.toUpperCase();
          // Pick a step index for the mini-timeline (Requested → Picked
          // up → Received → Refunded). Mirrors backend lifecycle.
          const step =
            upper === 'REFUNDED' || upper === 'COMPLETED'
              ? 4
              : upper === 'RECEIVED'
              ? 3
              : upper === 'PICKED_UP'
              ? 2
              : upper === 'APPROVED' || upper === 'REQUESTED'
              ? 1
              : 0;
          const isInProgress = step > 0 && step < 4;

          return (
            <View className="px-5">
              <TouchableOpacity
                className="rounded-2xl overflow-hidden"
                style={{backgroundColor: C.surface}}
                onPress={() =>
                  nav.navigate('ReturnDetail', {returnId: item.id})
                }
                activeOpacity={0.85}>
                {/* Top status bar */}
                <View
                  className="px-4 py-2 flex-row items-center justify-between"
                  style={{backgroundColor: palette.bg}}>
                  <View className="flex-row items-center">
                    <View
                      className="w-1.5 h-1.5 rounded-full mr-2"
                      style={{backgroundColor: palette.ring}}
                    />
                    <Text
                      className="text-[10px] font-bold"
                      style={{color: palette.fg, letterSpacing: 1.2}}>
                      {statusLabel.toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    className="text-[10px]"
                    style={{color: palette.fg}}>
                    {timeAgo(item.createdAt)}
                  </Text>
                </View>

                <View className="p-4">
                  {/* Return # + refund row */}
                  <View className="flex-row items-end justify-between mb-3">
                    <View>
                      <Text
                        className="text-[10px] font-bold tracking-widest"
                        style={{color: C.textTertiary, letterSpacing: 1.2}}>
                        RETURN
                      </Text>
                      <Text
                        className="text-sm font-black mt-0.5"
                        style={{color: C.ink, letterSpacing: -0.2}}>
                        #{item.returnNumber}
                      </Text>
                    </View>
                    {item.refundAmount != null ? (
                      <View className="items-end">
                        <Text
                          className="text-[10px] font-bold tracking-widest"
                          style={{color: C.textTertiary, letterSpacing: 1.2}}>
                          REFUND
                        </Text>
                        <Text
                          className="text-base font-black mt-0.5"
                          style={{color: C.ink, letterSpacing: -0.3}}>
                          {formatINR(Number(item.refundAmount))}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* In-progress timeline */}
                  {isInProgress ? (
                    <View
                      className="rounded-xl p-3 mb-3"
                      style={{backgroundColor: C.surfaceWarm}}>
                      <View className="flex-row items-center mb-2">
                        {[RotateCcw, Package, Truck, Wallet].map(
                          (Icon, idx) => {
                            const done = idx + 1 <= step;
                            const isLast = idx === 3;
                            return (
                              <React.Fragment key={idx}>
                                <View
                                  className="w-6 h-6 rounded-full items-center justify-center"
                                  style={{
                                    backgroundColor: done ? C.ink : 'white',
                                    borderWidth: done ? 0 : 1,
                                    borderColor: C.border,
                                  }}>
                                  <Icon
                                    color={done ? 'white' : C.textMuted}
                                    size={10}
                                  />
                                </View>
                                {!isLast ? (
                                  <View
                                    className="flex-1 mx-1"
                                    style={{
                                      height: 1.5,
                                      backgroundColor:
                                        idx + 1 < step ? C.ink : C.border,
                                    }}
                                  />
                                ) : null}
                              </React.Fragment>
                            );
                          },
                        )}
                      </View>
                      <Text
                        className="text-[11px] font-semibold"
                        style={{color: C.ink}}>
                        {step === 1
                          ? 'Pickup being scheduled'
                          : step === 2
                          ? 'Item picked up · in transit'
                          : 'Received at warehouse · refund processing'}
                      </Text>
                    </View>
                  ) : null}

                  {/* Footer meta */}
                  <View className="flex-row items-center">
                    <RotateCcw color={C.textTertiary} size={12} />
                    <Text
                      className="text-[11px] ml-1.5 flex-1"
                      style={{color: C.textSecondary}}
                      numberOfLines={1}>
                      {item.items.length}{' '}
                      {item.items.length === 1 ? 'item' : 'items'}
                      {item.masterOrder?.orderNumber
                        ? ` · Order #${item.masterOrder.orderNumber}`
                        : ''}{' '}
                      · {formatDate(item.createdAt)}
                    </Text>
                    <ChevronRight color={C.textMuted} size={14} />
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <View className="items-center py-16 px-6">
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-3"
              style={{backgroundColor: C.surfaceWarm}}>
              <RotateCcw color={C.textMuted} size={26} />
            </View>
            <Text
              className="text-sm font-bold"
              style={{color: C.ink, letterSpacing: -0.2}}>
              No {filter.toLowerCase()} returns
            </Text>
            <Text
              className="text-xs text-center mt-1"
              style={{color: C.textTertiary}}>
              Switch the filter above to see other returns.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View className="px-5 pt-5">
            <TouchableOpacity
              className="rounded-2xl p-4 flex-row items-center"
              style={{backgroundColor: C.surface}}
              onPress={() => nav.navigate('Tickets')}
              activeOpacity={0.85}>
              <View
                className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                style={{backgroundColor: C.surfaceSage}}>
                <Headphones color={C.sageDeep} size={18} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-bold"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Need help with a return?
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{color: C.textSecondary}}>
                  Chat with our team · 9 am to 9 pm IST
                </Text>
              </View>
              <ChevronRight color={C.textMuted} size={16} />
            </TouchableOpacity>
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
          style={{color: C.sageDeep, letterSpacing: 2}}>
          REFUNDS & PICKUPS
        </Text>
        <Text
          className="font-black"
          style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
          Returns
        </Text>
      </View>
      <View
        className="rounded-full px-2.5 py-1 flex-row items-center"
        style={{backgroundColor: C.surfaceSage}}>
        <RotateCcw color={C.sageDeep} size={10} />
        <Text
          className="text-[11px] font-bold ml-1"
          style={{color: C.sageDeep}}>
          {count}
        </Text>
      </View>
    </View>
  );
}

function EmptyReturns({nav}: {nav: Nav}) {
  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} count={0} />
      <ScrollView contentContainerStyle={{paddingBottom: 32}}>
        {/* Promo-style how-it-works card */}
        <View className="px-5 pt-4">
          <View
            className="rounded-3xl overflow-hidden p-5 relative"
            style={{backgroundColor: C.surfaceSage, minHeight: 200}}>
            <View
              className="absolute rounded-full"
              style={{
                width: 240,
                height: 240,
                right: -80,
                top: -80,
                backgroundColor: C.sage,
                opacity: 0.18,
              }}
            />
            <View
              className="w-14 h-14 rounded-2xl items-center justify-center mb-4"
              style={{backgroundColor: C.sage}}>
              <RotateCcw color="white" size={26} />
            </View>
            <Text
              className="text-[10px] font-bold tracking-widest mb-1"
              style={{color: C.sageDeep, letterSpacing: 2}}>
              HASSLE-FREE RETURNS
            </Text>
            <Text
              className="font-black mb-2"
              style={{
                color: C.ink,
                fontSize: 24,
                letterSpacing: -0.6,
                lineHeight: 28,
              }}>
              7-day return window{'\n'}on every order
            </Text>
            <Text
              className="text-sm leading-5"
              style={{color: C.inkSoft}}>
              Free home pickup. Refunds processed to your wallet or
              bank in 3–5 days.
            </Text>
          </View>
        </View>

        {/* 3-step how-to card */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl p-5"
            style={{backgroundColor: C.surface}}>
            <Text
              className="text-[10px] font-bold tracking-widest mb-4"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              HOW IT WORKS
            </Text>
            {[
              {
                Icon: Package,
                title: 'Pick an order',
                sub: 'Go to Orders → choose a delivered order',
              },
              {
                Icon: RotateCcw,
                title: 'Start a return',
                sub: 'Select items, reason, upload photos',
              },
              {
                Icon: Wallet,
                title: 'Get your refund',
                sub: '3–5 days to wallet · 5–7 days to bank',
              },
            ].map((step, idx, all) => {
              const isLast = idx === all.length - 1;
              return (
                <View key={step.title} className="flex-row">
                  <View className="items-center mr-3">
                    <View
                      className="w-9 h-9 rounded-full items-center justify-center"
                      style={{backgroundColor: C.surfaceSage}}>
                      <step.Icon color={C.sageDeep} size={15} />
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
                  <View className={`flex-1 ${isLast ? 'pb-0' : 'pb-5'}`}>
                    <Text
                      className="text-sm font-bold"
                      style={{color: C.ink, letterSpacing: -0.2}}>
                      {step.title}
                    </Text>
                    <Text
                      className="text-[11px] mt-0.5"
                      style={{color: C.textSecondary}}>
                      {step.sub}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Empty state CTA */}
        <View className="px-5 pt-5">
          <View
            className="rounded-2xl p-5 items-center"
            style={{backgroundColor: C.surface}}>
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-3"
              style={{backgroundColor: C.surfaceWarm}}>
              <RotateCcw color={C.textMuted} size={26} />
            </View>
            <Text
              className="text-sm font-bold mb-1"
              style={{color: C.ink, letterSpacing: -0.2}}>
              No returns yet
            </Text>
            <Text
              className="text-xs text-center mb-4"
              style={{color: C.textTertiary, maxWidth: 280}}>
              Returns you start from a delivered order will appear here.
            </Text>
            <View
              style={{
                borderRadius: 999,
                overflow: 'hidden',
                shadowColor: C.sageDeep,
                shadowOpacity: 0.28,
                shadowOffset: {width: 0, height: 4},
                shadowRadius: 8,
                elevation: 4,
              }}>
              <Gradient
                colors={[C.sageDeep, C.ink]}
                angle={135}
                borderRadius={999}>
                <TouchableOpacity
                  className="px-5 py-2.5 flex-row items-center"
                  onPress={() => nav.navigate('Orders')}
                  activeOpacity={0.85}>
                  <Text
                    className="text-xs font-bold text-white mr-1.5"
                    style={{letterSpacing: -0.1}}>
                    View my orders
                  </Text>
                  <ArrowRight color="white" size={12} />
                </TouchableOpacity>
              </Gradient>
            </View>
          </View>
        </View>

        {/* Help link */}
        <View className="px-5 pt-3">
          <TouchableOpacity
            className="rounded-2xl p-4 flex-row items-center"
            style={{backgroundColor: C.surface}}
            onPress={() => nav.navigate('Tickets')}
            activeOpacity={0.85}>
            <View
              className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
              style={{backgroundColor: C.surfaceSage}}>
              <Headphones color={C.sageDeep} size={18} />
            </View>
            <View className="flex-1">
              <Text
                className="text-sm font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                Need help?
              </Text>
              <Text
                className="text-[11px] mt-0.5"
                style={{color: C.textSecondary}}>
                Chat with our team about returns
              </Text>
            </View>
            <ChevronRight color={C.textMuted} size={16} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
