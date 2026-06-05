import React, {useMemo, useState} from 'react';
import {
  FlatList,
  Linking,
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
  CreditCard,
  Headphones,
  HelpCircle,
  Mail,
  MessageCircle,
  Package,
  Phone,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Truck,
} from 'lucide-react-native';
import {useTickets} from '../../queries/useSupport';
import {STATUS_LABEL} from '../../services/support.service';
import {SkeletonList} from '../../components/Skeleton';
import {ErrorState} from '../../components/ErrorState';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'Tickets'>;

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

// Map ticket status → warm palette tone.
function statusPalette(status: string): {bg: string; fg: string; ring: string} {
  const s = status.toUpperCase();
  if (s === 'RESOLVED' || s === 'CLOSED') {
    return {bg: C.surfaceSage, fg: C.sageDeep, ring: C.sage};
  }
  if (s === 'OPEN' || s === 'PENDING' || s === 'AWAITING_CUSTOMER') {
    return {bg: C.surfaceGold, fg: C.goldDeep, ring: C.gold};
  }
  if (s === 'IN_PROGRESS' || s === 'AWAITING_AGENT') {
    return {bg: C.surfaceMauve, fg: C.inkSoft, ring: C.gold};
  }
  return {bg: C.surfaceWarm, fg: C.textSecondary, ring: C.textMuted};
}

const FILTERS = [
  {label: 'All', match: () => true},
  {
    label: 'Open',
    match: (t: any) =>
      ['OPEN', 'PENDING', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_AGENT'].includes(
        (t.status ?? '').toUpperCase(),
      ),
  },
  {
    label: 'Resolved',
    match: (t: any) =>
      ['RESOLVED', 'CLOSED'].includes((t.status ?? '').toUpperCase()),
  },
];

// FAQ shortcut tiles — visual entry points for the most-asked questions.
const FAQ_TOPICS = [
  {Icon: Truck, label: 'Track order', tint: C.surfaceSage, accent: C.sageDeep},
  {Icon: RotateCcw, label: 'Returns', tint: C.surfaceCoral, accent: C.coralDeep},
  {Icon: CreditCard, label: 'Payments', tint: C.surfaceGold, accent: C.goldDeep},
  {Icon: Package, label: 'Orders', tint: C.surfaceMauve, accent: C.inkSoft},
];

function timeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  } catch {
    return '';
  }
}

export function TicketsScreen() {
  const nav = useNavigation<Nav>();

  // "Browse help" tiles route to the relevant self-serve screen. There's
  // no in-app FAQ list yet, so "All FAQs" (below) opens a new ticket.
  const openHelpTopic = (label: string) => {
    switch (label) {
      case 'Returns':
        nav.navigate('Returns');
        break;
      case 'Payments':
        nav.navigate('Wallet');
        break;
      case 'Track order':
      case 'Orders':
      default:
        nav.navigate('Orders');
        break;
    }
  };
  const query = useTickets();
  const [filter, setFilter] = useState('All');

  // Derived data + useMemo BEFORE early returns — keeping hook count
  // stable across loading → success transitions (Rules of Hooks).
  const tickets = query.data?.items ?? [];
  const activeFilter = FILTERS.find(f => f.label === filter) ?? FILTERS[0];
  const filtered = tickets.filter(activeFilter.match);

  const openCount = useMemo(
    () =>
      tickets.filter(t =>
        ['OPEN', 'PENDING', 'IN_PROGRESS', 'AWAITING_CUSTOMER', 'AWAITING_AGENT'].includes(
          (t.status ?? '').toUpperCase(),
        ),
      ).length,
    [tickets],
  );

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

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} count={tickets.length} />

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{paddingBottom: 120}}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={C.sageDeep}
          />
        }
        ListHeaderComponent={
          <>
            {/* ── Hero "we're here" — dark gradient support card */}
            <View className="px-5 pt-4">
              <View
                style={{
                  borderRadius: 24,
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
                  borderRadius={24}>
                  <View
                    className="absolute rounded-full"
                    style={{
                      width: 240,
                      height: 240,
                      right: -70,
                      top: -80,
                      backgroundColor: C.sage,
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
                      backgroundColor: C.coral,
                      opacity: 0.14,
                    }}
                  />
                  <View className="p-5">
                    <View className="flex-row items-center mb-3">
                      <View
                        className="w-12 h-12 rounded-2xl items-center justify-center mr-3"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.16)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.28)',
                        }}>
                        <Headphones color="white" size={22} />
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-[10px] font-bold tracking-widest"
                          style={{
                            color: 'rgba(255,255,255,0.78)',
                            letterSpacing: 2,
                          }}>
                          WE'RE HERE TO HELP
                        </Text>
                        <Text
                          className="font-black mt-0.5"
                          style={{
                            color: 'white',
                            fontSize: 22,
                            letterSpacing: -0.6,
                            lineHeight: 26,
                          }}>
                          Average reply in 30 min
                        </Text>
                      </View>
                    </View>
                    <View
                      className="flex-row pt-3 border-t"
                      style={{
                        borderColor: 'rgba(255,255,255,0.14)',
                        gap: 12,
                      }}>
                      <View className="flex-row items-center">
                        <Clock color="white" size={11} />
                        <Text
                          className="text-[11px] font-semibold ml-1.5"
                          style={{
                            color: 'rgba(255,255,255,0.85)',
                          }}>
                          9 am — 9 pm IST
                        </Text>
                      </View>
                      <View className="flex-row items-center">
                        <CheckCircle2 color="white" size={11} />
                        <Text
                          className="text-[11px] font-semibold ml-1.5"
                          style={{
                            color: 'rgba(255,255,255,0.85)',
                          }}>
                          7 days a week
                        </Text>
                      </View>
                    </View>
                  </View>
                </Gradient>
              </View>
            </View>

            {/* ── Quick contact tiles (4-up) ───────────────────── */}
            <View className="px-5 pt-4">
              <SectionLabel>REACH US</SectionLabel>
              <View className="flex-row" style={{gap: 8}}>
                <ContactTile
                  Icon={MessageCircle}
                  label="Live chat"
                  sub="Reply in 5 min"
                  tint={C.surfaceCoral}
                  accent={C.sageDeep}
                  onPress={() => nav.navigate('CreateTicket', {})}
                />
                <ContactTile
                  Icon={Phone}
                  label="Call us"
                  sub="Toll free"
                  tint={C.surfaceCoral}
                  accent={C.sageDeep}
                  onPress={() =>
                    Linking.openURL('tel:18001234567').catch(() => {})
                  }
                />
                <ContactTile
                  Icon={Mail}
                  label="Email"
                  sub="Reply in 24 h"
                  tint={C.surfaceCoral}
                  accent={C.sageDeep}
                  onPress={() =>
                    Linking.openURL(
                      'mailto:support@sportsmart.com?subject=Help',
                    ).catch(() => {})
                  }
                />
              </View>
            </View>

            {/* ── FAQ shortcut row ─────────────────────────────── */}
            <View className="px-5 pt-5">
              <View className="flex-row items-end justify-between mb-2 px-1">
                <View>
                  <Text
                    className="text-[10px] font-bold tracking-widest"
                    style={{color: C.textTertiary, letterSpacing: 1.8}}>
                    BROWSE HELP
                  </Text>
                  <Text
                    className="text-[11px] mt-0.5"
                    style={{color: C.textTertiary}}>
                    Find answers in seconds
                  </Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => nav.navigate('CreateTicket', {})}>
                  <Text
                    className="text-xs font-semibold"
                    style={{color: C.sageDeep}}>
                    All FAQs →
                  </Text>
                </TouchableOpacity>
              </View>
              <View className="flex-row" style={{gap: 8}}>
                {FAQ_TOPICS.map(topic => (
                  <TouchableOpacity
                    key={topic.label}
                    className="flex-1 rounded-2xl p-3 items-center"
                    style={{backgroundColor: C.surface}}
                    activeOpacity={0.7}
                    onPress={() => openHelpTopic(topic.label)}>
                    <View
                      className="w-10 h-10 rounded-2xl items-center justify-center mb-2"
                      style={{backgroundColor: topic.tint}}>
                      <topic.Icon color={topic.accent} size={16} />
                    </View>
                    <Text
                      className="text-[10px] font-bold text-center"
                      style={{color: C.ink, letterSpacing: -0.1}}>
                      {topic.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* ── Filter pills + section label ─────────────────── */}
            {tickets.length > 0 ? (
              <>
                <View className="pt-5 pb-1">
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{paddingHorizontal: 20, gap: 8}}>
                    {FILTERS.map(f => {
                      const count = tickets.filter(f.match).length;
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
                    YOUR CONVERSATIONS · {filtered.length}
                  </Text>
                </View>
              </>
            ) : null}
          </>
        }
        ItemSeparatorComponent={() => <View style={{height: 10}} />}
        renderItem={({item}) => {
          const palette = statusPalette(item.status);
          const statusLabel = STATUS_LABEL[item.status] ?? item.status;
          const isAwaitingYou =
            (item.status ?? '').toUpperCase() === 'AWAITING_CUSTOMER';

          return (
            <View className="px-5">
              <TouchableOpacity
                className="rounded-2xl p-4"
                style={{backgroundColor: C.surface}}
                onPress={() =>
                  nav.navigate('TicketDetail', {ticketId: item.id})
                }
                activeOpacity={0.85}>
                {/* Top: status pill + time-ago */}
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <View
                      className="rounded-full px-2.5 py-1 flex-row items-center"
                      style={{backgroundColor: palette.bg}}>
                      <View
                        className="w-1.5 h-1.5 rounded-full mr-1.5"
                        style={{backgroundColor: palette.ring}}
                      />
                      <Text
                        className="text-[10px] font-bold"
                        style={{color: palette.fg, letterSpacing: 1.2}}>
                        {statusLabel.toUpperCase()}
                      </Text>
                    </View>
                    {isAwaitingYou ? (
                      <View
                        className="rounded-full px-1.5 ml-1.5 flex-row items-center"
                        style={{backgroundColor: C.coral}}>
                        <Text
                          className="text-[9px] font-bold text-white"
                          style={{letterSpacing: 0.3}}>
                          REPLY NEEDED
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    className="text-[10px]"
                    style={{color: C.textTertiary}}>
                    {timeAgo(item.lastMessageAt)}
                  </Text>
                </View>

                {/* Subject */}
                <Text
                  className="text-sm font-bold mb-1"
                  style={{
                    color: C.ink,
                    letterSpacing: -0.2,
                    lineHeight: 18,
                  }}
                  numberOfLines={2}>
                  {item.subject}
                </Text>

                {/* Footer meta */}
                <View className="flex-row items-center mt-2">
                  <MessageCircle color={C.textTertiary} size={11} />
                  <Text
                    className="text-[11px] ml-1.5 flex-1"
                    style={{color: C.textSecondary}}>
                    Ticket #{item.ticketNumber}
                  </Text>
                  <ChevronRight color={C.textMuted} size={14} />
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          tickets.length > 0 ? (
            <View className="items-center py-12 px-6">
              <View
                className="w-16 h-16 rounded-full items-center justify-center mb-3"
                style={{backgroundColor: C.surfaceWarm}}>
                <MessageCircle color={C.textMuted} size={26} />
              </View>
              <Text
                className="text-sm font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                No {filter.toLowerCase()} conversations
              </Text>
              <Text
                className="text-[11px] text-center mt-1"
                style={{color: C.textTertiary}}>
                Switch the filter above to see other tickets.
              </Text>
            </View>
          ) : (
            <View className="px-5 pt-5">
              <View
                className="rounded-2xl p-6 items-center"
                style={{backgroundColor: C.surface}}>
                <View
                  className="w-20 h-20 rounded-full items-center justify-center mb-4"
                  style={{backgroundColor: C.surfaceSage}}>
                  <MessageCircle color={C.sageDeep} size={32} />
                </View>
                <Text
                  className="text-lg font-black mb-2"
                  style={{color: C.ink, letterSpacing: -0.5}}>
                  No conversations yet
                </Text>
                <Text
                  className="text-xs text-center mb-5 leading-5"
                  style={{color: C.textSecondary, maxWidth: 280}}>
                  Start a chat and our team will reply within 30 minutes
                  during support hours.
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
                      className="px-6 py-2.5 flex-row items-center"
                      onPress={() => nav.navigate('CreateTicket', {})}
                      activeOpacity={0.85}>
                      <Plus color="white" size={13} />
                      <Text
                        className="text-xs font-bold text-white ml-1.5"
                        style={{letterSpacing: -0.1}}>
                        Start a conversation
                      </Text>
                    </TouchableOpacity>
                  </Gradient>
                </View>
              </View>
            </View>
          )
        }
      />

      {/* ── Sticky bottom New conversation CTA ─────────────────── */}
      {tickets.length > 0 ? (
        <View
          className="absolute bottom-0 left-0 right-0 px-5 pt-3 pb-4"
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
          {openCount > 0 ? (
            <View className="flex-row items-center mb-2">
              <View
                className="w-1.5 h-1.5 rounded-full mr-1.5"
                style={{backgroundColor: C.gold}}
              />
              <Text
                className="text-[10px] font-bold"
                style={{color: C.goldDeep, letterSpacing: 0.3}}>
                {openCount}{' '}
                {openCount === 1 ? 'CONVERSATION' : 'CONVERSATIONS'}{' '}
                STILL OPEN
              </Text>
            </View>
          ) : null}
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
                className="py-3.5 flex-row items-center justify-center"
                onPress={() => nav.navigate('CreateTicket', {})}
                activeOpacity={0.85}>
                <Plus color="white" size={15} />
                <Text
                  className="text-sm font-bold text-white ml-2"
                  style={{letterSpacing: -0.2}}>
                  Start new conversation
                </Text>
              </TouchableOpacity>
            </Gradient>
          </View>
        </View>
      ) : null}
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
          GOT A QUESTION
        </Text>
        <Text
          className="font-black"
          style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
          Help & support
        </Text>
      </View>
      {count > 0 ? (
        <View
          className="rounded-full px-2.5 py-1 flex-row items-center"
          style={{backgroundColor: C.surfaceSage}}>
          <MessageCircle color={C.sageDeep} size={10} />
          <Text
            className="text-[11px] font-bold ml-1"
            style={{color: C.sageDeep}}>
            {count}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ContactTile({
  Icon,
  label,
  sub,
  tint,
  accent,
  onPress,
}: {
  Icon: typeof Phone;
  label: string;
  sub: string;
  tint: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className="flex-1 rounded-2xl p-3 items-center"
      style={{backgroundColor: C.surface}}
      onPress={onPress}
      activeOpacity={0.7}>
      <View
        className="w-12 h-12 rounded-2xl items-center justify-center mb-2"
        style={{backgroundColor: tint}}>
        <Icon color={accent} size={20} />
      </View>
      <Text
        className="text-[11px] font-bold"
        style={{color: C.ink, letterSpacing: -0.1}}>
        {label}
      </Text>
      <Text
        className="text-[9px] mt-0.5"
        style={{color: C.textTertiary}}>
        {sub}
      </Text>
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
