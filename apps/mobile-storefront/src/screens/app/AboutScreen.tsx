import React from 'react';
import {
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gradient} from '../../components/Gradient';
import {showAlert} from '../../lib/dialog';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {LucideIcon} from 'lucide-react-native';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Github,
  Globe,
  Heart,
  Instagram,
  Mail,
  Shield,
  ShieldCheck,
  Twitter,
  Youtube,
} from 'lucide-react-native';
import {LINKS, supportMailto} from '../../lib/links';
import {useStorefrontStats} from '../../queries/useStorefrontStats';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'About'>;

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

// Marketing-grade rounding so the chip reads "50K+" rather than
// "50,123". Falls back to a comma-grouped number for small counts.
function formatStat(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `${Math.floor(n / 100_000) / 10}M+`;
  if (n >= 10_000) return `${Math.floor(n / 1_000)}K+`;
  if (n >= 1_000) return `${Math.floor(n / 100) / 10}K+`;
  return n.toLocaleString('en-IN');
}

// Hardcoded baseline so the screen always has something to show.
// useStorefrontStats() overrides any of these when the API responds.
const FALLBACK_STATS = {athletes: 50_000, brands: 500, stores: 47};

export function AboutScreen() {
  const nav = useNavigation<Nav>();
  const statsQuery = useStorefrontStats();
  const stats = statsQuery.data ?? {};

  const STATS = [
    {
      value: formatStat(stats.athletes ?? FALLBACK_STATS.athletes),
      label: 'Athletes',
    },
    {
      value: formatStat(stats.brands ?? FALLBACK_STATS.brands),
      label: 'Brands',
    },
    {
      value: formatStat(stats.stores ?? FALLBACK_STATS.stores),
      label: 'Stores',
    },
  ];

  const openUrl = async (url: string, label: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        showAlert(`Cannot open ${label}`, 'Try again from a browser.');
        return;
      }
      await Linking.openURL(url);
    } catch {
      showAlert(`Cannot open ${label}`, 'Try again from a browser.');
    }
  };

  const emailSupport = () => openUrl(supportMailto(), 'email');

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
          About
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{paddingBottom: 40}}
        showsVerticalScrollIndicator={false}>
        {/* ── Brand hero — dark gradient identity surface ──── */}
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
              borderRadius={28}>
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
                    fontSize: 30,
                    letterSpacing: -1.1,
                  }}>
                  SPORTSMART
                </Text>
                <Text
                  className="text-xs mt-1.5"
                  style={{
                    color: 'rgba(255,255,255,0.78)',
                    letterSpacing: 0.5,
                    lineHeight: 18,
                  }}>
                  India's home for sports gear, since 2026.
                </Text>

                <View className="flex-row mt-6 flex-wrap" style={{gap: 6}}>
                  {/* "Made in India" cultural badge. */}
                  <View
                    className="rounded-full px-2.5 py-1"
                    style={{backgroundColor: 'white'}}>
                    <Text
                      className="text-[10px] font-bold"
                      style={{color: C.ink, letterSpacing: 0.5}}>
                      Made in India
                    </Text>
                  </View>
                </View>
              </View>
            </Gradient>
          </View>
        </View>

        {/* ── Stats strip — accent rules under each value ──── */}
        <View className="px-5 pt-4">
          <View
            className="rounded-2xl px-2 py-5 flex-row justify-around"
            style={{
              backgroundColor: C.surface,
              shadowColor: C.ink,
              shadowOpacity: 0.06,
              shadowOffset: {width: 0, height: 4},
              shadowRadius: 10,
              elevation: 2,
            }}>
            {STATS.map((s, i) => {
              // Single red accent so the stat micro-bars read as one
              // cohesive set (brand-consistent with the icon tiles).
              const accent = C.sageDeep;
              return (
                <React.Fragment key={s.label}>
                  <View className="items-center flex-1">
                    <Text
                      className="font-black"
                      style={{
                        color: C.ink,
                        fontSize: 18,
                        letterSpacing: -0.4,
                      }}>
                      {s.value}
                    </Text>
                    <View
                      className="rounded-full mt-1.5"
                      style={{
                        height: 2,
                        width: 18,
                        backgroundColor: accent,
                      }}
                    />
                    <Text
                      className="text-[10px] mt-1.5 font-medium"
                      style={{
                        color: C.textTertiary,
                        letterSpacing: 0.5,
                      }}>
                      {s.label}
                    </Text>
                  </View>
                  {i < STATS.length - 1 ? (
                    <View
                      style={{width: 1, backgroundColor: C.border}}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </View>
        </View>

        {/* ── Legal ────────────────────────────────────────── */}
        <View className="px-5 pt-5">
          <SectionLabel>LEGAL</SectionLabel>
          <View
            className="rounded-2xl overflow-hidden"
            style={{backgroundColor: C.surface}}>
            <Row
              icon={Shield}
              label="Privacy policy"
              hint="How we handle your data"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => openUrl(LINKS.privacy, 'privacy policy')}
            />
            <Row
              icon={FileText}
              label="Terms of service"
              hint="The rules of the marketplace"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => openUrl(LINKS.terms, 'terms of service')}
            />
            <Row
              icon={ShieldCheck}
              label="Download your data"
              hint="DPDP-compliant export"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => nav.navigate('DataExport')}
              last
            />
          </View>
        </View>

        {/* ── Contact ──────────────────────────────────────── */}
        <View className="px-5 pt-5">
          <SectionLabel>GET IN TOUCH</SectionLabel>
          <View
            className="rounded-2xl overflow-hidden"
            style={{backgroundColor: C.surface}}>
            <Row
              icon={Globe}
              label="Visit sportsmart.com"
              hint="The full web store"
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={() => openUrl(LINKS.website, 'website')}
            />
            <Row
              icon={Mail}
              label="Contact support"
              hint={LINKS.supportEmail}
              tint={C.surfaceCoral}
              iconColor={C.sageDeep}
              onPress={emailSupport}
              last
            />
          </View>
        </View>

        {/* ── Social ───────────────────────────────────────── */}
        <View className="px-5 pt-5">
          <SectionLabel>FOLLOW</SectionLabel>
          <View
            className="rounded-2xl p-4 flex-row justify-around"
            style={{backgroundColor: C.surface}}>
            {[
              {Icon: Instagram, label: 'Instagram', url: LINKS.social.instagram},
              {Icon: Twitter, label: 'Twitter', url: LINKS.social.twitter},
              {Icon: Youtube, label: 'YouTube', url: LINKS.social.youtube},
              {Icon: Github, label: 'GitHub', url: LINKS.social.github},
            ].map(s => (
              <TouchableOpacity
                key={s.label}
                className="items-center"
                activeOpacity={0.7}
                onPress={() => openUrl(s.url, s.label)}>
                <View
                  className="w-12 h-12 rounded-2xl items-center justify-center mb-1.5"
                  style={{backgroundColor: C.surfaceCoral}}>
                  <s.Icon color={C.sageDeep} size={18} />
                </View>
                <Text
                  className="text-[10px] font-semibold"
                  style={{color: C.textSecondary}}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Footer signature ─────────────────────────────── */}
        <View className="px-5 pt-8 items-center">
          <View className="flex-row items-center mb-2">
            <Text
              className="text-[11px]"
              style={{color: C.textTertiary}}>
              Made with
            </Text>
            <Heart
              color={C.coralDeep}
              size={11}
              fill={C.coralDeep}
              style={{marginHorizontal: 4}}
            />
            <Text
              className="text-[11px]"
              style={{color: C.textTertiary}}>
              in India
            </Text>
          </View>
          <Text
            className="text-[10px]"
            style={{color: C.textMuted}}>
            © {new Date().getFullYear()} Sportsmart Technologies Pvt Ltd
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Atoms ──────────────────────────────────────────────────────────────

function SectionLabel({children}: {children: React.ReactNode}) {
  return (
    <Text
      className="text-[10px] font-bold tracking-widest mb-2 px-1"
      style={{color: C.textTertiary, letterSpacing: 1.8}}>
      {children}
    </Text>
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
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  tint: string;
  iconColor: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
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
