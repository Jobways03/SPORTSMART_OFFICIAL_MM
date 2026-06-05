import React, {useEffect, useState} from 'react';
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
  AlertCircle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Crown,
  Info,
  Mail,
  Phone,
  Trash2,
  User,
} from 'lucide-react-native';
import {useProfile, useUpdateProfile} from '../../queries/useProfile';
import {useAuth} from '../../context/AuthContext';
import {showAlert} from '../../lib/dialog';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'EditProfile'>;

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

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'email-address';
  autoCapitalize?: 'none' | 'words';
  autoComplete?: 'email' | 'tel';
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  warning?: string;
  Icon?: typeof User;
  rightSlot?: React.ReactNode;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  autoCapitalize,
  autoComplete,
  disabled,
  required,
  hint,
  warning,
  Icon,
  rightSlot,
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="mb-4">
      <View className="flex-row items-center mb-1.5">
        <Text
          className="text-[11px] font-bold tracking-wide"
          style={{color: C.ink, letterSpacing: 0.2}}>
          {label.toUpperCase()}
          {required ? (
            <Text style={{color: C.coralDeep}}> *</Text>
          ) : (
            <Text style={{color: C.textMuted}}> · OPTIONAL</Text>
          )}
        </Text>
      </View>
      <View
        className="rounded-xl flex-row items-center px-4"
        style={{
          backgroundColor: C.surface,
          borderWidth: 1.5,
          borderColor: focused ? C.ink : C.border,
          minHeight: 48,
        }}>
        {Icon ? (
          <Icon color={C.textTertiary} size={15} style={{marginRight: 10}} />
        ) : null}
        <TextInput
          className="flex-1 text-sm"
          style={{color: C.ink}}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.textMuted}
          keyboardType={keyboardType ?? 'default'}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          autoComplete={autoComplete}
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {rightSlot}
      </View>
      {warning ? (
        <View className="flex-row items-center mt-1.5">
          <AlertCircle color={C.goldDeep} size={11} />
          <Text
            className="text-[10px] ml-1"
            style={{color: C.goldDeep, fontWeight: '600'}}>
            {warning}
          </Text>
        </View>
      ) : hint ? (
        <Text
          className="text-[10px] mt-1"
          style={{color: C.textTertiary}}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function EditProfileScreen() {
  const nav = useNavigation<Nav>();
  const {updateUser} = useAuth();
  const query = useProfile();
  const update = useUpdateProfile();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (query.data) {
      setFirstName(query.data.firstName);
      setLastName(query.data.lastName);
      setEmail(query.data.email);
      setPhone(query.data.phone ?? '');
    }
  }, [query.data]);

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
        <ErrorState onRetry={query.refetch} />
      </SafeAreaView>
    );
  }

  const isDirty =
    firstName !== query.data.firstName ||
    lastName !== query.data.lastName ||
    email !== query.data.email ||
    (phone || null) !== (query.data.phone || null);

  const emailChanged = email !== query.data.email;

  const initials =
    (firstName?.[0] ?? '').toUpperCase() +
    (lastName?.[0] ?? '').toUpperCase();

  const onSave = () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      showAlert('Missing info', 'Name and email are required.');
      return;
    }
    update.mutate(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() ? phone.trim() : null,
      },
      {
        onSuccess: () => {
          // Sync the cached auth user so the Home greeting (and any other
          // `user`-based UI) reflects the new name without a re-login.
          updateUser({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
          });
          showAlert('Profile updated', undefined, [
            {text: 'OK', onPress: () => nav.goBack()},
          ]);
        },
        onError: err =>
          showAlert(
            'Could not save',
            err instanceof Error ? err.message : 'Try again.',
          ),
      },
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
            YOUR DETAILS
          </Text>
          <Text
            className="font-black"
            style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
            Edit profile
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{paddingBottom: 120}}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* ── Avatar hero — dark gradient identity card ────── */}
          <View className="px-5 pt-4">
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
                style={{minHeight: 240}}>
                <View
                  className="absolute rounded-full"
                  style={{
                    width: 280,
                    height: 280,
                    right: -90,
                    top: -100,
                    backgroundColor: C.sage,
                    opacity: 0.24,
                  }}
                />
                <View
                  className="absolute rounded-full"
                  style={{
                    width: 200,
                    height: 200,
                    left: -60,
                    bottom: -80,
                    backgroundColor: C.coral,
                    opacity: 0.16,
                  }}
                />
                <View className="items-center p-6">
                  {/* Avatar with camera-edit overlay — frosted-glass
                      circle so it lifts off the gradient cleanly. */}
                  <View className="relative mb-3">
                    <View
                      className="rounded-full items-center justify-center"
                      style={{
                        width: 96,
                        height: 96,
                        backgroundColor: 'rgba(255,255,255,0.16)',
                        borderWidth: 2,
                        borderColor: 'rgba(255,255,255,0.32)',
                      }}>
                      <Text
                        className="font-black"
                        style={{
                          color: 'white',
                          fontSize: 34,
                          letterSpacing: -0.8,
                        }}>
                        {initials || '👤'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      className="absolute w-8 h-8 rounded-full items-center justify-center border-2"
                      style={{
                        bottom: -2,
                        right: -2,
                        backgroundColor: C.ink,
                        borderColor: 'white',
                      }}
                      activeOpacity={0.7}>
                      <Camera color="white" size={14} />
                    </TouchableOpacity>
                  </View>

                  <View
                    className="rounded-full px-2.5 py-1 flex-row items-center mb-2"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.16)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.28)',
                    }}>
                    <Crown color="white" size={10} />
                    <Text
                      className="text-[9px] font-bold ml-1"
                      style={{color: 'white', letterSpacing: 0.6}}>
                      SPORTSMART MEMBER
                    </Text>
                  </View>

                  <Text
                    className="font-black"
                    style={{
                      color: 'white',
                      fontSize: 22,
                      letterSpacing: -0.5,
                    }}>
                    {firstName} {lastName}
                  </Text>
                  <Text
                    className="text-xs mt-0.5"
                    style={{color: 'rgba(255,255,255,0.7)'}}>
                    Member since{' '}
                    {new Date().toLocaleDateString('en-IN', {
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── Verification status card ──────────────────────── */}
          <View className="px-5 pt-4">
            <View
              className="rounded-2xl p-4 flex-row"
              style={{backgroundColor: C.surface}}>
              <View className="flex-1 items-center">
                <View
                  className="w-10 h-10 rounded-full items-center justify-center mb-2"
                  style={{backgroundColor: C.surfaceSage}}>
                  <CheckCircle2 color={C.sageDeep} size={17} />
                </View>
                <Text
                  className="text-[10px] font-bold"
                  style={{color: C.ink, letterSpacing: 0.2}}>
                  EMAIL
                </Text>
                <Text
                  className="text-[10px] mt-0.5"
                  style={{color: C.sageDeep, fontWeight: '600'}}>
                  Verified
                </Text>
              </View>
              <View
                style={{width: 1, backgroundColor: C.border, marginHorizontal: 8}}
              />
              <View className="flex-1 items-center">
                <View
                  className="w-10 h-10 rounded-full items-center justify-center mb-2"
                  style={{
                    backgroundColor: query.data.phone
                      ? C.surfaceSage
                      : C.surfaceGold,
                  }}>
                  {query.data.phone ? (
                    <CheckCircle2 color={C.sageDeep} size={17} />
                  ) : (
                    <AlertCircle color={C.goldDeep} size={17} />
                  )}
                </View>
                <Text
                  className="text-[10px] font-bold"
                  style={{color: C.ink, letterSpacing: 0.2}}>
                  PHONE
                </Text>
                <Text
                  className="text-[10px] mt-0.5"
                  style={{
                    color: query.data.phone ? C.sageDeep : C.goldDeep,
                    fontWeight: '600',
                  }}>
                  {query.data.phone ? 'Verified' : 'Add to verify'}
                </Text>
              </View>
              <View
                style={{width: 1, backgroundColor: C.border, marginHorizontal: 8}}
              />
              <View className="flex-1 items-center">
                <View
                  className="w-10 h-10 rounded-full items-center justify-center mb-2"
                  style={{backgroundColor: C.surfaceWarm}}>
                  <User color={C.textTertiary} size={17} />
                </View>
                <Text
                  className="text-[10px] font-bold"
                  style={{color: C.ink, letterSpacing: 0.2}}>
                  KYC
                </Text>
                <Text
                  className="text-[10px] mt-0.5"
                  style={{color: C.textTertiary, fontWeight: '600'}}>
                  Not required
                </Text>
              </View>
            </View>
          </View>

          {/* ── Name section ──────────────────────────────────── */}
          <View className="px-5 pt-5">
            <SectionLabel>NAME</SectionLabel>
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surface}}>
              <View className="flex-row" style={{gap: 8}}>
                <View className="flex-1">
                  <Field
                    label="First name"
                    value={firstName}
                    onChange={setFirstName}
                    placeholder="Priya"
                    autoCapitalize="words"
                    disabled={update.isPending}
                    required
                    Icon={User}
                  />
                </View>
                <View className="flex-1">
                  <Field
                    label="Last name"
                    value={lastName}
                    onChange={setLastName}
                    placeholder="Sharma"
                    autoCapitalize="words"
                    disabled={update.isPending}
                    required
                  />
                </View>
              </View>
            </View>
          </View>

          {/* ── Contact section ───────────────────────────────── */}
          <View className="px-5 pt-5">
            <SectionLabel>CONTACT</SectionLabel>
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surface}}>
              <Field
                label="Email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                disabled={update.isPending}
                required
                Icon={Mail}
                warning={
                  emailChanged
                    ? 'Changing email requires re-verification'
                    : undefined
                }
                rightSlot={
                  !emailChanged ? (
                    <CheckCircle2 color={C.sageDeep} size={16} />
                  ) : undefined
                }
              />
              <Field
                label="Phone"
                value={phone}
                onChange={setPhone}
                placeholder="+91 9876543210"
                keyboardType="phone-pad"
                autoComplete="tel"
                disabled={update.isPending}
                Icon={Phone}
                hint="Used for OTP login and order tracking SMS"
              />
            </View>
          </View>

          {/* ── Privacy strip ─────────────────────────────────── */}
          <View className="px-5 pt-4">
            <View
              className="rounded-2xl p-3 flex-row items-center"
              style={{backgroundColor: C.surfaceSage}}>
              <Info color={C.sageDeep} size={13} />
              <Text
                className="text-[11px] ml-2 flex-1 leading-4"
                style={{color: C.sageDeep, fontWeight: '600'}}>
                We never sell your data. Export or delete it anytime
                from Account → Privacy & data.
              </Text>
            </View>
          </View>

          {/* ── Danger zone ───────────────────────────────────── */}
          <View className="px-5 pt-5">
            <SectionLabel>ACCOUNT</SectionLabel>
            <View
              className="rounded-2xl overflow-hidden"
              style={{backgroundColor: C.surface}}>
              <TouchableOpacity
                className="px-4 py-3.5 flex-row items-center"
                activeOpacity={0.7}>
                <View
                  className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                  style={{backgroundColor: C.surfaceCoral}}>
                  <Trash2 color={C.sageDeep} size={17} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-sm font-bold"
                    style={{color: C.sageDeep, letterSpacing: -0.2}}>
                    Delete account
                  </Text>
                  <Text
                    className="text-[11px] mt-0.5"
                    style={{color: C.textTertiary}}>
                    Permanently remove your account and data
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        {/* ── Sticky bottom Save bar ────────────────────────────── */}
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
          {!isDirty || update.isPending ? (
            <TouchableOpacity
              className="rounded-2xl py-3.5 flex-row items-center justify-center"
              style={{backgroundColor: C.textMuted}}
              disabled
              activeOpacity={1}>
              {update.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-sm font-bold text-white">
                  Nothing to save
                </Text>
              )}
            </TouchableOpacity>
          ) : (
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
                  onPress={onSave}
                  activeOpacity={0.85}>
                  <Text
                    className="text-sm font-bold text-white"
                    style={{letterSpacing: -0.2}}>
                    Save changes
                  </Text>
                </TouchableOpacity>
              </Gradient>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function SectionLabel({children}: {children: React.ReactNode}) {
  return (
    <Text
      className="text-[10px] font-bold tracking-widest mb-2 px-1"
      style={{color: C.textTertiary, letterSpacing: 1.8}}>
      {children}
    </Text>
  );
}
