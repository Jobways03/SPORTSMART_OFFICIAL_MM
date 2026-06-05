import React from 'react';
import {RefreshControl, ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ChevronLeft,
  LogIn,
  LogOut,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react-native';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {EmptyState} from '../../components/EmptyState';
import {useAccessHistory} from '../../queries/useAccessHistory';
import {
  AccessEventKind,
  KIND_LABEL,
  maskIp,
} from '../../services/access-history.service';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'AccessHistory'>;

const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceCoral: '#fee2e2',
  surfaceGreen: '#dcfce7',
  border: '#e4e4e7',
  ink: '#0a0a0a',
  textSecondary: '#52525b',
  textTertiary: '#71717a',
  textMuted: '#a1a1aa',
  sage: '#ef4444',
  sageDeep: '#dc2626',
  green: '#16a34a',
};

function iconFor(kind: AccessEventKind) {
  switch (kind) {
    case 'LOGIN_SUCCESS':
    case 'TOKEN_REFRESH':
      return LogIn;
    case 'LOGOUT':
    case 'LOGOUT_ALL_DEVICES':
      return LogOut;
    case 'NEW_DEVICE_DETECTED':
    case 'LOGIN_FAILURE':
      return ShieldAlert;
    default:
      return ShieldCheck;
  }
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function deviceLabel(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone|iPad|iOS/i.test(ua)) return 'iOS device';
  if (/Android/i.test(ua)) return 'Android device';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Web browser';
}

export function AccessHistoryScreen() {
  const nav = useNavigation<Nav>();
  const query = useAccessHistory();
  const items = query.data ?? [];

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
            SECURITY
          </Text>
          <Text className="font-black" style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
            Sign-in activity
          </Text>
        </View>
      </View>

      {query.isLoading ? (
        <Spinner fullscreen />
      ) : query.isError ? (
        <ErrorState title="Couldn't load activity" onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No activity yet" message="Recent sign-ins will appear here." />
      ) : (
        <ScrollView
          contentContainerStyle={{padding: 20, paddingBottom: 40}}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={C.sageDeep} />
          }>
          {items.map(e => {
            const Icon = iconFor(e.kind);
            const danger = e.kind === 'LOGIN_FAILURE' || e.kind === 'NEW_DEVICE_DETECTED';
            return (
              <View key={e.id} className="rounded-2xl p-4 mb-3 flex-row items-center" style={{backgroundColor: C.surface}}>
                <View
                  className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                  style={{backgroundColor: danger ? C.surfaceCoral : C.surfaceGreen}}>
                  <Icon color={danger ? C.sageDeep : C.green} size={17} />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center">
                    <Text className="text-sm font-bold" style={{color: C.ink, letterSpacing: -0.2}}>
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </Text>
                    {e.newDevice ? (
                      <View className="ml-2 rounded-full px-1.5 py-0.5" style={{backgroundColor: C.surfaceCoral}}>
                        <Text className="text-[9px] font-bold" style={{color: C.sageDeep, letterSpacing: 0.3}}>
                          NEW DEVICE
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="text-[11px] mt-0.5" style={{color: C.textSecondary}}>
                    {deviceLabel(e.userAgent)} · {maskIp(e.ipAddress)}
                  </Text>
                  <Text className="text-[10px] mt-0.5" style={{color: C.textTertiary}}>
                    {formatWhen(e.createdAt)}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
