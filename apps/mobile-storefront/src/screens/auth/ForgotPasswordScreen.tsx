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
import {showAlert} from '../../lib/dialog';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowRight,
  ChevronLeft,
  KeyRound,
  Mail,
} from 'lucide-react-native';
import {useMutation} from '@tanstack/react-query';
import {authService} from '../../services/auth.service';
import {Gradient} from '../../components/Gradient';
import type {AuthStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'ForgotPassword'>;

const C = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  surfaceWarm: '#fafafa',
  surfaceSage: '#f5f5f5',
  surfaceCoral: '#fee2e2',
  surfaceGold: '#fecaca',
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

// Simple email shape check — server is still the source of truth, this
// just keeps people from hitting the API for "foo" or " ".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordScreen() {
  const nav = useNavigation<Nav>();
  const [email, setEmail] = useState('');

  const mutation = useMutation({
    mutationFn: (e: string) => authService.forgotPassword(e),
  });

  const onSubmit = () => {
    const trimmed = email.trim();
    if (!trimmed) {
      showAlert('Email required', 'Enter the email on your account.');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      showAlert('Check your email', "That doesn't look like a valid email.");
      return;
    }
    mutation.mutate(trimmed, {
      onSuccess: res => {
        if (res.success) {
          nav.navigate('VerifyOtp', {email: trimmed});
        } else {
          showAlert(
            'Could not send code',
            res.message || 'Try again in a minute.',
          );
        }
      },
      onError: err =>
        showAlert(
          'Could not send code',
          err instanceof Error ? err.message : 'Try again.',
        ),
    });
  };

  return (
    <SafeAreaView
      className="flex-1"
      style={{backgroundColor: C.bg}}
      edges={['top']}>
      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{flexGrow: 1, paddingBottom: 24}}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* ── Top bar with back ─────────────────────────── */}
          <View className="px-3 pt-2 pb-1">
            <TouchableOpacity
              onPress={() => nav.goBack()}
              className="w-10 h-10 items-center justify-center rounded-full"
              activeOpacity={0.7}>
              <ChevronLeft color={C.ink} size={22} />
            </TouchableOpacity>
          </View>

          {/* ── Hero ──────────────────────────────────────── */}
          <View className="px-5 pt-1">
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
                style={{minHeight: 220}}>
                <View
                  className="absolute rounded-full"
                  style={{
                    width: 260,
                    height: 260,
                    right: -80,
                    top: -90,
                    backgroundColor: C.sage,
                    opacity: 0.24,
                  }}
                />
                <View
                  className="absolute rounded-full"
                  style={{
                    width: 180,
                    height: 180,
                    left: -60,
                    bottom: -70,
                    backgroundColor: C.coral,
                    opacity: 0.16,
                  }}
                />
                <View className="p-6">
                  <View
                    className="w-14 h-14 rounded-2xl items-center justify-center mb-4"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.16)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.28)',
                    }}>
                    <KeyRound color="white" size={22} />
                  </View>

                  <View className="flex-row mb-3">
                    <View
                      className="rounded-full px-2.5 py-1"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.16)',
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.28)',
                      }}>
                      <Text
                        className="text-[10px] font-bold"
                        style={{color: 'white', letterSpacing: 0.8}}>
                        STEP 1 OF 3
                      </Text>
                    </View>
                  </View>

                  <Text
                    className="font-black"
                    style={{
                      color: 'white',
                      fontSize: 30,
                      lineHeight: 34,
                      letterSpacing: -1.1,
                    }}>
                    Reset your{'\n'}password.
                  </Text>
                  <Text
                    className="text-xs mt-3"
                    style={{
                      color: 'rgba(255,255,255,0.78)',
                      maxWidth: '90%',
                      lineHeight: 18,
                    }}>
                    Enter the email on your account and we'll send a
                    6-digit code to verify it's you.
                  </Text>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── Email field ────────────────────────────────── */}
          <View className="px-5 pt-6">
            <Text
              className="text-[10px] font-bold tracking-widest mb-2 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              EMAIL
            </Text>
            <View
              className="rounded-2xl flex-row items-center px-4"
              style={{backgroundColor: C.surface, minHeight: 56}}>
              <Mail color={C.textTertiary} size={18} />
              <TextInput
                testID="forgot-email"
                className="flex-1 ml-3 text-base"
                style={{color: C.ink}}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor={C.textMuted}
                value={email}
                onChangeText={setEmail}
                editable={!mutation.isPending}
                autoFocus
              />
            </View>
          </View>

          {/* ── CTA ────────────────────────────────────────── */}
          <View className="px-5 pt-5">
            {mutation.isPending ? (
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
                    testID="forgot-submit"
                    className="py-4 flex-row items-center justify-center"
                    onPress={onSubmit}
                    activeOpacity={0.85}>
                    <Text
                      className="text-sm font-bold text-white mr-1.5"
                      style={{letterSpacing: 0.3}}>
                      Send code
                    </Text>
                    <ArrowRight color="white" size={14} />
                  </TouchableOpacity>
                </Gradient>
              </View>
            )}

            <TouchableOpacity
              onPress={() => nav.goBack()}
              disabled={mutation.isPending}
              className="py-4 mt-1">
              <Text
                className="text-center text-sm"
                style={{color: C.textSecondary}}>
                Remembered it?{' '}
                <Text className="font-bold" style={{color: C.sageDeep}}>
                  Back to sign in
                </Text>
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Info card ───────────────────────────────────── */}
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surfaceWarm}}>
              <Text
                className="text-[10px] font-bold tracking-widest mb-2"
                style={{color: C.goldDeep, letterSpacing: 1.8}}>
                CAN'T ACCESS YOUR EMAIL?
              </Text>
              <Text
                className="text-xs"
                style={{color: C.inkSoft, lineHeight: 17}}>
                Contact support and we'll verify your identity another
                way. Codes expire after 10 minutes.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
