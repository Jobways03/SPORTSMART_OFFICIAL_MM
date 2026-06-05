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
import {Gradient} from '../../components/Gradient';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
} from 'lucide-react-native';
import {useMutation} from '@tanstack/react-query';
import {profileService} from '../../services/profile.service';
import {showAlert} from '../../lib/dialog';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'ChangePassword'>;

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

interface SecureFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  isNew?: boolean;
}

function SecureField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  isNew,
}: SecureFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <View className="mb-3">
      <Text
        className="text-[10px] font-bold tracking-widest mb-2 px-1"
        style={{color: C.textTertiary, letterSpacing: 1.8}}>
        {label.toUpperCase()}
      </Text>
      <View
        className="rounded-2xl flex-row items-center px-4"
        style={{backgroundColor: C.surface, minHeight: 56}}>
        <Lock color={C.textTertiary} size={18} />
        <TextInput
          className="flex-1 ml-3 text-base"
          style={{color: C.ink}}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.textMuted}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={isNew ? 'password-new' : 'password'}
          editable={!disabled}
        />
        <TouchableOpacity
          onPress={() => setVisible(v => !v)}
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}>
          {visible ? (
            <EyeOff color={C.textTertiary} size={18} />
          ) : (
            <Eye color={C.textTertiary} size={18} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Lightweight strength heuristic — purely visual, no security claim.
// Backend still owns the policy; this is just feedback while typing.
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

export function ChangePasswordScreen() {
  const nav = useNavigation<Nav>();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const strength = useMemo(() => scorePassword(next), [next]);

  const mutation = useMutation({
    mutationFn: () =>
      profileService.changePassword({
        currentPassword: current,
        newPassword: next,
        confirmPassword: confirm,
      }),
  });

  const onSubmit = () => {
    if (!current || !next || !confirm) {
      showAlert('Missing info', 'Fill all fields to continue.');
      return;
    }
    if (next.length < 8) {
      showAlert('Password too short', 'Use at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      showAlert(
        'Passwords don’t match',
        'Confirm matches the new password.',
      );
      return;
    }
    if (next === current) {
      showAlert(
        'Pick a different password',
        'Your new password matches the current one.',
      );
      return;
    }
    mutation.mutate(undefined, {
      onSuccess: res => {
        if (res.success) {
          showAlert('Password updated', undefined, [
            {text: 'OK', onPress: () => nav.goBack()},
          ]);
        } else {
          showAlert('Could not update', res.message || 'Try again.');
        }
      },
      onError: err =>
        showAlert(
          'Could not update',
          err instanceof Error ? err.message : 'Try again.',
        ),
    });
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
          Change password
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{paddingBottom: 40}}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* ── Hero — dark gradient matching the auth-flow family */}
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
                    width: 200,
                    height: 200,
                    right: -60,
                    bottom: -70,
                    backgroundColor: C.sage,
                    opacity: 0.28,
                  }}
                />
                <View className="flex-row items-center p-5">
                  <View
                    className="w-14 h-14 rounded-2xl items-center justify-center mr-4"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.16)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.28)',
                    }}>
                    <KeyRound color="white" size={22} />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="font-black"
                      style={{
                        color: 'white',
                        fontSize: 20,
                        letterSpacing: -0.5,
                      }}>
                      Keep it secure
                    </Text>
                    <Text
                      className="text-xs mt-1"
                      style={{
                        color: 'rgba(255,255,255,0.78)',
                        lineHeight: 16,
                      }}>
                      Pick a fresh password you haven't used elsewhere.
                    </Text>
                  </View>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── Fields ──────────────────────────────────────── */}
          <View className="px-5 pt-5">
            <SecureField
              label="Current password"
              value={current}
              onChange={setCurrent}
              placeholder="Your current password"
              disabled={mutation.isPending}
            />
            <SecureField
              label="New password"
              value={next}
              onChange={setNext}
              placeholder="At least 8 characters"
              disabled={mutation.isPending}
              isNew
            />

            {/* Strength meter */}
            {next ? (
              <View className="mb-3 -mt-1">
                <View
                  className="rounded-full overflow-hidden"
                  style={{
                    height: 4,
                    backgroundColor: C.surfaceWarm,
                  }}>
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
                  <Text
                    className="text-[10px]"
                    style={{color: C.textMuted}}>
                    {next.length} chars
                  </Text>
                </View>
              </View>
            ) : null}

            <SecureField
              label="Confirm new password"
              value={confirm}
              onChange={setConfirm}
              placeholder="Type it again"
              disabled={mutation.isPending}
              isNew
            />
          </View>

          {/* ── Tips card ───────────────────────────────────── */}
          <View className="px-5 pt-2">
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
                'A mix of upper and lowercase letters',
                'At least one number or symbol',
                'No personal info like your name or email',
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
                    className="py-4 flex-row items-center justify-center"
                    onPress={onSubmit}
                    activeOpacity={0.85}>
                    <Text
                      className="text-sm font-bold text-white mr-1.5"
                      style={{letterSpacing: 0.3}}>
                      Update password
                    </Text>
                    <ArrowRight color="white" size={14} />
                  </TouchableOpacity>
                </Gradient>
              </View>
            )}
            <Text
              className="text-[11px] text-center mt-3 px-4"
              style={{color: C.textTertiary, lineHeight: 16}}>
              You'll stay signed in after updating. Sign out from
              Account if you want to verify the new password.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
