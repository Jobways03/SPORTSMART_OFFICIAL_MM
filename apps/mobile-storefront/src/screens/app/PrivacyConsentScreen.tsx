import React, {useState} from 'react';
import {ScrollView, Switch, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {ChevronLeft, ChevronRight, Clock, Download} from 'lucide-react-native';
import {showAlert} from '../../lib/dialog';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {useConsent} from '../../queries/useConsent';
import {queryKeys} from '../../queries/keys';
import {
  CONSENT_PURPOSES,
  ConsentPurpose,
  consentService,
} from '../../services/consent.service';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'PrivacyConsent'>;

const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceCoral: '#fee2e2',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',
  sage: '#ef4444',
  sageDeep: '#dc2626',
};

const GROUPS: {key: ConsentPurpose['group']; label: string}[] = [
  {key: 'marketing', label: 'MARKETING MESSAGES'},
  {key: 'cookies', label: 'ANALYTICS & PERSONALISATION'},
];

export function PrivacyConsentScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const query = useConsent();
  const snapshot = query.data ?? {};
  const [pending, setPending] = useState<string | null>(null);

  const mutate = useMutation({
    mutationFn: ({purpose, granted}: {purpose: string; granted: boolean}) =>
      consentService.set(purpose, granted),
  });

  const onToggle = (purpose: string, granted: boolean) => {
    setPending(purpose);
    mutate.mutate(
      {purpose, granted},
      {
        onSuccess: res => {
          if (!res.success) {
            showAlert('Could not update', res.message || 'Try again.');
          }
          qc.invalidateQueries({queryKey: queryKeys.consent()});
        },
        onError: err =>
          showAlert(
            'Could not update',
            err instanceof Error ? err.message : 'Try again.',
          ),
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <View
        className="flex-row items-center px-4 py-3"
        style={{backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border}}>
        <TouchableOpacity
          onPress={() => nav.goBack()}
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{backgroundColor: C.surfaceWarm}}
          activeOpacity={0.7}>
          <ChevronLeft color={C.ink} size={20} />
        </TouchableOpacity>
        <View className="flex-1 ml-3">
          <Text className="text-[10px] font-bold tracking-widest" style={{color: C.sageDeep, letterSpacing: 2}}>
            DPDP · YOUR CHOICES
          </Text>
          <Text className="font-black" style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
            Privacy & consent
          </Text>
        </View>
      </View>

      {query.isLoading ? (
        <Spinner fullscreen />
      ) : query.isError ? (
        <ErrorState title="Couldn't load your choices" onRetry={() => query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{padding: 20, paddingBottom: 40}} showsVerticalScrollIndicator={false}>
          <Text className="text-[11px] mb-4 px-1" style={{color: C.textSecondary, lineHeight: 16}}>
            Control how Sportsmart contacts you and uses your data. Order and
            account notifications are always sent — these toggles cover
            marketing and analytics only.
          </Text>

          {GROUPS.map(group => {
            const items = CONSENT_PURPOSES.filter(p => p.group === group.key);
            if (items.length === 0) return null;
            return (
              <View key={group.key} className="mb-5">
                <Text className="text-[10px] font-bold tracking-widest mb-2 px-1" style={{color: C.textTertiary, letterSpacing: 1.8}}>
                  {group.label}
                </Text>
                <View className="rounded-2xl overflow-hidden" style={{backgroundColor: C.surface}}>
                  {items.map((p, idx) => {
                    const granted = snapshot[p.key]?.granted ?? false;
                    return (
                      <View
                        key={p.key}
                        className="px-4 py-3.5 flex-row items-center"
                        style={idx < items.length - 1 ? {borderBottomWidth: 1, borderBottomColor: C.border} : undefined}>
                        <View className="flex-1 mr-3">
                          <Text className="text-sm font-bold" style={{color: C.ink, letterSpacing: -0.2}}>
                            {p.title}
                          </Text>
                          <Text className="text-[11px] mt-0.5" style={{color: C.textTertiary}}>
                            {p.description}
                          </Text>
                        </View>
                        <Switch
                          value={granted}
                          disabled={pending === p.key}
                          onValueChange={v => onToggle(p.key, v)}
                          trackColor={{false: '#d4d4d8', true: C.sage}}
                          thumbColor="#ffffff"
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}

          {/* Related privacy tools */}
          <Text className="text-[10px] font-bold tracking-widest mb-2 px-1" style={{color: C.textTertiary, letterSpacing: 1.8}}>
            YOUR DATA
          </Text>
          <View className="rounded-2xl overflow-hidden" style={{backgroundColor: C.surface}}>
            <ToolRow
              icon={Download}
              label="Download my data"
              hint="Export your account data (DPDP)"
              onPress={() => nav.navigate('DataExport')}
            />
            <ToolRow
              testID="tool-access-history"
              icon={Clock}
              label="Sign-in activity"
              hint="Recent logins and devices"
              onPress={() => nav.navigate('AccessHistory')}
              last
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ToolRow({
  icon: Icon,
  label,
  hint,
  onPress,
  last,
  testID,
}: {
  icon: typeof Download;
  label: string;
  hint: string;
  onPress: () => void;
  last?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      className="px-4 py-3.5 flex-row items-center"
      style={last ? undefined : {borderBottomWidth: 1, borderBottomColor: C.border}}
      onPress={onPress}
      activeOpacity={0.7}>
      <View className="w-10 h-10 rounded-xl items-center justify-center mr-3" style={{backgroundColor: C.surfaceCoral}}>
        <Icon color={C.sageDeep} size={17} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-bold" style={{color: C.ink, letterSpacing: -0.2}}>
          {label}
        </Text>
        <Text className="text-[11px] mt-0.5" style={{color: C.textTertiary}}>
          {hint}
        </Text>
      </View>
      <ChevronRight color={C.textMuted} size={16} />
    </TouchableOpacity>
  );
}
