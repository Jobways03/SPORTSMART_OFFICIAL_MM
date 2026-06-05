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
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Package,
  RotateCcw,
  ShoppingBag,
  Truck,
} from 'lucide-react-native';
import {useOrders} from '../../queries/useOrders';
import {SkeletonList} from '../../components/Skeleton';
import {ErrorState} from '../../components/ErrorState';
import {Gradient} from '../../components/Gradient';
import {formatINR} from '../../lib/format';
import {
  orderStatusLabel,
  orderStatusTone,
} from '../../lib/orderStatus';
import type {AccountStackParamList, AppTabParamList} from '../../navigation/types';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'Orders'>;
type RootNav = BottomTabNavigationProp<AppTabParamList>;

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

// Map status tone → warm palette pill colors.
function toneToPalette(tone: ReturnType<typeof orderStatusTone>): {
  bg: string;
  fg: string;
  ring: string;
} {
  switch (tone) {
    case 'success':
      return {bg: C.surfaceSage, fg: C.sageDeep, ring: C.sage};
    case 'warning':
      return {bg: C.surfaceGold, fg: C.goldDeep, ring: C.gold};
    case 'danger':
      return {bg: C.surfaceCoral, fg: C.coralDeep, ring: C.coral};
    case 'info':
    default:
      return {bg: C.surfaceMauve, fg: C.inkSoft, ring: C.textTertiary};
  }
}

const FILTERS: Array<{label: string; match: (status: string) => boolean}> = [
  {label: 'All', match: () => true},
  {
    label: 'Active',
    match: s => ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'].includes(s),
  },
  {label: 'Delivered', match: s => s === 'DELIVERED'},
  {label: 'Returned', match: s => ['RETURNED', 'REFUNDED'].includes(s)},
  {label: 'Cancelled', match: s => s === 'CANCELLED'},
];

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', {
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
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    if (days < 365) return `${Math.floor(days / 30)} months ago`;
    return `${Math.floor(days / 365)} years ago`;
  } catch {
    return '';
  }
}

export function OrdersScreen() {
  const nav = useNavigation<Nav>();
  const tabNav = useNavigation<RootNav>();
  const query = useOrders();
  const [filter, setFilter] = useState('All');

  // Compute orders + stats BEFORE any early returns — calling
  // useMemo after a conditional return violates Rules of Hooks
  // (the hook count would jump when query.isLoading flips to false).
  const orders = query.data?.orders ?? [];
  const activeFilter = FILTERS.find(f => f.label === filter) ?? FILTERS[0];
  const filteredOrders = orders.filter(o => activeFilter.match(o.orderStatus));

  const stats = useMemo(() => {
    const totalSpent = orders.reduce(
      (sum, o) =>
        ['DELIVERED', 'SHIPPED', 'PROCESSING', 'CONFIRMED'].includes(
          o.orderStatus,
        )
          ? sum + (o.totalAmount ?? 0)
          : sum,
      0,
    );
    const active = orders.filter(o =>
      ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'].includes(o.orderStatus),
    ).length;
    const delivered = orders.filter(o => o.orderStatus === 'DELIVERED').length;
    return {totalSpent, active, delivered};
  }, [orders]);

  if (query.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
        <Header nav={nav} total={0} />
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

  if (orders.length === 0) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
        <Header nav={nav} total={0} />
        <View className="flex-1 items-center justify-center px-6">
          {/* Layered medallion — outer frosted ring + inner gradient
              fill, giving the empty state a premium quiet moment
              rather than a flat icon-in-circle. */}
          <View
            className="w-28 h-28 rounded-full items-center justify-center mb-6"
            style={{
              backgroundColor: C.surfaceSage,
              borderWidth: 2,
              borderColor: C.surface,
              shadowColor: C.sageDeep,
              shadowOpacity: 0.18,
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
                colors={[C.sageDeep, C.ink]}
                angle={135}
                borderRadius={40}
                style={{
                  width: '100%',
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                <Package color="white" size={36} />
              </Gradient>
            </View>
          </View>
          <Text
            className="text-xl font-black mb-2"
            style={{color: C.ink, letterSpacing: -0.5}}>
            No orders yet
          </Text>
          <Text
            className="text-sm text-center mb-8 leading-5"
            style={{color: C.textSecondary, maxWidth: 280}}>
            Your placed orders will show up here. Browse our collections
            to find your first.
          </Text>
          {/* Premium gradient CTA — same funnel family as Cart /
              PDP / Checkout / Confirmation. */}
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
                  tabNav.navigate('BrowseTab', {screen: 'Browse'})
                }
                activeOpacity={0.85}>
                <Text
                  className="text-sm font-bold text-white mr-2"
                  style={{letterSpacing: -0.2}}>
                  Start shopping
                </Text>
                <ArrowRight color="white" size={15} />
              </TouchableOpacity>
            </Gradient>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} total={query.data?.pagination.total ?? orders.length} />

      <FlatList
        data={filteredOrders}
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
            {/* Stats summary — elevated card with rotating accent
                bars under each value (matches the HomeScreen stats
                strip rhythm). */}
            <View className="px-5 pt-4">
              <View
                className="rounded-2xl p-5 flex-row"
                style={{
                  backgroundColor: C.surface,
                  shadowColor: C.ink,
                  shadowOpacity: 0.06,
                  shadowOffset: {width: 0, height: 4},
                  shadowRadius: 10,
                  elevation: 2,
                }}>
                <Stat
                  value={formatINR(stats.totalSpent)}
                  label="Lifetime spent"
                  align="left"
                  accent={C.sageDeep}
                />
                <View style={{width: 1, backgroundColor: C.border}} />
                <Stat
                  value={String(stats.active)}
                  label="Active"
                  accent={C.sageDeep}
                />
                <View style={{width: 1, backgroundColor: C.border}} />
                <Stat
                  value={String(stats.delivered)}
                  label="Delivered"
                  align="right"
                  accent={C.sageDeep}
                />
              </View>
            </View>

            {/* Filter pills — gradient pill for the active state so
                the row reads as a tab selector, not a flat list. */}
            <View
              className="pt-5 pb-1"
              style={{backgroundColor: 'transparent'}}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 20,
                  gap: 8,
                }}>
                {FILTERS.map(f => {
                  const count = orders.filter(o =>
                    f.match(o.orderStatus),
                  ).length;
                  const isActive = filter === f.label;

                  // Pill contents — extracted so the active branch
                  // can wrap them in a <Gradient> and the inactive
                  // branch in a flat View without duplicating layout.
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
                              color: isActive
                                ? 'white'
                                : C.textSecondary,
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
                  ? 'ALL ORDERS'
                  : `${filter.toUpperCase()} · ${filteredOrders.length}`}
              </Text>
            </View>
          </>
        }
        ItemSeparatorComponent={() => <View style={{height: 10}} />}
        renderItem={({item}) => {
          const tone = orderStatusTone(item.orderStatus, item.paymentStatus);
          const palette = toneToPalette(tone);
          const statusLabel = orderStatusLabel(
            item.orderStatus,
            item.paymentStatus,
          );

          // Progress hint for active orders — fake-derived from status
          // so a quick visual signals where the order is in its life cycle.
          const stepIndex = ['PENDING', 'CONFIRMED'].includes(item.orderStatus)
            ? 1
            : item.orderStatus === 'PROCESSING'
            ? 2
            : item.orderStatus === 'SHIPPED'
            ? 3
            : item.orderStatus === 'DELIVERED'
            ? 4
            : 0;
          const showProgress = stepIndex > 0;

          return (
            <View className="px-5">
              <TouchableOpacity
                className="rounded-2xl p-4"
                style={{backgroundColor: C.surface}}
                onPress={() =>
                  nav.navigate('OrderDetail', {orderNumber: item.orderNumber})
                }
                activeOpacity={0.85}>
                {/* Top: status pill + date */}
                <View className="flex-row items-center justify-between mb-3">
                  <View
                    className="rounded-full px-2.5 py-1 flex-row items-center"
                    style={{backgroundColor: palette.bg}}>
                    <View
                      className="w-1.5 h-1.5 rounded-full mr-1.5"
                      style={{backgroundColor: palette.ring}}
                    />
                    <Text
                      className="text-[10px] font-bold"
                      style={{color: palette.fg, letterSpacing: 0.3}}>
                      {statusLabel.toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    className="text-[10px]"
                    style={{color: C.textTertiary}}>
                    {timeAgo(item.createdAt)}
                  </Text>
                </View>

                {/* Order number + total */}
                <View className="flex-row items-end justify-between mb-3">
                  <View>
                    <Text
                      className="text-[10px] font-bold tracking-widest"
                      style={{color: C.textTertiary, letterSpacing: 1.2}}>
                      ORDER
                    </Text>
                    <Text
                      className="text-sm font-black mt-0.5"
                      style={{color: C.ink, letterSpacing: -0.2}}>
                      #{item.orderNumber}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text
                      className="text-[10px] font-bold tracking-widest"
                      style={{color: C.textTertiary, letterSpacing: 1.2}}>
                      TOTAL
                    </Text>
                    <Text
                      className="text-base font-black mt-0.5"
                      style={{color: C.ink, letterSpacing: -0.3}}>
                      {formatINR(item.totalAmount)}
                    </Text>
                  </View>
                </View>

                {/* Mini progress timeline (only for orders in flight) */}
                {showProgress ? (
                  <View
                    className="rounded-xl p-3 mb-3"
                    style={{backgroundColor: C.surfaceWarm}}>
                    <View className="flex-row items-center">
                      {[Package, CreditCard, Truck, ShoppingBag].map(
                        (Icon, idx) => {
                          const done = idx + 1 <= stepIndex;
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
                                  size={11}
                                />
                              </View>
                              {!isLast ? (
                                <View
                                  className="flex-1 mx-1"
                                  style={{
                                    height: 1.5,
                                    backgroundColor:
                                      idx + 1 < stepIndex
                                        ? C.ink
                                        : C.border,
                                  }}
                                />
                              ) : null}
                            </React.Fragment>
                          );
                        },
                      )}
                    </View>
                    <Text
                      className="text-[11px] font-semibold mt-2"
                      style={{color: C.ink}}>
                      {stepIndex === 1
                        ? 'Confirmed · packing soon'
                        : stepIndex === 2
                        ? 'Packing your order'
                        : stepIndex === 3
                        ? 'Shipped · out for delivery soon'
                        : 'Delivered'}
                    </Text>
                  </View>
                ) : null}

                {/* Footer meta + chevron */}
                <View className="flex-row items-center">
                  <Package color={C.textTertiary} size={12} />
                  <Text
                    className="text-[11px] ml-1.5 flex-1"
                    style={{color: C.textSecondary}}>
                    {item.itemCount} {item.itemCount === 1 ? 'item' : 'items'}{' '}
                    · {item.paymentMethod} · {formatDate(item.createdAt)}
                  </Text>
                  <ChevronRight color={C.textMuted} size={14} />
                </View>

                {/* Quick actions for delivered orders */}
                {item.orderStatus === 'DELIVERED' ? (
                  <View
                    className="flex-row mt-3 pt-3 border-t"
                    style={{borderColor: C.border, gap: 8}}>
                    <TouchableOpacity
                      className="flex-1 rounded-full py-2 items-center justify-center flex-row"
                      style={{backgroundColor: C.surfaceSage}}
                      activeOpacity={0.7}>
                      <RotateCcw color={C.sageDeep} size={11} />
                      <Text
                        className="text-[11px] font-bold ml-1"
                        style={{color: C.sageDeep}}>
                        Buy again
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="flex-1 rounded-full py-2 items-center justify-center flex-row"
                      style={{backgroundColor: C.surfaceWarm}}
                      activeOpacity={0.7}>
                      <Text
                        className="text-[11px] font-bold"
                        style={{color: C.ink}}>
                        Return / Refund
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <View className="items-center py-16 px-6">
            <View
              className="w-16 h-16 rounded-full items-center justify-center mb-3"
              style={{backgroundColor: C.surfaceWarm}}>
              <Package color={C.textMuted} size={26} />
            </View>
            <Text
              className="text-sm font-bold"
              style={{color: C.ink, letterSpacing: -0.2}}>
              No {filter.toLowerCase()} orders
            </Text>
            <Text
              className="text-xs text-center mt-1"
              style={{color: C.textTertiary}}>
              Switch the filter above to see other orders.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function Header({nav, total}: {nav: Nav; total: number}) {
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
          PURCHASE HISTORY
        </Text>
        <Text
          className="font-black"
          style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
          Orders
        </Text>
      </View>
      <View
        className="rounded-full px-2.5 py-1"
        style={{backgroundColor: C.surfaceWarm}}>
        <Text
          className="text-[11px] font-bold"
          style={{color: C.ink}}>
          {total}
        </Text>
      </View>
    </View>
  );
}

function Stat({
  value,
  label,
  align = 'center',
  accent,
}: {
  value: string;
  label: string;
  align?: 'left' | 'center' | 'right';
  accent?: string;
}) {
  const alignItems =
    align === 'left'
      ? 'flex-start'
      : align === 'right'
        ? 'flex-end'
        : 'center';
  return (
    <View className="flex-1 px-2" style={{alignItems}}>
      <Text
        className="font-black"
        style={{color: C.ink, fontSize: 17, letterSpacing: -0.4}}>
        {value}
      </Text>
      {/* Tiny coloured rule under the value — rotated per-stat in
          the parent, ties this card to the HomeScreen stats strip. */}
      {accent ? (
        <View
          className="rounded-full mt-1.5"
          style={{height: 2, width: 16, backgroundColor: accent}}
        />
      ) : null}
      <Text
        className="text-[10px] mt-1.5 font-medium"
        style={{color: C.textTertiary, letterSpacing: 0.4}}>
        {label}
      </Text>
    </View>
  );
}
