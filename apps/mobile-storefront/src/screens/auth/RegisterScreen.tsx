import React, {useState} from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {SPORTSMART_LOGO} from '../../assets/logo';
import {showAlert} from '../../lib/dialog';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Sparkles,
  User,
} from 'lucide-react-native';
import {authService} from '../../services/auth.service';
import {Events, track} from '../../lib/analytics';
import {LINKS} from '../../lib/links';
import {Gradient} from '../../components/Gradient';
import type {AuthStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Register'>;

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

const PERKS = [
  '₹250 welcome credit in your wallet',
  'Free shipping on your first order',
  'Early access to member drops',
];

export function RegisterScreen() {
  const nav = useNavigation<Nav>();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!firstName || !lastName || !email || !password) {
      showAlert('Missing info', 'Fill all fields to continue.');
      return;
    }
    if (password.length < 8) {
      showAlert('Password too short', 'Use at least 8 characters.');
      return;
    }
    // API requires upper + lower + number + special char.
    if (
      !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/.test(password)
    ) {
      showAlert(
        'Weak password',
        'Use an uppercase letter, a lowercase letter, a number, and a special character (e.g. Vansh@123).',
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await authService.register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        // API RegisterDto requires these; the screen has implicit consent
        // ("By creating an account you agree to our Terms…").
        confirmPassword: password,
        acceptTerms: true,
        acceptPrivacy: true,
      });
      if (!res.success) throw new Error(res.message || 'Registration failed');
      track(Events.AuthSignupCompleted);
      // The account is created but unverified — the API has emailed a 6-digit
      // code. Go collect it on the OTP screen, which verifies the email and
      // then logs the user in. (Logging in here would fail with
      // "email not verified", which is the bug this replaces.)
      nav.navigate('VerifyOtp', {
        email: email.trim(),
        mode: 'register',
        password,
      });
    } catch (err) {
      showAlert(
        'Registration failed',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
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
          {/* ── Top bar with back ───────────────────────────── */}
          <View className="px-3 pt-2 pb-1">
            <TouchableOpacity
              onPress={() => nav.goBack()}
              className="w-10 h-10 items-center justify-center rounded-full"
              activeOpacity={0.7}>
              <ChevronLeft color={C.ink} size={22} />
            </TouchableOpacity>
          </View>

          {/* ── Brand logo ──────────────────────────────────── */}
          <View className="px-5 pt-1 pb-1 items-center">
            <Image
              source={{uri: SPORTSMART_LOGO}}
              style={{width: 170, height: 38}}
              resizeMode="contain"
              accessibilityLabel="SportsMart"
            />
          </View>
          {/* ── HERO ─────────────────────────────────────────── */}
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
                    opacity: 0.18,
                  }}
                />
                <View className="p-6">
                  <View className="flex-row mb-3">
                    <View
                      className="rounded-full px-2.5 py-1 flex-row items-center"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.16)',
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.28)',
                      }}>
                      <Sparkles color="white" size={10} />
                      <Text
                        className="text-[10px] font-bold ml-1"
                        style={{color: 'white', letterSpacing: 0.8}}>
                        WELCOME GIFT INSIDE
                      </Text>
                    </View>
                  </View>

                  <Text
                    className="font-black"
                    style={{
                      color: 'white',
                      fontSize: 36,
                      lineHeight: 40,
                      letterSpacing: -1.4,
                    }}>
                    Create your{'\n'}account.
                  </Text>
                  <Text
                    className="text-xs mt-3"
                    style={{
                      color: 'rgba(255,255,255,0.78)',
                      maxWidth: '88%',
                      lineHeight: 18,
                    }}>
                    Join 50,000+ athletes shopping with Sportsmart.
                    Less than a minute to set up.
                  </Text>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── Perks ────────────────────────────────────────── */}
          <View className="px-5 pt-4">
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surfaceGold}}>
              {PERKS.map((p, i) => (
                <View
                  key={p}
                  className={`flex-row items-center ${
                    i < PERKS.length - 1 ? 'mb-2.5' : ''
                  }`}>
                  <View
                    className="w-5 h-5 rounded-full items-center justify-center mr-3"
                    style={{backgroundColor: C.gold}}>
                    <Check color="white" size={12} strokeWidth={3} />
                  </View>
                  <Text
                    className="text-xs font-medium flex-1"
                    style={{color: C.ink, letterSpacing: -0.1}}>
                    {p}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── FORM ─────────────────────────────────────────── */}
          <View className="px-5 pt-6">
            <Text
              className="text-[10px] font-bold tracking-widest mb-3 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              YOUR DETAILS
            </Text>

            {/* Name row */}
            <View className="flex-row mb-3" style={{gap: 8}}>
              <View
                className="flex-1 rounded-2xl flex-row items-center px-4"
                style={{backgroundColor: C.surface, minHeight: 56}}>
                <User color={C.textTertiary} size={18} />
                <TextInput
                  testID="register-firstName"
                  className="flex-1 ml-3 text-base"
                  style={{color: C.ink}}
                  autoCapitalize="words"
                  placeholder="First"
                  placeholderTextColor={C.textMuted}
                  value={firstName}
                  onChangeText={setFirstName}
                  editable={!isSubmitting}
                />
              </View>
              <View
                className="flex-1 rounded-2xl flex-row items-center px-4"
                style={{backgroundColor: C.surface, minHeight: 56}}>
                <TextInput
                  testID="register-lastName"
                  className="flex-1 text-base"
                  style={{color: C.ink}}
                  autoCapitalize="words"
                  placeholder="Last"
                  placeholderTextColor={C.textMuted}
                  value={lastName}
                  onChangeText={setLastName}
                  editable={!isSubmitting}
                />
              </View>
            </View>

            {/* Email */}
            <View
              className="rounded-2xl flex-row items-center px-4 mb-3"
              style={{backgroundColor: C.surface, minHeight: 56}}>
              <Mail color={C.textTertiary} size={18} />
              <TextInput
                testID="register-email"
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
                editable={!isSubmitting}
              />
            </View>

            {/* Password */}
            <View
              className="rounded-2xl flex-row items-center px-4 mb-2"
              style={{backgroundColor: C.surface, minHeight: 56}}>
              <Lock color={C.textTertiary} size={18} />
              <TextInput
                testID="register-password"
                className="flex-1 ml-3 text-base"
                style={{color: C.ink}}
                autoComplete="password-new"
                secureTextEntry={!showPassword}
                placeholder="At least 8 characters"
                placeholderTextColor={C.textMuted}
                value={password}
                onChangeText={setPassword}
                editable={!isSubmitting}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(v => !v)}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}
                accessibilityLabel={
                  showPassword ? 'Hide password' : 'Show password'
                }>
                {showPassword ? (
                  <EyeOff color={C.textTertiary} size={18} />
                ) : (
                  <Eye color={C.textTertiary} size={18} />
                )}
              </TouchableOpacity>
            </View>

            <Text
              className="text-[11px] mt-3 mb-5 px-1"
              style={{color: C.textTertiary, lineHeight: 16}}>
              By creating an account you agree to our{' '}
              <Text
                className="font-bold"
                style={{color: C.sageDeep}}
                onPress={() => Linking.openURL(LINKS.terms)}>
                Terms
              </Text>{' '}
              and{' '}
              <Text
                className="font-bold"
                style={{color: C.sageDeep}}
                onPress={() => Linking.openURL(LINKS.privacy)}>
                Privacy Policy
              </Text>
              .
            </Text>

            {isSubmitting ? (
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
                    testID="register-submit"
                    className="py-4 flex-row items-center justify-center"
                    onPress={onSubmit}
                    activeOpacity={0.85}>
                    <Text
                      className="text-sm font-bold text-white mr-1.5"
                      style={{letterSpacing: 0.3}}>
                      Create account
                    </Text>
                    <ArrowRight color="white" size={14} />
                  </TouchableOpacity>
                </Gradient>
              </View>
            )}

            <TouchableOpacity
              onPress={() => nav.goBack()}
              disabled={isSubmitting}
              className="py-4 mt-1">
              <Text
                className="text-center text-sm"
                style={{color: C.textSecondary}}>
                Already have an account?{' '}
                <Text className="font-bold" style={{color: C.sageDeep}}>
                  Sign in
                </Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
