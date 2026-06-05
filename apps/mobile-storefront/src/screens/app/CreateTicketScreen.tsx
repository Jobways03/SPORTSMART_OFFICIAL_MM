import React, {useState} from 'react';
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
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gradient} from '../../components/Gradient';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {
  ArrowRight,
  ChevronLeft,
  MessageSquare,
  Package,
  RotateCcw,
  Tag,
} from 'lucide-react-native';
import {useCreateTicket, useTicketCategories} from '../../queries/useSupport';
import {showAlert} from '../../lib/dialog';
import {PRIORITY_LABEL} from '../../services/support.service';
import type {TicketPriority} from '../../services/support.service';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'CreateTicket'>;
type Route = RouteProp<AccountStackParamList, 'CreateTicket'>;

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

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

const SUBJECT_MAX = 120;
const BODY_MAX = 2000;

// Priority colour key — used both for the segmented chip and a tiny
// helper text below so people understand the consequence of "URGENT".
const PRIORITY_TINT: Record<TicketPriority, {bg: string; fg: string}> = {
  LOW: {bg: C.surfaceSage, fg: C.sageDeep},
  NORMAL: {bg: C.surfaceWarm, fg: C.inkSoft},
  HIGH: {bg: C.surfaceGold, fg: C.goldDeep},
  URGENT: {bg: C.surfaceCoral, fg: C.coralDeep},
};

export function CreateTicketScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const categoriesQuery = useTicketCategories();
  const create = useCreateTicket();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('NORMAL');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);

  const categories = (categoriesQuery.data ?? []).filter(
    c => c.active && (c.scopedTo == null || c.scopedTo === 'CUSTOMER'),
  );

  const onSubmit = () => {
    if (!subject.trim() || !body.trim()) {
      showAlert('Missing info', 'Subject and message are required.');
      return;
    }
    create.mutate(
      {
        subject: subject.trim(),
        body: body.trim(),
        priority,
        categoryId,
        relatedOrderNumber: params.relatedOrderNumber,
        relatedReturnNumber: params.relatedReturnNumber,
      },
      {
        onSuccess: res => {
          // Replace the create screen on the stack with the new ticket
          // so back goes to the tickets list, not back to the form.
          if (res.data) {
            nav.replace('TicketDetail', {ticketId: res.data.id});
          } else {
            nav.goBack();
          }
        },
        onError: err =>
          showAlert(
            'Could not create',
            err instanceof Error ? err.message : 'Try again.',
          ),
      },
    );
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
          New request
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{paddingBottom: 40}}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* ── Hero card — dark gradient service surface ────── */}
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
                    <MessageSquare color="white" size={20} />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="font-black"
                      style={{
                        color: 'white',
                        fontSize: 20,
                        letterSpacing: -0.5,
                      }}>
                      Tell us what's up
                    </Text>
                    <Text
                      className="text-xs mt-1"
                      style={{
                        color: 'rgba(255,255,255,0.78)',
                        lineHeight: 16,
                      }}>
                      Most requests get a first reply within 4
                      working hours.
                    </Text>
                  </View>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── Linked order / return chip ───────────────────── */}
          {params.relatedOrderNumber || params.relatedReturnNumber ? (
            <View className="px-5 pt-4">
              <View
                className="rounded-2xl p-4 flex-row items-center"
                style={{
                  backgroundColor: params.relatedOrderNumber
                    ? C.surfaceCoral
                    : C.surfaceMauve,
                }}>
                <View
                  className="w-9 h-9 rounded-xl items-center justify-center mr-3"
                  style={{
                    backgroundColor: params.relatedOrderNumber
                      ? C.coralDeep
                      : C.goldDeep,
                  }}>
                  {params.relatedOrderNumber ? (
                    <Package color="white" size={16} />
                  ) : (
                    <RotateCcw color="white" size={16} />
                  )}
                </View>
                <View className="flex-1">
                  <Text
                    className="text-[10px] font-bold tracking-widest"
                    style={{
                      color: params.relatedOrderNumber
                        ? C.coralDeep
                        : C.goldDeep,
                      letterSpacing: 1.5,
                    }}>
                    {params.relatedOrderNumber
                      ? 'ABOUT ORDER'
                      : 'ABOUT RETURN'}
                  </Text>
                  <Text
                    className="text-sm font-bold mt-0.5"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    #
                    {params.relatedOrderNumber ??
                      params.relatedReturnNumber}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* ── Subject ─────────────────────────────────────── */}
          <View className="px-5 pt-5">
            <Text
              className="text-[10px] font-bold tracking-widest mb-2 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              SUBJECT
            </Text>
            <View
              className="rounded-2xl px-4 py-3"
              style={{backgroundColor: C.surface, minHeight: 56}}>
              <TextInput
                className="text-base"
                style={{color: C.ink, minHeight: 32}}
                value={subject}
                onChangeText={setSubject}
                placeholder="Short summary of the issue"
                placeholderTextColor={C.textMuted}
                maxLength={SUBJECT_MAX}
                editable={!create.isPending}
              />
            </View>
            <Text
              className="text-[10px] mt-1.5 self-end pr-1"
              style={{color: C.textMuted}}>
              {subject.length}/{SUBJECT_MAX}
            </Text>
          </View>

          {/* ── Category ────────────────────────────────────── */}
          {categories.length > 0 ? (
            <View className="px-5 pt-2">
              <Text
                className="text-[10px] font-bold tracking-widest mb-2 px-1"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                CATEGORY (OPTIONAL)
              </Text>
              <View className="flex-row flex-wrap" style={{gap: 8}}>
                {categories.map(c => {
                  const selected = c.id === categoryId;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      className="rounded-full px-3.5 py-2 flex-row items-center"
                      style={{
                        backgroundColor: selected ? C.sage : C.surface,
                      }}
                      onPress={() =>
                        setCategoryId(selected ? undefined : c.id)
                      }
                      activeOpacity={0.7}>
                      <Tag
                        color={selected ? 'white' : C.textTertiary}
                        size={11}
                      />
                      <Text
                        className="text-xs font-bold ml-1.5"
                        style={{
                          color: selected ? 'white' : C.ink,
                          letterSpacing: -0.1,
                        }}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* ── Priority ────────────────────────────────────── */}
          <View className="px-5 pt-5">
            <Text
              className="text-[10px] font-bold tracking-widest mb-2 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              PRIORITY
            </Text>
            <View
              className="rounded-2xl p-1 flex-row"
              style={{backgroundColor: C.surface}}>
              {PRIORITIES.map(p => {
                const selected = p === priority;
                const tint = PRIORITY_TINT[p];
                return (
                  <TouchableOpacity
                    key={p}
                    className="flex-1 rounded-xl py-2.5 items-center"
                    style={{
                      backgroundColor: selected ? tint.bg : 'transparent',
                    }}
                    onPress={() => setPriority(p)}
                    activeOpacity={0.7}>
                    <Text
                      className="text-[11px] font-bold"
                      style={{
                        color: selected ? tint.fg : C.textTertiary,
                        letterSpacing: 0.2,
                      }}>
                      {PRIORITY_LABEL[p]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {priority === 'URGENT' ? (
              <Text
                className="text-[11px] mt-2 px-1"
                style={{color: C.coralDeep}}>
                Urgent is for active outages or order-blocking issues.
                Please don't use it for general questions.
              </Text>
            ) : null}
          </View>

          {/* ── Message ─────────────────────────────────────── */}
          <View className="px-5 pt-5">
            <Text
              className="text-[10px] font-bold tracking-widest mb-2 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              MESSAGE
            </Text>
            <View
              className="rounded-2xl px-4 py-3"
              style={{backgroundColor: C.surface, minHeight: 140}}>
              <TextInput
                className="text-base"
                style={{color: C.ink, minHeight: 120, textAlignVertical: 'top'}}
                value={body}
                onChangeText={setBody}
                placeholder="Describe the issue with as much detail as you can. Include order IDs, dates, or screenshots if relevant."
                placeholderTextColor={C.textMuted}
                multiline
                maxLength={BODY_MAX}
                editable={!create.isPending}
              />
            </View>
            <Text
              className="text-[10px] mt-1.5 self-end pr-1"
              style={{color: C.textMuted}}>
              {body.length}/{BODY_MAX}
            </Text>
          </View>

          {/* ── CTA ─────────────────────────────────────────── */}
          <View className="px-5 pt-6">
            {create.isPending ? (
              <TouchableOpacity
                className="rounded-full py-4 flex-row items-center justify-center"
                style={{backgroundColor: C.textMuted}}
                disabled
                activeOpacity={1}>
                <ActivityIndicator color="white" />
              </TouchableOpacity>
            ) : (
              <View
                style={{
                  borderRadius: 999,
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
                  borderRadius={999}>
                  <TouchableOpacity
                    className="py-4 flex-row items-center justify-center"
                    onPress={onSubmit}
                    activeOpacity={0.85}>
                    <Text
                      className="text-sm font-bold text-white mr-1.5"
                      style={{letterSpacing: 0.3}}>
                      Send request
                    </Text>
                    <ArrowRight color="white" size={14} />
                  </TouchableOpacity>
                </Gradient>
              </View>
            )}
            <Text
              className="text-[11px] text-center mt-3 px-4"
              style={{color: C.textTertiary, lineHeight: 16}}>
              We'll notify you on email and in-app when our team responds.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
