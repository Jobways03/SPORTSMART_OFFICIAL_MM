import React, {useMemo, useState} from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
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
  CheckCheck,
  ChevronLeft,
  Clock,
  Headphones,
  MoreVertical,
  Paperclip,
  Send,
  Smile,
  XCircle,
} from 'lucide-react-native';
import {
  useCloseTicket,
  useReplyToTicket,
  useTicket,
} from '../../queries/useSupport';
import {STATUS_LABEL} from '../../services/support.service';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'TicketDetail'>;
type Route = RouteProp<AccountStackParamList, 'TicketDetail'>;

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

function statusPalette(status: string): {bg: string; fg: string; ring: string} {
  const s = status.toUpperCase();
  if (s === 'RESOLVED' || s === 'CLOSED') {
    return {bg: C.surfaceSage, fg: C.sageDeep, ring: C.sage};
  }
  if (s === 'AWAITING_CUSTOMER') {
    return {bg: C.surfaceCoral, fg: C.coralDeep, ring: C.coral};
  }
  if (s === 'IN_PROGRESS' || s === 'AWAITING_AGENT') {
    return {bg: C.surfaceMauve, fg: C.inkSoft, ring: C.gold};
  }
  return {bg: C.surfaceGold, fg: C.goldDeep, ring: C.gold};
}

const TERMINAL_STATUSES = new Set(['RESOLVED', 'CLOSED']);

const QUICK_REPLIES = [
  '👍 Thanks',
  'Still waiting',
  'Issue resolved',
  'Need more help',
];

function formatBubbleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDayLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayStart = new Date(d);
    dayStart.setHours(0, 0, 0, 0);
    const diffDays = Math.round(
      (today.getTime() - dayStart.getTime()) / 86_400_000,
    );
    if (diffDays === 0) return 'TODAY';
    if (diffDays === 1) return 'YESTERDAY';
    return d
      .toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
      .toUpperCase();
  } catch {
    return '';
  }
}

export function TicketDetailScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const query = useTicket(params.ticketId);
  const reply = useReplyToTicket();
  const close = useCloseTicket();
  const [draft, setDraft] = useState('');

  // useMemo BEFORE the conditional returns. `messages` falls back to
  // an empty array while loading so the grouping still produces a
  // (empty) result without crashing.
  const messages = query.data?.messages ?? [];
  const grouped = useMemo(() => {
    const groups: Array<{day: string; items: typeof messages}> = [];
    for (const msg of messages) {
      const day = formatDayLabel(msg.createdAt);
      const last = groups[groups.length - 1];
      if (!last || last.day !== day) {
        groups.push({day, items: [msg]});
      } else {
        last.items.push(msg);
      }
    }
    return groups;
  }, [messages]);

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
          title="Couldn't load this ticket"
          onRetry={query.refetch}
        />
      </SafeAreaView>
    );
  }

  const {ticket, category} = query.data;
  const palette = statusPalette(ticket.status);
  const isClosed = TERMINAL_STATUSES.has(ticket.status);

  const onSend = (text?: string) => {
    const body = (text ?? draft).trim();
    if (!body) return;
    reply.mutate(
      {ticketId: ticket.id, body},
      {
        onSuccess: () => setDraft(''),
        onError: err =>
          showAlert(
            'Could not send',
            err instanceof Error ? err.message : 'Try again.',
          ),
      },
    );
  };

  const onClose = () => {
    showAlert(
      'Close this ticket?',
      'You can always start a new one if you need more help.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Close ticket',
          style: 'destructive',
          onPress: () =>
            close.mutate(ticket.id, {
              onError: err =>
                showAlert(
                  'Could not close',
                  err instanceof Error ? err.message : 'Try again.',
                ),
            }),
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
            #{ticket.ticketNumber}
          </Text>
          <Text
            className="font-bold"
            style={{color: C.ink, fontSize: 15, letterSpacing: -0.3}}
            numberOfLines={1}>
            {ticket.subject}
          </Text>
        </View>
        {!isClosed ? (
          <TouchableOpacity
            onPress={onClose}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{backgroundColor: C.surfaceWarm}}
            disabled={close.isPending}
            accessibilityLabel="Close ticket">
            <MoreVertical color={C.ink} size={17} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Status / agent strip ─────────────────────────────── */}
      <View
        className="px-5 py-3 flex-row items-center"
        style={{
          backgroundColor: C.surface,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}>
        <View
          className="w-9 h-9 rounded-full items-center justify-center mr-3"
          style={{backgroundColor: C.surfaceSage}}>
          <Headphones color={C.sageDeep} size={16} />
        </View>
        <View className="flex-1">
          <Text
            className="text-xs font-bold"
            style={{color: C.ink, letterSpacing: -0.2}}>
            Sportsmart support
          </Text>
          <View className="flex-row items-center mt-0.5">
            {category ? (
              <Text
                className="text-[10px]"
                style={{color: C.textTertiary}}>
                {category.name} ·{' '}
              </Text>
            ) : null}
            <View
              className="w-1.5 h-1.5 rounded-full mr-1"
              style={{backgroundColor: isClosed ? C.sage : C.gold}}
            />
            <Text
              className="text-[10px] font-semibold"
              style={{color: isClosed ? C.sageDeep : C.goldDeep}}>
              {isClosed ? 'Resolved' : 'Active'}
            </Text>
          </View>
        </View>
        <View
          className="rounded-full px-2.5 py-1 flex-row items-center"
          style={{backgroundColor: palette.bg}}>
          <Text
            className="text-[10px] font-bold"
            style={{color: palette.fg, letterSpacing: 1}}>
            {STATUS_LABEL[ticket.status]?.toUpperCase() ??
              ticket.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}>
        <ScrollView
          contentContainerStyle={{padding: 16, paddingBottom: 24}}
          keyboardShouldPersistTaps="handled">
          {grouped.map(group => (
            <View key={group.day}>
              {/* Day separator */}
              <View className="items-center my-3">
                <View
                  className="rounded-full px-3 py-1"
                  style={{backgroundColor: C.surfaceWarm}}>
                  <Text
                    className="text-[10px] font-bold"
                    style={{color: C.textTertiary, letterSpacing: 1}}>
                    {group.day}
                  </Text>
                </View>
              </View>

              {group.items.map((msg, idx) => {
                const isCustomer = msg.senderType === 'CUSTOMER';
                const senderInitial =
                  (msg.senderName?.[0] ?? '').toUpperCase() ||
                  (isCustomer ? 'Y' : 'S');
                // Only show the avatar on agent messages where the
                // previous message in this day isn't from the same
                // agent — keeps consecutive bubbles visually grouped.
                const prev = group.items[idx - 1];
                const showAgentAvatar =
                  !isCustomer &&
                  (!prev || prev.senderType === 'CUSTOMER');

                return (
                  <View
                    key={msg.id}
                    className={`flex-row mb-2 ${
                      isCustomer ? 'justify-end' : 'justify-start'
                    }`}>
                    {/* Agent avatar (only first in a streak) */}
                    {!isCustomer ? (
                      <View
                        className="mr-2 mt-auto"
                        style={{width: 28, height: 28}}>
                        {showAgentAvatar ? (
                          <View
                            className="w-7 h-7 rounded-full items-center justify-center"
                            style={{backgroundColor: C.surfaceSage}}>
                            <Text
                              className="text-[11px] font-black"
                              style={{color: C.sageDeep}}>
                              {senderInitial}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    <View style={{maxWidth: '78%'}}>
                      {/* Sender name (agent only, first of streak) */}
                      {!isCustomer && showAgentAvatar && msg.senderName ? (
                        <Text
                          className="text-[10px] font-bold mb-1 ml-1"
                          style={{color: C.sageDeep, letterSpacing: 0.2}}>
                          {msg.senderName}
                        </Text>
                      ) : null}

                      <View
                        className="px-4 py-2.5"
                        style={{
                          backgroundColor: isCustomer
                            ? C.ink
                            : C.surface,
                          borderTopLeftRadius: 16,
                          borderTopRightRadius: 16,
                          borderBottomLeftRadius: isCustomer ? 16 : 4,
                          borderBottomRightRadius: isCustomer ? 4 : 16,
                          borderWidth: isCustomer ? 0 : 1,
                          borderColor: C.border,
                        }}>
                        <Text
                          className="text-sm"
                          style={{
                            color: isCustomer ? 'white' : C.ink,
                            lineHeight: 19,
                          }}>
                          {msg.body}
                        </Text>
                      </View>

                      {/* Footer: time + read receipt */}
                      <View
                        className={`flex-row items-center mt-1 ${
                          isCustomer ? 'justify-end' : 'justify-start'
                        }`}>
                        <Text
                          className="text-[10px]"
                          style={{color: C.textMuted}}>
                          {formatBubbleTime(msg.createdAt)}
                        </Text>
                        {isCustomer ? (
                          <CheckCheck
                            color={C.sageDeep}
                            size={11}
                            style={{marginLeft: 4}}
                          />
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}

          {/* Closed banner */}
          {isClosed ? (
            <View className="items-center mt-4">
              <View
                className="rounded-2xl px-4 py-3 flex-row items-center"
                style={{backgroundColor: C.surfaceSage}}>
                <CheckCheck color={C.sageDeep} size={14} />
                <Text
                  className="text-[11px] font-bold ml-2"
                  style={{color: C.sageDeep, letterSpacing: 0.3}}>
                  Conversation {ticket.status.toLowerCase()}
                </Text>
              </View>
            </View>
          ) : null}
        </ScrollView>

        {/* ── Quick reply chips + composer ────────────────────── */}
        {!isClosed ? (
          <View
            style={{
              backgroundColor: C.surface,
              borderTopWidth: 1,
              borderTopColor: C.border,
            }}>
            {/* Quick reply chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 8,
                paddingBottom: 4,
                gap: 6,
              }}>
              {QUICK_REPLIES.map(text => (
                <TouchableOpacity
                  key={text}
                  className="rounded-full px-3 py-1.5"
                  style={{
                    backgroundColor: C.surfaceWarm,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}
                  onPress={() => onSend(text)}
                  disabled={reply.isPending}
                  activeOpacity={0.7}>
                  <Text
                    className="text-[11px] font-semibold"
                    style={{color: C.ink}}>
                    {text}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Composer */}
            <View
              className="flex-row items-end px-3 py-2"
              style={{gap: 8}}>
              <TouchableOpacity
                className="w-10 h-10 rounded-full items-center justify-center"
                style={{backgroundColor: C.surfaceWarm}}
                activeOpacity={0.7}>
                <Paperclip color={C.textTertiary} size={17} />
              </TouchableOpacity>
              <View
                className="flex-1 rounded-3xl px-4 py-2 flex-row items-center"
                style={{
                  backgroundColor: C.surfaceWarm,
                  minHeight: 40,
                  maxHeight: 120,
                }}>
                <TextInput
                  className="flex-1 text-sm"
                  style={{
                    color: C.ink,
                    paddingVertical: 6,
                    maxHeight: 100,
                  }}
                  placeholder="Type a reply…"
                  placeholderTextColor={C.textMuted}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  editable={!reply.isPending}
                />
                <TouchableOpacity className="ml-2" activeOpacity={0.7}>
                  <Smile color={C.textTertiary} size={17} />
                </TouchableOpacity>
              </View>
              {/* Send button — gradient circle when there's a draft
                  to send, flat muted otherwise. Matches the funnel
                  CTA grammar in pill form. */}
              {draft.trim() && !reply.isPending ? (
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    overflow: 'hidden',
                    shadowColor: C.sageDeep,
                    shadowOpacity: 0.32,
                    shadowOffset: {width: 0, height: 4},
                    shadowRadius: 8,
                    elevation: 5,
                  }}>
                  <Gradient
                    colors={[C.sageDeep, C.ink]}
                    angle={135}
                    borderRadius={22}
                    style={{
                      width: '100%',
                      height: '100%',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        width: '100%',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      onPress={() => onSend()}
                      activeOpacity={0.85}
                      accessibilityLabel="Send">
                      <Send color="white" size={16} />
                    </TouchableOpacity>
                  </Gradient>
                </View>
              ) : (
                <TouchableOpacity
                  className="w-11 h-11 rounded-full items-center justify-center"
                  style={{backgroundColor: C.textMuted}}
                  disabled
                  activeOpacity={1}
                  accessibilityLabel="Send">
                  {reply.isPending ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Send color="white" size={16} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        ) : (
          <View
            className="px-5 pt-4 pb-4 items-center"
            style={{
              backgroundColor: C.surface,
              borderTopWidth: 1,
              borderTopColor: C.border,
            }}>
            <Text
              className="text-xs text-center mb-3"
              style={{color: C.textTertiary}}>
              This conversation is {ticket.status.toLowerCase()}. Need more
              help?
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
                  onPress={() => nav.navigate('CreateTicket', {})}
                  activeOpacity={0.85}>
                  <Text
                    className="text-xs font-bold text-white"
                    style={{letterSpacing: -0.1}}>
                    Start a new conversation
                  </Text>
                </TouchableOpacity>
              </Gradient>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
