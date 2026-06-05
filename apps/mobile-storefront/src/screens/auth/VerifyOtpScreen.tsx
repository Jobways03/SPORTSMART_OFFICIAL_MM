import React, {useEffect, useRef, useState} from 'react';
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
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {ArrowRight, ChevronLeft, ShieldCheck} from 'lucide-react-native';
import {useMutation} from '@tanstack/react-query';
import {authService} from '../../services/auth.service';
import type {
  VerifyRegistrationOtpResponseData,
  VerifyResetOtpResponseData,
} from '../../services/auth.service';
import type {ApiResponse} from '../../lib/api-client';
import {useAuth} from '../../context/AuthContext';
import {Gradient} from '../../components/Gradient';
import type {AuthStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'VerifyOtp'>;
type Route = RouteProp<AuthStackParamList, 'VerifyOtp'>;

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

const OTP_LEN = 6;
const RESEND_COOLDOWN_S = 30;

// Mask the local part so users can confirm the right address without
// fully exposing it on screen ("ar***@gmail.com").
function maskEmail(e: string): string {
  const [local, domain] = e.split('@');
  if (!local || !domain) return e;
  if (local.length <= 2) return `${local[0] ?? ''}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function VerifyOtpScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const {login} = useAuth();
  // 'register' = email-verification after sign-up (auto-login on success);
  // 'reset' (default) = password-reset OTP (→ ResetPassword screen).
  const isRegister = params.mode === 'register';
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  // True while we log the user in after a successful registration verify —
  // keeps the CTA spinning across the verify→login hop.
  const [finalizing, setFinalizing] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Tick down the resend cooldown once per second. Reset to full when
  // the user requests a resend.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // The two flows return different `data` shapes ({verified} vs {resetToken});
  // type the mutation against the union so the branch in onSuccess can read
  // either via a narrowing cast.
  const verify = useMutation<
    ApiResponse<VerifyRegistrationOtpResponseData | VerifyResetOtpResponseData>
  >({
    mutationFn: async () =>
      isRegister
        ? authService.verifyRegistrationOtp(params.email, code)
        : authService.verifyResetOtp(params.email, code),
  });

  const resend = useMutation({
    mutationFn: () =>
      isRegister
        ? authService.resendRegistrationOtp(params.email)
        : authService.resendResetOtp(params.email),
  });

  const busy = verify.isPending || finalizing;

  const onSubmit = () => {
    if (code.length !== OTP_LEN) {
      showAlert(
        'Enter the full code',
        `The code is ${OTP_LEN} digits long.`,
      );
      return;
    }
    verify.mutate(undefined, {
      onSuccess: async res => {
        if (isRegister) {
          // Registration verify returns {email, verified} (no tokens), so on
          // success we log in to land the user inside the app — the
          // RootNavigator swaps Auth→App once isAuthenticated flips.
          const verified = (res.data as {verified?: boolean} | undefined)
            ?.verified;
          if (res.success && verified) {
            setFinalizing(true);
            try {
              await login(params.email, params.password ?? '');
            } catch (err) {
              // Verified, but auto-login failed (e.g. bad/missing password) —
              // send them to sign in manually rather than dead-end.
              setFinalizing(false);
              showAlert(
                'Email verified',
                'Your email is verified. Please sign in to continue.',
              );
              nav.navigate('Login');
            }
          } else {
            showAlert(
              'Wrong code',
              res.message || 'Double-check the code and try again.',
            );
          }
          return;
        }
        // Password-reset flow.
        const resetToken = (res.data as {resetToken?: string} | undefined)
          ?.resetToken;
        if (res.success && resetToken) {
          nav.navigate('ResetPassword', {
            email: params.email,
            resetToken,
          });
        } else {
          showAlert(
            'Wrong code',
            res.message || 'Double-check the code and try again.',
          );
        }
      },
      onError: err =>
        showAlert(
          'Could not verify',
          err instanceof Error ? err.message : 'Try again.',
        ),
    });
  };

  const onResend = () => {
    if (cooldown > 0) return;
    resend.mutate(undefined, {
      onSuccess: res => {
        if (res.success) {
          setCooldown(RESEND_COOLDOWN_S);
          showAlert(
            'Code sent',
            'Check your inbox — it might take a minute.',
          );
        } else {
          showAlert(
            'Could not resend',
            res.message || 'Try again in a minute.',
          );
        }
      },
      onError: err =>
        showAlert(
          'Could not resend',
          err instanceof Error ? err.message : 'Try again.',
        ),
    });
  };

  // Auto-submit when the user types the final digit so they don't
  // have to reach for the button — common pattern for OTP flows.
  const onChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, OTP_LEN);
    setCode(digits);
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
                    <ShieldCheck color="white" size={22} />
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
                        {isRegister ? 'VERIFY EMAIL' : 'STEP 2 OF 3'}
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
                    Enter the{'\n'}6-digit code.
                  </Text>
                  <Text
                    className="text-xs mt-3"
                    style={{
                      color: 'rgba(255,255,255,0.78)',
                      maxWidth: '90%',
                      lineHeight: 18,
                    }}>
                    We sent a code to{' '}
                    <Text className="font-bold" style={{color: 'white'}}>
                      {maskEmail(params.email)}
                    </Text>
                    . It expires in 10 minutes.
                  </Text>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── OTP boxes (visual) + hidden input ─────────── */}
          <View className="px-5 pt-6">
            <Text
              className="text-[10px] font-bold tracking-widest mb-2 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              YOUR CODE
            </Text>
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => inputRef.current?.focus()}
              className="flex-row justify-between">
              {Array.from({length: OTP_LEN}).map((_, i) => {
                const ch = code[i] ?? '';
                const isFocus = code.length === i;
                return (
                  <View
                    key={i}
                    className="rounded-2xl items-center justify-center"
                    style={{
                      width: '15%',
                      aspectRatio: 0.85,
                      backgroundColor: C.surface,
                      borderWidth: 2,
                      borderColor: isFocus
                        ? C.sage
                        : ch
                        ? C.gold
                        : 'transparent',
                    }}>
                    <Text
                      className="font-black"
                      style={{
                        color: C.ink,
                        fontSize: 22,
                        letterSpacing: -0.5,
                      }}>
                      {ch}
                    </Text>
                  </View>
                );
              })}
            </TouchableOpacity>
            <TextInput
              ref={inputRef}
              style={{position: 'absolute', opacity: 0, height: 0, width: 0}}
              value={code}
              onChangeText={onChange}
              keyboardType="number-pad"
              maxLength={OTP_LEN}
              autoFocus
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              editable={!busy}
            />
          </View>

          {/* ── CTA ────────────────────────────────────────── */}
          <View className="px-5 pt-6">
            {busy ? (
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
                      Verify code
                    </Text>
                    <ArrowRight color="white" size={14} />
                  </TouchableOpacity>
                </Gradient>
              </View>
            )}
          </View>

          {/* ── Resend ─────────────────────────────────────── */}
          <View className="px-5 pt-4">
            <View
              className="rounded-2xl p-4 flex-row items-center"
              style={{backgroundColor: C.surface}}>
              <View className="flex-1">
                <Text
                  className="text-sm font-bold"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Didn't get the code?
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{color: C.textTertiary}}>
                  Check spam — or resend after the timer.
                </Text>
              </View>
              <TouchableOpacity
                onPress={onResend}
                disabled={cooldown > 0 || resend.isPending}
                className="rounded-full px-3.5 py-2"
                style={{
                  backgroundColor:
                    cooldown > 0 ? C.surfaceWarm : C.surfaceSage,
                }}
                activeOpacity={0.7}>
                {resend.isPending ? (
                  <ActivityIndicator color={C.sageDeep} size="small" />
                ) : (
                  <Text
                    className="text-xs font-bold"
                    style={{
                      color: cooldown > 0 ? C.textMuted : C.sageDeep,
                      letterSpacing: 0.3,
                    }}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
