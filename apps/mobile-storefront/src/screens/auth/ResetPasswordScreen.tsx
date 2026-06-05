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
import {SafeAreaView} from 'react-native-safe-area-context';
import {showAlert} from '../../lib/dialog';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  Lock,
} from 'lucide-react-native';
import {useMutation} from '@tanstack/react-query';
import {authService} from '../../services/auth.service';
import {Gradient} from '../../components/Gradient';
import type {AuthStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'ResetPassword'>;
type Route = RouteProp<AuthStackParamList, 'ResetPassword'>;

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

function scorePassword(p: string): {label: string; pct: number; color: string} {
  if (!p) return {label: '—', pct: 0, color: C.textMuted};
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/\d/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  if (score <= 1) return {label: 'Weak', pct: 0.25, color: C.coralDeep};
  if (score === 2) return {label: 'Fair', pct: 0.5, color: C.goldDeep};
  if (score === 3) return {label: 'Good', pct: 0.75, color: C.sageDeep};
  return {label: 'Strong', pct: 1, color: C.sageDeep};
}

export function ResetPasswordScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = useMemo(() => scorePassword(next), [next]);

  const mutation = useMutation({
    mutationFn: () => authService.resetPassword(params.resetToken, next),
  });

  const onSubmit = () => {
    if (!next || !confirm) {
      showAlert('Missing info', 'Fill both fields to continue.');
      return;
    }
    if (next.length < 8) {
      showAlert('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      showAlert('Passwords don’t match', 'Confirm matches the new password.');
      return;
    }
    mutation.mutate(undefined, {
      onSuccess: res => {
        if (res.success) {
          showAlert(
            'Password updated',
            'Sign in with your new password.',
            [
              {
                text: 'Sign in',
                onPress: () => nav.popToTop(),
              },
            ],
          );
        } else {
          showAlert(
            'Could not reset',
            res.message || 'Your reset code may have expired. Try again.',
          );
        }
      },
      onError: err =>
        showAlert(
          'Could not reset',
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
                    <Lock color="white" size={22} />
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
                        STEP 3 OF 3
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
                    Set a new{'\n'}password.
                  </Text>
                  <Text
                    className="text-xs mt-3"
                    style={{
                      color: 'rgba(255,255,255,0.78)',
                      maxWidth: '90%',
                      lineHeight: 18,
                    }}>
                    Pick something you haven't used elsewhere. We'll
                    sign you in next.
                  </Text>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── New password ───────────────────────────────── */}
          <View className="px-5 pt-6">
            <Text
              className="text-[10px] font-bold tracking-widest mb-2 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              NEW PASSWORD
            </Text>
            <View
              className="rounded-2xl flex-row items-center px-4 mb-3"
              style={{backgroundColor: C.surface, minHeight: 56}}>
              <Lock color={C.textTertiary} size={18} />
              <TextInput
                testID="reset-password"
                className="flex-1 ml-3 text-base"
                style={{color: C.ink}}
                autoComplete="password-new"
                secureTextEntry={!showNext}
                placeholder="At least 8 characters"
                placeholderTextColor={C.textMuted}
                value={next}
                onChangeText={setNext}
                editable={!mutation.isPending}
                autoFocus
              />
              <TouchableOpacity
                testID="reset-password-show"
                accessibilityLabel="Show password"
                onPress={() => setShowNext(v => !v)}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                {showNext ? (
                  <EyeOff color={C.textTertiary} size={18} />
                ) : (
                  <Eye color={C.textTertiary} size={18} />
                )}
              </TouchableOpacity>
            </View>

            {next ? (
              <View className="mb-3">
                <View
                  className="rounded-full overflow-hidden"
                  style={{height: 4, backgroundColor: C.surfaceWarm}}>
                  <View
                    style={{
                      width: `${strength.pct * 100}%`,
                      height: '100%',
                      backgroundColor: strength.color,
                    }}
                  />
                </View>
                <View className="flex-row justify-between mt-1.5 px-1">
                  <Text
                    className="text-[10px] font-bold"
                    style={{color: strength.color, letterSpacing: 0.3}}>
                    {strength.label.toUpperCase()}
                  </Text>
                  <Text className="text-[10px]" style={{color: C.textMuted}}>
                    {next.length} chars
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Confirm */}
            <Text
              className="text-[10px] font-bold tracking-widest mb-2 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              CONFIRM
            </Text>
            <View
              className="rounded-2xl flex-row items-center px-4"
              style={{backgroundColor: C.surface, minHeight: 56}}>
              <Lock color={C.textTertiary} size={18} />
              <TextInput
                testID="reset-confirm"
                className="flex-1 ml-3 text-base"
                style={{color: C.ink}}
                autoComplete="password-new"
                secureTextEntry={!showConfirm}
                placeholder="Type it again"
                placeholderTextColor={C.textMuted}
                value={confirm}
                onChangeText={setConfirm}
                editable={!mutation.isPending}
              />
              <TouchableOpacity
                testID="reset-confirm-show"
                accessibilityLabel="Show confirm password"
                onPress={() => setShowConfirm(v => !v)}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                {showConfirm ? (
                  <EyeOff color={C.textTertiary} size={18} />
                ) : (
                  <Eye color={C.textTertiary} size={18} />
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Tips ────────────────────────────────────────── */}
          <View className="px-5 pt-5">
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surfaceWarm}}>
              <Text
                className="text-[10px] font-bold tracking-widest mb-3"
                style={{color: C.goldDeep, letterSpacing: 1.8}}>
                A STRONG PASSWORD HAS
              </Text>
              {[
                'At least 8 characters (12+ is even better)',
                'Mix of upper and lowercase letters',
                'At least one number or symbol',
                'Different from your last password',
              ].map(tip => (
                <View key={tip} className="flex-row items-center mb-2">
                  <View
                    className="w-4 h-4 rounded-full items-center justify-center mr-2.5"
                    style={{backgroundColor: C.gold}}>
                    <Check color="white" size={10} strokeWidth={3} />
                  </View>
                  <Text
                    className="text-xs flex-1"
                    style={{color: C.inkSoft, lineHeight: 18}}>
                    {tip}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── CTA ─────────────────────────────────────────── */}
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
                    testID="reset-submit"
                    className="py-4 flex-row items-center justify-center"
                    onPress={onSubmit}
                    activeOpacity={0.85}>
                    <Text
                      className="text-sm font-bold text-white mr-1.5"
                      style={{letterSpacing: 0.3}}>
                      Set new password
                    </Text>
                    <ArrowRight color="white" size={14} />
                  </TouchableOpacity>
                </Gradient>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
