import React, {useState} from 'react';
import {ScrollView, Switch, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gradient} from '../../components/Gradient';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {LucideIcon} from 'lucide-react-native';
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageCircle,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react-native';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '../../queries/useNotificationPreferences';
import {
  CHANNEL_LABEL,
  EVENT_CLASS_LABEL,
  NotificationChannel,
} from '../../services/notification-preferences.service';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<
  AccountStackParamList,
  'NotificationPreferences'
>;

const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceSage: '#f5f5f5',
  surfaceCoral: '#fee2e2',
  surfaceGold: '#fecaca',
  surfaceMauve: '#e4e4e7',
  // Lightest shade of the brand red (≈ Tailwind red-50) — the single,
  // consistent tint behind every notification category header.
  surfaceTint: '#fef2f2',
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

const CHANNEL_META: Record<
  NotificationChannel,
  {Icon: LucideIcon; tint: string; fg: string}
> = {
  EMAIL: {Icon: Mail, tint: C.surfaceSage, fg: C.sageDeep},
  SMS: {Icon: MessageSquare, tint: C.surfaceWarm, fg: C.goldDeep},
  WHATSAPP: {Icon: MessageCircle, tint: C.surfaceCoral, fg: C.coralDeep},
};

// Every category header shares one consistent, on-brand tint
// (C.surfaceTint — the lightest shade of the app's primary red) so the
// list reads as uniform instead of a rainbow of per-row colours.

export function NotificationPreferencesScreen() {
  const nav = useNavigation<Nav>();
  const query = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  // Which event-class groups are expanded. Collapsed by default so the
  // page reads as a compact list of categories; tap a header to reveal
  // that group's per-channel toggles.
  const [openClasses, setOpenClasses] = useState<Set<string>>(new Set());
  const toggleClass = (eventClass: string) =>
    setOpenClasses(prev => {
      const next = new Set(prev);
      if (next.has(eventClass)) next.delete(eventClass);
      else next.add(eventClass);
      return next;
    });

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

  const data = query.data!;
  const groups = data.eventClasses.map(eventClass => ({
    eventClass,
    rows: data.preferences.filter(p => p.eventClass === eventClass),
  }));

  const setEntry = (
    eventClass: string,
    channel: NotificationChannel,
    enabled: boolean,
  ) => {
    update.mutate([{eventClass, channel, enabled}]);
  };

  return (
    <SafeAreaView
      className="flex-1"
      style={{backgroundColor: C.bg}}
      edges={['top']}>
      {/* ── Header bar ───────────────────────────────────────── */}
      <View
        className="flex-row items-center px-3 py-2"
        style={{
          backgroundColor: C.bg,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}>
        <TouchableOpacity
          onPress={() => nav.goBack()}
          className="w-10 h-10 items-center justify-center rounded-full"
          activeOpacity={0.7}>
          <ChevronLeft color={C.ink} size={22} />
        </TouchableOpacity>
        <Text
          className="flex-1 font-bold ml-1"
          style={{color: C.ink, fontSize: 16, letterSpacing: -0.3}}>
          Notifications
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 40}}
        showsVerticalScrollIndicator={false}>
        {/* ── Hero — dark gradient utility surface ───────────── */}
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
                  width: 220,
                  height: 220,
                  right: -70,
                  bottom: -80,
                  backgroundColor: C.sage,
                  opacity: 0.28,
                }}
              />
              <View className="flex-row items-center p-5">
                <View
                  className="w-12 h-12 rounded-2xl items-center justify-center mr-4"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.16)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.28)',
                  }}>
                  <Bell color="white" size={20} />
                </View>
                <View className="flex-1">
                  <Text
                    className="font-black"
                    style={{
                      color: 'white',
                      fontSize: 20,
                      letterSpacing: -0.5,
                    }}>
                    Stay in the loop
                  </Text>
                  <Text
                    className="text-xs mt-1"
                    style={{
                      color: 'rgba(255,255,255,0.78)',
                      lineHeight: 16,
                    }}>
                    Pick what we send and where. Change any time.
                  </Text>
                </View>
              </View>
            </Gradient>
          </View>
        </View>

        {/* ── Channel legend ─────────────────────────────────── */}
        <View className="px-5 pt-4">
          <Text
            className="text-[10px] font-bold tracking-widest mb-2 px-1"
            style={{color: C.textTertiary, letterSpacing: 1.8}}>
            CHANNELS
          </Text>
          <View
            className="rounded-2xl p-3 flex-row justify-between"
            style={{backgroundColor: C.surface}}>
            {(Object.keys(CHANNEL_META) as NotificationChannel[]).map(ch => {
              const meta = CHANNEL_META[ch];
              return (
                <View key={ch} className="flex-row items-center flex-1">
                  <View
                    className="w-9 h-9 rounded-xl items-center justify-center mr-2.5"
                    style={{backgroundColor: meta.tint}}>
                    <meta.Icon color={meta.fg} size={15} />
                  </View>
                  <Text
                    className="text-xs font-bold"
                    style={{color: C.ink, letterSpacing: -0.1}}>
                    {CHANNEL_LABEL[ch]}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Event-class groups ──────────────────────────────── */}
        <View className="px-5 pt-5">
          <Text
            className="text-[10px] font-bold tracking-widest mb-2 px-1"
            style={{color: C.textTertiary, letterSpacing: 1.8}}>
            WHAT TO HEAR ABOUT
          </Text>
          {groups.map(group => {
            const meta = EVENT_CLASS_LABEL[group.eventClass] ?? {
              title: group.eventClass,
              desc: '',
            };
            const tint = C.surfaceTint;
            const isOpen = openClasses.has(group.eventClass);
            return (
              <View
                key={group.eventClass}
                className="rounded-2xl mb-3 overflow-hidden"
                style={{backgroundColor: C.surface}}>
                {/* Header — tap to expand this group's channel toggles. */}
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => toggleClass(group.eventClass)}
                  className="px-4 py-3.5 flex-row items-center"
                  style={{backgroundColor: tint}}>
                  <View className="flex-1">
                    <Text
                      className="text-sm font-bold"
                      style={{color: C.ink, letterSpacing: -0.2}}>
                      {meta.title}
                    </Text>
                    {meta.desc ? (
                      <Text
                        className="text-[11px] mt-0.5"
                        style={{color: C.inkSoft, lineHeight: 15}}>
                        {meta.desc}
                      </Text>
                    ) : null}
                  </View>
                  {/* Collapsed: mini preview of which channels are on. */}
                  {!isOpen ? (
                    <View
                      className="flex-row items-center mr-2"
                      style={{gap: 5}}>
                      {group.rows.map(row => {
                        const chMeta = CHANNEL_META[row.channel];
                        return (
                          <View
                            key={row.channel}
                            className="w-6 h-6 rounded-lg items-center justify-center"
                            style={{
                              backgroundColor: row.enabled
                                ? chMeta.tint
                                : 'transparent',
                              borderWidth: row.enabled ? 0 : 1,
                              borderColor: C.border,
                            }}>
                            <chMeta.Icon
                              color={row.enabled ? chMeta.fg : C.textMuted}
                              size={12}
                            />
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                  {isOpen ? (
                    <ChevronDown color={C.textTertiary} size={18} />
                  ) : (
                    <ChevronRight color={C.textTertiary} size={18} />
                  )}
                </TouchableOpacity>
                {/* Channel rows — shown only when the group is expanded. */}
                {isOpen
                  ? group.rows.map((row, idx) => {
                      const chMeta = CHANNEL_META[row.channel];
                      return (
                        <View
                          key={`${row.eventClass}:${row.channel}`}
                          className="flex-row items-center px-4 py-3"
                          style={
                            idx < group.rows.length - 1
                              ? {
                                  borderBottomWidth: 1,
                                  borderBottomColor: C.border,
                                }
                              : undefined
                          }>
                          <View
                            className="w-8 h-8 rounded-lg items-center justify-center mr-3"
                            style={{backgroundColor: chMeta.tint}}>
                            <chMeta.Icon color={chMeta.fg} size={14} />
                          </View>
                          <Text
                            className="text-sm font-medium flex-1"
                            style={{color: C.ink, letterSpacing: -0.1}}>
                            {CHANNEL_LABEL[row.channel]}
                          </Text>
                          <Switch
                            value={row.enabled}
                            onValueChange={v =>
                              setEntry(row.eventClass, row.channel, v)
                            }
                            disabled={update.isPending}
                            trackColor={{false: C.border, true: C.sage}}
                            thumbColor={row.enabled ? '#ffffff' : '#ffffff'}
                            ios_backgroundColor={C.border}
                          />
                        </View>
                      );
                    })
                  : null}
              </View>
            );
          })}
        </View>

        {/* ── Transactional disclaimer ────────────────────────── */}
        <View className="px-5 pt-2">
          <View
            className="rounded-2xl p-4 flex-row"
            style={{backgroundColor: C.surfaceWarm}}>
            <View
              className="w-9 h-9 rounded-xl items-center justify-center mr-3"
              style={{backgroundColor: C.gold}}>
              <ShieldCheck color="white" size={15} />
            </View>
            <View className="flex-1">
              <Text
                className="text-xs font-bold mb-1"
                style={{color: C.ink, letterSpacing: -0.2}}>
                Always-on for safety
              </Text>
              <Text
                className="text-[11px] leading-4"
                style={{color: C.inkSoft}}>
                Payment receipts, OTPs, and account-security alerts
                ignore these preferences.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
