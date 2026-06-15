import React from 'react';
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  BookOpen,
  ChevronRight,
  Crown,
  Edit3,
  FileText,
  Gift,
  Headphones,
  Heart,
  HelpCircle,
  Info,
  KeyRound,
  Leaf,
  LogOut,
  MapPin,
  Package,
  RotateCcw,
  ShieldCheck,
  UserCog,
  Wallet,
} from 'lucide-react-native';
import {showAlert} from '../../lib/dialog';
import {useAuth} from '../../context/AuthContext';
import {useProfile} from '../../queries/useProfile';
import {Gradient} from '../../components/Gradient';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'Account'>;

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

export function AccountScreen() {
  const nav = useNavigation<Nav>();
  const profileQuery = useProfile();
  const {user, logout} = useAuth();

  const firstName =
    profileQuery.data?.firstName ?? user?.firstName ?? 'there';
  const lastName = profileQuery.data?.lastName ?? user?.lastName ?? '';
  const displayName = `${firstName} ${lastName}`.trim();
  const email = profileQuery.data?.email ?? user?.email ?? '';
  const initials =
    (firstName?.[0] ?? '').toUpperCase() +
    (lastName?.[0] ?? '').toUpperCase();

  const onLogout = () => {
    showAlert('Sign out?', 'You can sign back in any time.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          logout().catch(err => {
            // eslint-disable-next-line no-console
            console.error('[AccountScreen.logout]', err);
            showAlert('Logout error', 'Please try again.');
          });
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <ScrollView
        contentContainerStyle={{paddingBottom: 32}}
        showsVerticalScrollIndicator={false}>
        {/* ── Profile hero ───────────────────────────────────── */}
        <View className="px-5 pt-4">
          <View
            style={{
              borderRadius: 28,
              overflow: 'hidden',
              shadowColor: C.goldDeep,
              shadowOpacity: 0.22,
              shadowOffset: {width: 0, height: 12},
              shadowRadius: 20,
              elevation: 10,
            }}>
            <Gradient
              colors={[C.ink, C.goldDeep, C.sageDeep]}
              angle={150}
              borderRadius={28}
              style={{minHeight: 200}}>
              {/* Decorative glow blobs over the gradient — picked up
                  as light reflections instead of flat shapes. */}
              <View
                className="absolute rounded-full"
                style={{
                  width: 280,
                  height: 280,
                  right: -90,
                  top: -100,
                  backgroundColor: C.sage,
                  opacity: 0.22,
                }}
              />
              <View
                className="absolute rounded-full"
                style={{
                  width: 200,
                  height: 200,
                  left: -60,
                  bottom: -70,
                  backgroundColor: C.gold,
                  opacity: 0.15,
                }}
              />

              <View className="p-5">
                {/* Top row: avatar + member chip + edit */}
                <View className="flex-row items-start">
                  <View
                    className="rounded-full items-center justify-center mr-4"
                    style={{
                      width: 68,
                      height: 68,
                      // Frosted-glass avatar with a soft white ring —
                      // sits naturally over the dark gradient.
                      backgroundColor: 'rgba(255,255,255,0.16)',
                      borderWidth: 2,
                      borderColor: 'rgba(255,255,255,0.32)',
                    }}>
                    <Text
                      className="font-black"
                      style={{
                        color: 'white',
                        fontSize: 24,
                        letterSpacing: -0.5,
                      }}>
                      {initials || '👤'}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <View className="flex-row items-center mb-1">
                      <View
                        className="rounded-full px-2 py-0.5 flex-row items-center"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.16)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.28)',
                        }}>
                        <Crown color="white" size={10} />
                        <Text
                          className="text-[9px] font-bold ml-1"
                          style={{color: 'white', letterSpacing: 0.6}}>
                          MEMBER
                        </Text>
                      </View>
                    </View>
                    <Text
                      className="font-black"
                      style={{
                        color: 'white',
                        fontSize: 22,
                        letterSpacing: -0.6,
                      }}
                      numberOfLines={1}>
                      {displayName}
                    </Text>
                    {email ? (
                      <Text
                        className="text-xs mt-0.5"
                        style={{color: 'rgba(255,255,255,0.72)'}}
                        numberOfLines={1}>
                        {email}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    className="w-9 h-9 rounded-full items-center justify-center"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.14)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.22)',
                    }}
                    onPress={() => nav.navigate('EditProfile')}
                    activeOpacity={0.7}>
                    <Edit3 color="white" size={14} />
                  </TouchableOpacity>
                </View>

                {/* Stats row */}
                <View
                  className="flex-row mt-5 pt-5 border-t"
                  style={{borderColor: 'rgba(255,255,255,0.14)'}}>
                  <HeroStat label="Orders" value="0" />
                  <View
                    style={{
                      width: 1,
                      backgroundColor: 'rgba(255,255,255,0.14)',
                    }}
                  />
                  <HeroStat label="Wallet" value="₹0" />
                  <View
                    style={{
                      width: 1,
                      backgroundColor: 'rgba(255,255,255,0.14)',
                    }}
                  />
                  <HeroStat label="Rewards" value="120" />
                </View>
              </View>
            </Gradient>
          </View>
        </View>

        {/* ── Quick action tiles (4-up) ─────────────────────────── */}
        <View className="px-5 pt-4">
          <View className="flex-row" style={{gap: 8}}>
            <QuickTile
              icon={Package}
              label="Orders"
              tint={C.surfaceCoral}
              accent={C.sageDeep}
              onPress={() => nav.navigate('Orders')}
            />
            <QuickTile
              icon={Heart}
              label="Wishlist"
              tint={C.surfaceCoral}
              accent={C.sageDeep}
              onPress={() => nav.navigate('Wishlist')}
            />
            <QuickTile
              icon={Wallet}
              label="Wallet"
              tint={C.surfaceCoral}
              accent={C.sageDeep}
              onPress={() => nav.navigate('Wallet')}
            />
            <QuickTile
              icon={RotateCcw}
              label="Returns"
              tint={C.surfaceCoral}
              accent={C.sageDeep}
              onPress={() => nav.navigate('Returns')}
            />
          </View>
        </View>

        {/* ── My account section ────────────────────────────────── */}
        <View className="px-5 pt-5">
          <SectionLabel>MY ACCOUNT</SectionLabel>
          <View
            className="rounded-2xl overflow-hidden"
            style={{backgroundColor: C.surface}}>
            <Row
              icon={MapPin}
              label="Addresses"
              hint="Manage shipping addresses"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('Addresses')}
            />
            <Row
              icon={UserCog}
              label="Edit profile"
              hint="Name, email, phone"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('EditProfile')}
            />
            {/* Commented out per request:
            <Row
              testID="row-invoices"
              icon={FileText}
              label="My invoices"
              hint="Download GST tax documents"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('Invoices')}
            /> */}
            <Row
              icon={KeyRound}
              label="Change password"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('ChangePassword')}
              last
            />
          </View>
        </View>
        {/* ── Support & info ────────────────────────────────────── */}
        <View className="px-5 pt-5">
          <SectionLabel>SUPPORT & INFO</SectionLabel>
          <View
            className="rounded-2xl overflow-hidden"
            style={{backgroundColor: C.surface}}>
            <Row
              icon={Headphones}
              label="Help & support"
              hint="Chat, tickets, FAQs"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('Tickets')}
            />
            <Row
              testID="row-blog"
              icon={BookOpen}
              label="Stories & blog"
              hint="Reads, guides and drops"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('Blogs')}
            />
            <Row
              icon={Gift}
              label="Gift cards"
              hint="Buy and redeem"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => {}}
            />
            {/* Commented out per request:
            <Row
              testID="row-privacy"
              icon={ShieldCheck}
              label="Privacy & consent"
              hint="Consent, data export, sign-in activity"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('PrivacyConsent')}
            /> */}
            <Row
              icon={Info}
              label="About"
              hint="Version, terms, contact"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('About')}
              last
            />
          </View>
        </View>

        {/* ── Sustainability strip ──────────────────────────────── */}
        <View className="px-5 pt-4">
          <View
            className="rounded-2xl p-4 flex-row items-center"
            style={{backgroundColor: C.surfaceSage}}>
            <View
              className="w-10 h-10 rounded-full items-center justify-center mr-3"
              style={{backgroundColor: C.surfaceCoral}}>
              <Leaf color={C.sageDeep} size={16} />
            </View>
            <View className="flex-1">
              <Text
                className="text-xs font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                You've helped offset 8.4 kg of CO₂
              </Text>
              <Text
                className="text-[10px] mt-0.5"
                style={{color: C.textSecondary}}>
                Across all your Sportsmart orders
              </Text>
            </View>
          </View>
        </View>

        {/* ── Sign out ──────────────────────────────────────────── */}
        <View className="px-5 pt-5">
          <TouchableOpacity
            className="rounded-2xl py-4 flex-row items-center justify-center"
            style={{backgroundColor: C.surfaceCoral}}
            onPress={onLogout}
            activeOpacity={0.85}>
            <LogOut color={C.sageDeep} size={15} />
            <Text
              className="text-sm font-bold ml-2"
              style={{color: C.sageDeep}}>
              Sign out
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Footer signature ──────────────────────────────────── */}
        <View className="pt-6 items-center">
          <Text
            className="text-lg font-black"
            style={{
              color: C.textMuted,
              letterSpacing: -0.5,
            }}>
            SPORTSMART
          </Text>
          <Text
            className="text-[10px] mt-1"
            style={{color: C.textMuted}}>
            Made in India · © {new Date().getFullYear()}
          </Text>
        </View>
      </ScrollView>
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

function HeroStat({label, value}: {label: string; value: string}) {
  return (
    <View className="items-center flex-1">
      <Text
        className="font-black"
        style={{color: 'white', fontSize: 16, letterSpacing: -0.3}}>
        {value}
      </Text>
      <Text
        className="text-[10px] mt-1"
        style={{color: '#a3a3a3', letterSpacing: 0.3}}>
        {label}
      </Text>
    </View>
  );
}

function QuickTile({
  icon: Icon,
  label,
  tint,
  accent,
  onPress,
}: {
  icon: typeof Package;
  label: string;
  tint: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className="flex-1 rounded-2xl p-3 items-center"
      style={{backgroundColor: C.surface}}
      onPress={onPress}
      activeOpacity={0.7}>
      <View
        className="w-12 h-12 rounded-2xl items-center justify-center mb-2"
        style={{backgroundColor: tint}}>
        <Icon color={accent} size={20} />
      </View>
      <Text
        className="text-[11px] font-bold"
        style={{color: C.ink, letterSpacing: -0.1}}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Row({
  icon: Icon,
  label,
  hint,
  tint,
  iconColor,
  onPress,
  last,
  testID,
}: {
  icon: typeof Package;
  label: string;
  hint?: string;
  tint: string;
  iconColor: string;
  onPress: () => void;
  last?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      testID={testID}
      className="px-4 py-3.5 flex-row items-center"
      style={
        last
          ? undefined
          : {borderBottomWidth: 1, borderBottomColor: C.border}
      }
      onPress={onPress}
      activeOpacity={0.7}>
      <View
        className="w-10 h-10 rounded-xl items-center justify-center mr-3"
        style={{backgroundColor: tint}}>
        <Icon color={iconColor} size={17} />
      </View>
      <View className="flex-1">
        <Text
          className="text-sm font-bold"
          style={{color: C.ink, letterSpacing: -0.2}}>
          {label}
        </Text>
        {hint ? (
          <Text
            className="text-[11px] mt-0.5"
            style={{color: C.textTertiary}}>
            {hint}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={C.textMuted} size={16} />
    </TouchableOpacity>
  );
}
