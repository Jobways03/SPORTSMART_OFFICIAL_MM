import React, {useState} from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
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
  Crown,
  Eye,
  EyeOff,
  Leaf,
  Lock,
  Mail,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react-native';
import {useAuth} from '../../context/AuthContext';
import {Gradient} from '../../components/Gradient';
import type {AuthStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Login'>;

// Warm premium palette mirrors HomeScreen / AccountScreen so the auth
// surface feels like a continuation of the brand, not a different app.
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

export function LoginScreen() {
  const nav = useNavigation<Nav>();
  const {login} = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!email || !password) {
      showAlert('Missing info', 'Enter your email and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      // AuthContext flips isAuthenticated, RootNavigator swaps to App stack.
    } catch (err) {
      showAlert('Login failed', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onForgotPassword = () => {
    nav.navigate('ForgotPassword');
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
          {/* ── Brand logo ──────────────────────────────────── */}
          <View className="px-5 pt-4 pb-1 items-center">
            <Image
              source={{uri: SPORTSMART_LOGO}}
              style={{width: 170, height: 38}}
              resizeMode="contain"
              accessibilityLabel="SportsMart"
            />
          </View>
          {/* ── HERO ─────────────────────────────────────────── */}
          <View className="px-5 pt-3">
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
                style={{minHeight: 260}}>
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

                <View className="p-6">
                  <Text
                    className="font-black"
                    style={{
                      color: 'white',
                      fontSize: 24,
                      letterSpacing: -0.8,
                    }}>
                    SPORTSMART
                  </Text>
                  <Text
                    className="text-xs mt-1"
                    style={{color: 'rgba(255,255,255,0.72)'}}>
                    India's home for sports gear
                  </Text>

                  {/* Frosted-glass member chip — matches the
                      Account profile hero MEMBER chip. */}
                  <View className="flex-row mt-7">
                    <View
                      className="rounded-full px-2.5 py-1 flex-row items-center"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.16)',
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.28)',
                      }}>
                      <Crown color="white" size={10} />
                      <Text
                        className="text-[10px] font-bold ml-1"
                        style={{color: 'white', letterSpacing: 0.8}}>
                        MEMBER REWARDS
                      </Text>
                    </View>
                  </View>

                  <Text
                    className="font-black mt-5"
                    style={{
                      color: 'white',
                      fontSize: 36,
                      lineHeight: 40,
                      letterSpacing: -1.4,
                    }}>
                    Welcome{'\n'}back.
                  </Text>
                  <Text
                    className="text-xs mt-3"
                    style={{
                      color: 'rgba(255,255,255,0.78)',
                      maxWidth: '85%',
                      lineHeight: 18,
                    }}>
                    Sign in to track orders, earn rewards, and shop the
                    latest drops.
                  </Text>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── FORM ─────────────────────────────────────────── */}
          <View className="px-5 pt-7">
            <Text
              className="text-[10px] font-bold tracking-widest mb-3 px-1"
              style={{color: C.textTertiary, letterSpacing: 1.8}}>
              SIGN IN
            </Text>

            <View
              className="rounded-2xl flex-row items-center px-4 mb-3"
              style={{backgroundColor: C.surface, minHeight: 56}}>
              <Mail color={C.textTertiary} size={18} />
              <TextInput
                testID="login-email"
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

            <View
              className="rounded-2xl flex-row items-center px-4 mb-2"
              style={{backgroundColor: C.surface, minHeight: 56}}>
              <Lock color={C.textTertiary} size={18} />
              <TextInput
                testID="login-password"
                className="flex-1 ml-3 text-base"
                style={{color: C.ink}}
                autoComplete="password"
                secureTextEntry={!showPassword}
                placeholder="Password"
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

            <TouchableOpacity
              onPress={onForgotPassword}
              className="self-end mb-5 py-1.5 px-1">
              <Text
                className="text-xs font-bold"
                style={{color: C.sageDeep}}>
                Forgot password?
              </Text>
            </TouchableOpacity>

            {/* Gradient Sign in CTA — same funnel grammar as PDP
                Buy now, Cart Proceed, Checkout Pay. Disabled state
                falls back to flat-muted with a spinner. */}
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
                    testID="login-submit"
                    className="py-4 flex-row items-center justify-center"
                    onPress={onSubmit}
                    activeOpacity={0.85}>
                    <Text
                      className="text-sm font-bold text-white mr-1.5"
                      style={{letterSpacing: 0.3}}>
                      Sign in
                    </Text>
                    <ArrowRight color="white" size={14} />
                  </TouchableOpacity>
                </Gradient>
              </View>
            )}

            <TouchableOpacity
              onPress={() => nav.navigate('Register')}
              disabled={isSubmitting}
              className="py-4 mt-1">
              <Text
                className="text-center text-sm"
                style={{color: C.textSecondary}}>
                New to Sportsmart?{' '}
                <Text className="font-bold" style={{color: C.sageDeep}}>
                  Create an account
                </Text>
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Trust strip ──────────────────────────────────── */}
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl px-4 py-4 flex-row justify-between"
              style={{backgroundColor: C.surface}}>
              {[
                {
                  Icon: ShieldCheck,
                  label: 'Secure',
                  bg: C.surfaceGold,
                  color: C.goldDeep,
                },
                {
                  Icon: RotateCcw,
                  label: '7-day returns',
                  bg: C.surfaceCoral,
                  color: C.coralDeep,
                },
                {
                  Icon: Leaf,
                  label: 'Carbon-neutral',
                  bg: C.surfaceSage,
                  color: C.sageDeep,
                },
              ].map(badge => (
                <View key={badge.label} className="items-center flex-1">
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mb-1.5"
                    style={{backgroundColor: badge.bg}}>
                    <badge.Icon color={badge.color} size={15} />
                  </View>
                  <Text
                    className="text-[10px] font-semibold"
                    style={{color: C.textSecondary}}>
                    {badge.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
