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
import {useShareInvite} from '../../lib/share';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Award,
  ChevronLeft,
  ChevronRight,
  Crown,
  Eye,
  EyeOff,
  Gift,
  HelpCircle,
  Info,
  Plus,
  RotateCcw,
  Share2,
  ShoppingBag,
  Wallet,
  Zap,
} from 'lucide-react-native';
import {useWalletBalance, useWalletTransactions} from '../../queries/useWallet';
import {
  formatPaise,
  transactionDirection,
  transactionTypeLabel,
} from '../../services/wallet.service';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'Wallet'>;

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

const FILTERS = [
  {label: 'All', match: () => true},
  {
    label: 'Credits',
    match: (item: any) => transactionDirection(item.type) === 'credit',
  },
  {
    label: 'Debits',
    match: (item: any) => transactionDirection(item.type) === 'debit',
  },
  {label: 'Pending', match: (item: any) => item.status !== 'COMPLETED'},
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

function maskBalance(amountStr: string, hidden: boolean): string {
  if (!hidden) return amountStr;
  // Keep the ₹ but mask the digits.
  return amountStr.replace(/[\d,]/g, '•');
}

export function WalletScreen() {
  const nav = useNavigation<Nav>();
  const {share: shareInvite, justCopied: inviteCopied} = useShareInvite();
  const balanceQuery = useWalletBalance();
  const txQuery = useWalletTransactions();
  const [hidden, setHidden] = useState(false);
  const [filter, setFilter] = useState('All');

  // Derive data + useMemo BEFORE the conditional early returns so the
  // hook count stays stable across loading → success renders.
  const balance = balanceQuery.data?.balanceInPaise ?? 0;
  const transactions = txQuery.data?.items ?? [];

  const stats = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let earned = 0;
    let spent = 0;
    let pending = 0;
    for (const t of transactions) {
      const dir = transactionDirection(t.type);
      const created = new Date(t.createdAt);
      if (t.status !== 'COMPLETED') {
        pending += Math.abs(t.amountInPaise);
        continue;
      }
      if (created >= monthStart) {
        if (dir === 'credit') earned += Math.abs(t.amountInPaise);
        else spent += Math.abs(t.amountInPaise);
      }
    }
    return {earned, spent, pending};
  }, [transactions]);

  const activeFilter = FILTERS.find(f => f.label === filter) ?? FILTERS[0];
  const filteredTx = transactions.filter(activeFilter.match);

  if (balanceQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <Spinner fullscreen />
      </SafeAreaView>
    );
  }
  if (balanceQuery.isError) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <ErrorState onRetry={balanceQuery.refetch} />
      </SafeAreaView>
    );
  }

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
            STORE CREDIT
          </Text>
          <Text
            className="font-black"
            style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
            Wallet
          </Text>
        </View>
        <TouchableOpacity
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          activeOpacity={0.7}>
          <HelpCircle color={C.ink} size={17} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredTx}
        keyExtractor={item => item.id}
        contentContainerStyle={{paddingBottom: 32}}
        refreshControl={
          <RefreshControl
            refreshing={balanceQuery.isRefetching || txQuery.isRefetching}
            onRefresh={() => {
              balanceQuery.refetch();
              txQuery.refetch();
            }}
            tintColor={C.sageDeep}
          />
        }
        ListHeaderComponent={
          <>
            {/* ── Balance hero (dark luxury card) ─────────────── */}
            <View className="px-5 pt-4">
              <View
                style={{
                  borderRadius: 28,
                  overflow: 'hidden',
                  shadowColor: C.goldDeep,
                  shadowOpacity: 0.26,
                  shadowOffset: {width: 0, height: 14},
                  shadowRadius: 22,
                  elevation: 12,
                }}>
                <Gradient
                  colors={[C.ink, C.goldDeep, C.sageDeep]}
                  angle={150}
                  borderRadius={28}
                  style={{minHeight: 240}}>
                  {/* Soft glow blobs over the gradient — read as
                      light reflections on a brushed-metal card. */}
                  <View
                    className="absolute rounded-full"
                    style={{
                      width: 300,
                      height: 300,
                      right: -100,
                      top: -110,
                      backgroundColor: C.sage,
                      opacity: 0.26,
                    }}
                  />
                  <View
                    className="absolute rounded-full"
                    style={{
                      width: 220,
                      height: 220,
                      left: -70,
                      bottom: -90,
                      backgroundColor: C.coral,
                      opacity: 0.16,
                    }}
                  />

                  <View className="p-5">
                    <View className="flex-row items-start justify-between">
                      <View className="flex-row items-center">
                        <View
                          className="w-10 h-10 rounded-full items-center justify-center mr-2.5"
                          style={{
                            backgroundColor: 'rgba(255,255,255,0.16)',
                            borderWidth: 1,
                            borderColor: 'rgba(255,255,255,0.25)',
                          }}>
                          <Wallet color="white" size={16} />
                        </View>
                        <View>
                          <Text
                            className="text-[10px] font-bold tracking-widest"
                            style={{color: 'white', letterSpacing: 2}}>
                            SPORTSMART WALLET
                          </Text>
                          <Text
                            className="text-[10px] mt-0.5"
                            style={{color: 'rgba(255,255,255,0.7)'}}>
                            Apply at checkout
                          </Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        className="w-9 h-9 rounded-full items-center justify-center"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.14)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.22)',
                        }}
                        onPress={() => setHidden(v => !v)}
                        activeOpacity={0.7}
                        accessibilityLabel={
                          hidden ? 'Show balance' : 'Hide balance'
                        }>
                        {hidden ? (
                          <EyeOff color="white" size={15} />
                        ) : (
                          <Eye color="white" size={15} />
                        )}
                      </TouchableOpacity>
                    </View>

                    <View className="mt-6 mb-1">
                      <Text
                        className="text-[10px] font-bold tracking-widest mb-1.5"
                        style={{
                          color: 'rgba(255,255,255,0.72)',
                          letterSpacing: 1.5,
                        }}>
                        AVAILABLE BALANCE
                      </Text>
                      <Text
                        className="font-black"
                        style={{
                          color: 'white',
                          fontSize: 42,
                          letterSpacing: -1.8,
                          lineHeight: 46,
                        }}>
                        {maskBalance(formatPaise(balance), hidden)}
                      </Text>
                    </View>

                    {/* CTA row — primary "Add money" is white-inverted
                        for max contrast against the dark gradient;
                        secondary "Send" is a frosted-glass outline. */}
                    <View className="flex-row mt-5" style={{gap: 8}}>
                      <TouchableOpacity
                        className="flex-1 rounded-full py-3 flex-row items-center justify-center"
                        style={{
                          backgroundColor: 'white',
                          shadowColor: 'white',
                          shadowOpacity: 0.35,
                          shadowOffset: {width: 0, height: 0},
                          shadowRadius: 10,
                          elevation: 3,
                        }}
                        onPress={() => nav.navigate('WalletTopup')}
                        activeOpacity={0.85}>
                        <Plus color={C.ink} size={14} />
                        <Text
                          className="text-[12px] font-bold ml-1.5"
                          style={{color: C.ink, letterSpacing: 0.3}}>
                          Add money
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="flex-1 rounded-full py-3 flex-row items-center justify-center"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.12)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.28)',
                        }}
                        activeOpacity={0.85}>
                        <Share2 color="white" size={13} />
                        <Text
                          className="text-[12px] font-bold ml-1.5"
                          style={{color: 'white', letterSpacing: 0.3}}>
                          Send
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Gradient>
              </View>
            </View>

            {/* ── Month stats trio ──────────────────────────── */}
            <View className="px-5 pt-3 flex-row" style={{gap: 8}}>
              <StatCard
                label="Earned"
                value={formatPaise(stats.earned)}
                Icon={ArrowDownLeft}
                tint={C.surfaceCoral}
                accent={C.sageDeep}
              />
              <StatCard
                label="Spent"
                value={formatPaise(stats.spent)}
                Icon={ArrowUpRight}
                tint={C.surfaceCoral}
                accent={C.sageDeep}
              />
              <StatCard
                label="Pending"
                value={formatPaise(stats.pending)}
                Icon={Zap}
                tint={C.surfaceCoral}
                accent={C.sageDeep}
              />
            </View>

            {/* ── Quick action tiles ────────────────────────── */}
            <View className="px-5 pt-5">
              <SectionLabel>QUICK ACTIONS</SectionLabel>
              <View
                className="rounded-2xl overflow-hidden"
                style={{backgroundColor: C.surface}}>
                <ActionRow
                  Icon={Plus}
                  iconBg={C.surfaceCoral}
                  iconColor={C.sageDeep}
                  label="Add money"
                  hint="Top up via Razorpay"
                  onPress={() => nav.navigate('WalletTopup')}
                />
                <ActionRow
                  Icon={Award}
                  iconBg={C.surfaceCoral}
                  iconColor={C.sageDeep}
                  label="Cashback offers"
                  hint="Earn while you shop"
                  onPress={() => {}}
                />
                <ActionRow
                  Icon={RotateCcw}
                  iconBg={C.surfaceCoral}
                  iconColor={C.sageDeep}
                  label="Refund history"
                  hint="Track money back to wallet"
                  onPress={() => nav.navigate('Returns')}
                  last
                />
              </View>
            </View>

            {/* ── Refer & earn banner ──────────────────────── */}
            <View className="px-5 pt-4">
              <TouchableOpacity
                className="rounded-2xl overflow-hidden p-5 relative"
                style={{backgroundColor: C.surfaceMauve}}
                activeOpacity={0.9}
                onPress={shareInvite}>
                <View
                  className="absolute rounded-full"
                  style={{
                    width: 180,
                    height: 180,
                    right: -50,
                    top: -50,
                    backgroundColor: C.gold,
                    opacity: 0.18,
                  }}
                />
                <View className="flex-row items-center mb-2">
                  <Gift color={C.goldDeep} size={14} />
                  <Text
                    className="text-[10px] font-bold tracking-widest ml-2"
                    style={{color: C.goldDeep, letterSpacing: 1.8}}>
                    REFER & EARN
                  </Text>
                </View>
                <Text
                  className="font-black mb-1"
                  style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
                  Earn ₹500 for every friend
                </Text>
                <Text
                  className="text-xs mb-4"
                  style={{color: C.inkSoft, maxWidth: '85%'}}>
                  Money lands straight in your wallet — instantly
                  spendable at checkout.
                </Text>
                <View
                  className="rounded-full px-4 py-2 self-start flex-row items-center"
                  style={{backgroundColor: C.ink}}>
                  <Share2 color="white" size={11} />
                  <Text
                    className="text-[11px] font-bold text-white ml-1.5"
                    style={{letterSpacing: 0.3}}>
                    {inviteCopied ? 'Link copied!' : 'Share invite'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* ── Transactions header + filter pills ─────────── */}
            <View className="pt-5">
              <View className="px-5 flex-row items-end justify-between mb-3">
                <View>
                  <Text
                    className="text-lg font-black"
                    style={{color: C.ink, letterSpacing: -0.4}}>
                    Transactions
                  </Text>
                  <Text
                    className="text-xs mt-0.5"
                    style={{color: C.textTertiary}}>
                    {transactions.length}{' '}
                    {transactions.length === 1 ? 'entry' : 'entries'} all-time
                  </Text>
                </View>
                <TouchableOpacity activeOpacity={0.7}>
                  <Text
                    className="text-xs font-semibold"
                    style={{color: C.sageDeep}}>
                    Export →
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{paddingHorizontal: 20, gap: 8}}>
                {FILTERS.map(f => {
                  const count = transactions.filter(f.match).length;
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

            <View className="px-5 pt-4 pb-2">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                {filter === 'All' ? 'RECENT ACTIVITY' : filter.toUpperCase()}
              </Text>
            </View>
          </>
        }
        ItemSeparatorComponent={() => <View style={{height: 8}} />}
        renderItem={({item}) => {
          const direction = transactionDirection(item.type);
          const isCredit = direction === 'credit';
          const sign = isCredit ? '+' : '−';
          const Icon = isCredit ? ArrowDownLeft : ArrowUpRight;
          const isPending = item.status !== 'COMPLETED';
          return (
            <View className="px-5">
              <View
                className="rounded-2xl px-3 py-3 flex-row items-center"
                style={{backgroundColor: C.surface}}>
                <View
                  className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                  style={{
                    backgroundColor: isCredit
                      ? C.surfaceSage
                      : C.surfaceWarm,
                  }}>
                  <Icon
                    color={isCredit ? C.sageDeep : C.ink}
                    size={17}
                  />
                </View>
                <View className="flex-1 mr-3">
                  <Text
                    className="text-sm font-bold"
                    style={{color: C.ink, letterSpacing: -0.2}}
                    numberOfLines={1}>
                    {item.description || transactionTypeLabel(item.type)}
                  </Text>
                  <View className="flex-row items-center mt-1">
                    <Text
                      className="text-[10px] font-semibold"
                      style={{color: C.textTertiary, letterSpacing: 0.3}}>
                      {transactionTypeLabel(item.type).toUpperCase()}
                    </Text>
                    <View
                      className="mx-1.5 w-0.5 h-0.5 rounded-full"
                      style={{backgroundColor: C.textMuted}}
                    />
                    <Text
                      className="text-[10px]"
                      style={{color: C.textTertiary}}>
                      {formatDate(item.createdAt)}
                    </Text>
                    {isPending ? (
                      <View
                        className="ml-2 rounded-full px-1.5 py-0.5"
                        style={{backgroundColor: C.surfaceGold}}>
                        <Text
                          className="text-[9px] font-bold"
                          style={{color: C.goldDeep, letterSpacing: 0.3}}>
                          PENDING
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Text
                  className="text-sm font-black"
                  style={{
                    color: isCredit ? C.sageDeep : C.ink,
                    letterSpacing: -0.3,
                  }}>
                  {sign} {formatPaise(Math.abs(item.amountInPaise))}
                </Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          txQuery.isLoading ? (
            <Spinner />
          ) : (
            <View className="items-center py-12 px-6">
              <View
                className="w-16 h-16 rounded-full items-center justify-center mb-3"
                style={{backgroundColor: C.surfaceWarm}}>
                <Wallet color={C.textMuted} size={26} />
              </View>
              <Text
                className="text-sm font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                No transactions yet
              </Text>
              <Text
                className="text-xs text-center mt-1"
                style={{color: C.textTertiary, maxWidth: 260}}>
                Top up your wallet or earn refunds — they'll show up here.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          transactions.length > 0 ? (
            <View className="px-5 pt-5">
              <View
                className="rounded-2xl p-3 flex-row items-center"
                style={{backgroundColor: C.surfaceSage}}>
                <Info color={C.sageDeep} size={13} />
                <Text
                  className="text-[11px] ml-2 flex-1 leading-4"
                  style={{color: C.sageDeep, fontWeight: '600'}}>
                  Wallet credit never expires · Tax-free
                </Text>
              </View>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  Icon,
  tint,
  accent,
}: {
  label: string;
  value: string;
  Icon: typeof ArrowDownLeft;
  tint: string;
  accent: string;
}) {
  return (
    <View
      className="flex-1 rounded-2xl p-3"
      style={{
        backgroundColor: C.surface,
        shadowColor: C.ink,
        shadowOpacity: 0.05,
        shadowOffset: {width: 0, height: 3},
        shadowRadius: 8,
        elevation: 2,
      }}>
      <View className="flex-row items-center mb-1.5">
        <View
          className="w-7 h-7 rounded-lg items-center justify-center mr-1.5"
          style={{backgroundColor: tint}}>
          <Icon color={accent} size={12} />
        </View>
        <Text
          className="text-[10px] font-bold flex-1"
          style={{color: C.textTertiary, letterSpacing: 0.3}}
          numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
      </View>
      <Text
        className="font-black"
        style={{color: C.ink, fontSize: 15, letterSpacing: -0.4}}
        numberOfLines={1}>
        {value}
      </Text>
      {/* Tiny accent rule under the value — same rhythm as Home
          and Orders stats strips, ties this card to the system. */}
      <View
        className="rounded-full mt-1.5"
        style={{height: 2, width: 16, backgroundColor: accent}}
      />
      <Text
        className="text-[9px] mt-1.5 font-medium"
        style={{color: C.textTertiary, letterSpacing: 0.3}}>
        This month
      </Text>
    </View>
  );
}

function ActionRow({
  Icon,
  iconBg,
  iconColor,
  label,
  hint,
  onPress,
  last,
}: {
  Icon: typeof Plus;
  iconBg: string;
  iconColor: string;
  label: string;
  hint: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      className="px-4 py-3.5 flex-row items-center"
      style={
        last
          ? undefined
          : {borderBottomWidth: 1, borderBottomColor: C.border}
      }
      onPress={onPress}
      activeOpacity={0.7}>
      <View
        className="w-10 h-10 rounded-xl items-center justify-center mr-3"
        style={{backgroundColor: iconBg}}>
        <Icon color={iconColor} size={17} />
      </View>
      <View className="flex-1">
        <Text
          className="text-sm font-bold"
          style={{color: C.ink, letterSpacing: -0.2}}>
          {label}
        </Text>
        <Text
          className="text-[11px] mt-0.5"
          style={{color: C.textTertiary}}>
          {hint}
        </Text>
      </View>
      <ChevronRight color={C.textMuted} size={16} />
    </TouchableOpacity>
  );
}

function SectionLabel({children}: {children: React.ReactNode}) {
  return (
    <Text
      className="text-[10px] font-bold tracking-widest mb-2 px-1"
      style={{color: C.textTertiary, letterSpacing: 1.8}}>
      {children}
    </Text>
  );
}
