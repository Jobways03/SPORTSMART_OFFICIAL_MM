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
import {Gradient} from '../../components/Gradient';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  Gift,
  Info,
  Lock,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react-native';
import {
  useInitiateTopup,
  useVerifyTopup,
  useWalletBalance,
} from '../../queries/useWallet';
import {useProfile} from '../../queries/useProfile';
import {showAlert} from '../../lib/dialog';
import {formatPaise} from '../../services/wallet.service';
import {openRazorpayCheckout} from '../../lib/razorpay';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'WalletTopup'>;

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

const QUICK_AMOUNTS = [100, 500, 1000, 2000, 5000, 10000];
const MIN_TOPUP = 10;

// Bonus tiers: top-up X or more, get Y extra. Pure UX flair — backend
// doesn't apply these; the actual credit is just the top-up amount.
function bonusFor(amount: number): number {
  if (amount >= 5000) return 250;
  if (amount >= 2000) return 100;
  if (amount >= 1000) return 50;
  if (amount >= 500) return 20;
  return 0;
}

function nextBonusTier(amount: number): {target: number; bonus: number} | null {
  if (amount < 500) return {target: 500, bonus: 20};
  if (amount < 1000) return {target: 1000, bonus: 50};
  if (amount < 2000) return {target: 2000, bonus: 100};
  if (amount < 5000) return {target: 5000, bonus: 250};
  return null;
}

export function WalletTopupScreen() {
  const nav = useNavigation<Nav>();
  const profileQuery = useProfile();
  const balanceQuery = useWalletBalance();
  const initiate = useInitiateTopup();
  const verify = useVerifyTopup();
  const [amount, setAmount] = useState('');
  const [paying, setPaying] = useState(false);

  const parsed = Number.parseInt(amount, 10) || 0;
  const valid = parsed >= MIN_TOPUP;
  const currentBalance = balanceQuery.data?.balanceInPaise ?? 0;
  const bonus = bonusFor(parsed);
  const nextTier = nextBonusTier(parsed);
  const projectedBalance = currentBalance + parsed * 100 + bonus * 100;

  const onPay = async () => {
    if (!valid) {
      showAlert(
        'Enter a higher amount',
        `Minimum top-up is ${formatPaise(MIN_TOPUP * 100)}.`,
      );
      return;
    }
    setPaying(true);
    try {
      const init = await initiate.mutateAsync(parsed * 100);
      const handoff = init.data;
      if (!handoff?.razorpayOrderId) {
        showAlert(
          'Could not start top-up',
          init.message || 'Try again in a moment.',
        );
        return;
      }
      const sheet = await openRazorpayCheckout({
        razorpayOrderId: handoff.razorpayOrderId,
        amountInPaise: handoff.amountInPaise,
        currency: handoff.currency,
        orderNumber: `Wallet top-up`,
        customerName: profileQuery.data
          ? `${profileQuery.data.firstName} ${profileQuery.data.lastName}`
          : null,
        customerEmail: profileQuery.data?.email ?? null,
        customerPhone: profileQuery.data?.phone ?? null,
      });
      if (sheet.status === 'success') {
        try {
          await verify.mutateAsync({
            walletTransactionId: handoff.walletTransactionId,
            razorpayOrderId: sheet.razorpayOrderId!,
            razorpayPaymentId: sheet.razorpayPaymentId!,
            razorpaySignature: sheet.razorpaySignature!,
          });
          showAlert(
            'Top-up successful',
            `${formatPaise(parsed * 100)} added to your wallet.`,
            [{text: 'OK', onPress: () => nav.goBack()}],
          );
        } catch (err) {
          showAlert(
            'Top-up recorded but not verified',
            err instanceof Error
              ? err.message
              : 'Our system will reconcile shortly. Pull to refresh the wallet.',
            [{text: 'OK', onPress: () => nav.goBack()}],
          );
        }
      } else if (sheet.status === 'error') {
        showAlert('Top-up failed', sheet.error ?? 'Try again.');
      } else if (sheet.status === 'dismissed') {
        showAlert(
          'Top-up cancelled',
          'If you were charged, the credit will land in your wallet in a minute or two. Pull to refresh the wallet to check.',
        );
      }
    } catch (err) {
      showAlert(
        'Could not start top-up',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setPaying(false);
    }
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
            TOP UP
          </Text>
          <Text
            className="font-black"
            style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
            Add money
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{paddingBottom: 140}}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* ── Hero "adding" card (dark luxury) ─────────────── */}
          <View className="px-5 pt-4">
            <View
              style={{
                borderRadius: 28,
                overflow: 'hidden',
                shadowColor: C.goldDeep,
                shadowOpacity: 0.24,
                shadowOffset: {width: 0, height: 12},
                shadowRadius: 20,
                elevation: 10,
              }}>
              <Gradient
                colors={[C.ink, C.goldDeep, C.sageDeep]}
                angle={150}
                borderRadius={28}
                style={{minHeight: 220}}>
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

                <View className="p-5">
                  <View className="flex-row items-center mb-1">
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center mr-2.5"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.16)',
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.25)',
                      }}>
                      <Wallet color="white" size={16} />
                    </View>
                    <View>
                      <Text
                        className="text-[10px] font-bold tracking-widest"
                        style={{color: 'white', letterSpacing: 2}}>
                        YOU'RE ADDING
                      </Text>
                      <Text
                        className="text-[10px] mt-0.5"
                        style={{color: 'rgba(255,255,255,0.7)'}}>
                        To Sportsmart Wallet
                      </Text>
                    </View>
                  </View>

                  <View className="mt-4">
                    <Text
                      className="font-black"
                      style={{
                        color: 'white',
                        fontSize: 46,
                        letterSpacing: -2,
                        lineHeight: 50,
                      }}>
                      {parsed > 0 ? formatPaise(parsed * 100) : '₹—'}
                    </Text>
                    {bonus > 0 ? (
                      <View
                        className="self-start rounded-full px-2.5 py-1 flex-row items-center mt-2"
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.16)',
                          borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.3)',
                        }}>
                        <Gift color="white" size={11} />
                        <Text
                          className="text-[10px] font-bold ml-1"
                          style={{color: 'white', letterSpacing: 0.4}}>
                          +{formatPaise(bonus * 100)} BONUS
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Balance preview row — frosted-glass cells flank
                      the arrow so the projection feels like a wire
                      transfer, not just two static numbers. */}
                  <View
                    className="flex-row mt-5 pt-4 border-t"
                    style={{
                      borderColor: 'rgba(255,255,255,0.14)',
                    }}>
                    <View className="flex-1">
                      <Text
                        className="text-[10px] font-bold tracking-widest"
                        style={{
                          color: 'rgba(255,255,255,0.65)',
                          letterSpacing: 1.5,
                        }}>
                        CURRENT
                      </Text>
                      <Text className="text-xs font-bold text-white mt-1">
                        {formatPaise(currentBalance)}
                      </Text>
                    </View>
                    <View className="items-center justify-center px-2">
                      <ArrowRight color="white" size={14} />
                    </View>
                    <View className="flex-1 items-end">
                      <Text
                        className="text-[10px] font-bold tracking-widest"
                        style={{color: 'white', letterSpacing: 1.5}}>
                        NEW BALANCE
                      </Text>
                      <Text
                        className="text-xs font-bold mt-1"
                        style={{color: 'white'}}>
                        {formatPaise(projectedBalance)}
                      </Text>
                    </View>
                  </View>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── Next bonus tier nudge ─────────────────────────── */}
          {nextTier ? (
            <View className="px-5 pt-3">
              <View
                className="rounded-2xl p-3 flex-row items-center"
                style={{backgroundColor: C.surfaceGold}}>
                <View
                  className="w-9 h-9 rounded-full items-center justify-center mr-3"
                  style={{backgroundColor: C.gold}}>
                  <Sparkles color={C.ink} size={14} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-xs font-bold"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    Add ₹{nextTier.target - parsed} more for ₹{nextTier.bonus} bonus
                  </Text>
                  <Text
                    className="text-[10px] mt-0.5"
                    style={{color: C.inkSoft}}>
                    Top up ₹{nextTier.target.toLocaleString('en-IN')}+ to
                    earn ₹{nextTier.bonus} extra
                  </Text>
                </View>
                <TouchableOpacity
                  className="rounded-full px-3 py-1.5"
                  style={{backgroundColor: C.ink}}
                  activeOpacity={0.85}
                  onPress={() => setAmount(String(nextTier.target))}>
                  <Text
                    className="text-[10px] font-bold text-white"
                    style={{letterSpacing: 0.3}}>
                    TOP UP
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : parsed >= 5000 ? (
            <View className="px-5 pt-3">
              <View
                className="rounded-2xl p-3 flex-row items-center"
                style={{backgroundColor: C.surfaceSage}}>
                <CheckCircle2 color={C.sageDeep} size={14} />
                <Text
                  className="text-xs font-bold ml-2"
                  style={{color: C.sageDeep}}>
                  Max bonus unlocked · ₹{bonus} extra
                </Text>
              </View>
            </View>
          ) : null}

          {/* ── Amount input ──────────────────────────────────── */}
          <View className="px-5 pt-5">
            <SectionLabel>ENTER AMOUNT</SectionLabel>
            <View
              className="rounded-2xl p-4 flex-row items-center"
              style={{
                backgroundColor: C.surface,
                borderWidth: 1.5,
                borderColor: parsed > 0 ? C.ink : C.border,
              }}>
              <Text
                className="font-black mr-3"
                style={{color: C.textMuted, fontSize: 28, letterSpacing: -0.5}}>
                ₹
              </Text>
              <TextInput
                className="flex-1 font-black"
                style={{
                  color: C.ink,
                  fontSize: 28,
                  letterSpacing: -0.8,
                }}
                value={amount}
                onChangeText={t => setAmount(t.replace(/[^\d]/g, ''))}
                placeholder="0"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={6}
                editable={!paying}
              />
              {amount ? (
                <TouchableOpacity
                  onPress={() => setAmount('')}
                  activeOpacity={0.7}>
                  <Text
                    className="text-xs font-bold"
                    style={{color: C.textTertiary}}>
                    CLEAR
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text
              className="text-[10px] mt-1.5 ml-1"
              style={{color: C.textTertiary}}>
              Min ₹{MIN_TOPUP} · Max ₹100,000 per top-up
            </Text>
          </View>

          {/* ── Quick amount chips ────────────────────────────── */}
          <View className="px-5 pt-5">
            <SectionLabel>QUICK AMOUNTS</SectionLabel>
            <View className="flex-row flex-wrap" style={{gap: 8}}>
              {QUICK_AMOUNTS.map(amt => {
                const selected = parsed === amt;
                const tierBonus = bonusFor(amt);
                return (
                  <TouchableOpacity
                    key={amt}
                    className="rounded-xl items-center justify-center px-4 py-3"
                    style={{
                      backgroundColor: selected ? C.ink : C.surface,
                      borderWidth: 1.5,
                      borderColor: selected ? C.ink : C.border,
                      minWidth: 90,
                    }}
                    onPress={() => setAmount(String(amt))}
                    disabled={paying}
                    activeOpacity={0.7}>
                    <Text
                      className="text-sm font-black"
                      style={{
                        color: selected ? 'white' : C.ink,
                        letterSpacing: -0.3,
                      }}>
                      ₹{amt.toLocaleString('en-IN')}
                    </Text>
                    {tierBonus > 0 ? (
                      <Text
                        className="text-[9px] font-bold mt-0.5"
                        style={{
                          color: selected ? C.gold : C.goldDeep,
                          letterSpacing: 0.3,
                        }}>
                        +₹{tierBonus} BONUS
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── Payment method preview ─────────────────────────── */}
          <View className="px-5 pt-5">
            <SectionLabel>PAYMENT METHOD</SectionLabel>
            <View
              className="rounded-2xl p-4 flex-row items-center"
              style={{
                backgroundColor: C.surfaceGold,
                borderWidth: 1.5,
                borderColor: C.gold,
              }}>
              <View
                className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                style={{backgroundColor: C.gold}}>
                <CreditCard color={C.ink} size={18} />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center mb-0.5">
                  <Text
                    className="text-sm font-bold"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    Pay with Razorpay
                  </Text>
                  <View
                    className="ml-2 rounded-full px-1.5 py-0.5"
                    style={{backgroundColor: C.ink}}>
                    <Text
                      className="text-[8px] font-bold text-white"
                      style={{letterSpacing: 0.3}}>
                      SECURE
                    </Text>
                  </View>
                </View>
                <Text
                  className="text-[11px]"
                  style={{color: C.inkSoft}}>
                  UPI · Cards · Wallets · Netbanking
                </Text>
              </View>
            </View>
          </View>

          {/* ── Bonus tiers info card ─────────────────────────── */}
          <View className="px-5 pt-5">
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surface}}>
              <View className="flex-row items-center mb-3">
                <TrendingUp color={C.goldDeep} size={14} />
                <Text
                  className="text-[10px] font-bold tracking-widest ml-2"
                  style={{color: C.goldDeep, letterSpacing: 1.8}}>
                  TOP UP, EARN MORE
                </Text>
              </View>
              {[
                {min: 500, bonus: 20},
                {min: 1000, bonus: 50},
                {min: 2000, bonus: 100},
                {min: 5000, bonus: 250},
              ].map(tier => {
                const hit = parsed >= tier.min;
                return (
                  <View
                    key={tier.min}
                    className="flex-row items-center py-1.5">
                    <View
                      className="w-5 h-5 rounded-full items-center justify-center mr-3"
                      style={{
                        backgroundColor: hit ? C.sage : C.surfaceWarm,
                      }}>
                      {hit ? (
                        <CheckCircle2 color="white" size={11} />
                      ) : (
                        <Text
                          className="text-[9px] font-bold"
                          style={{color: C.textMuted}}>
                          ★
                        </Text>
                      )}
                    </View>
                    <Text
                      className="text-xs flex-1"
                      style={{
                        color: hit ? C.ink : C.textSecondary,
                        fontWeight: hit ? '700' : '500',
                      }}>
                      Top up ₹{tier.min.toLocaleString('en-IN')}+
                    </Text>
                    <Text
                      className="text-xs font-bold"
                      style={{color: hit ? C.sageDeep : C.textTertiary}}>
                      +₹{tier.bonus}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* ── Trust strip ───────────────────────────────────── */}
          <View className="px-5 pt-4">
            <View
              className="rounded-2xl px-4 py-4 flex-row justify-around"
              style={{backgroundColor: C.surface}}>
              {[
                {Icon: Zap, label: 'Instant credit'},
                {Icon: ShieldCheck, label: '256-bit secure'},
                {Icon: Info, label: 'Tax-free'},
              ].map(t => (
                <View key={t.label} className="items-center flex-1">
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mb-1.5"
                    style={{backgroundColor: C.surfaceSage}}>
                    <t.Icon color={C.sageDeep} size={15} />
                  </View>
                  <Text
                    className="text-[10px] font-bold"
                    style={{color: C.ink}}>
                    {t.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── Fine print ────────────────────────────────────── */}
          <Text
            className="text-[10px] text-center px-6 pt-4 leading-4"
            style={{color: C.textTertiary}}>
            Wallet credit never expires but is non-refundable to bank.
            Use it on any future Sportsmart order.
          </Text>
        </ScrollView>

        {/* ── Sticky bottom Pay bar ─────────────────────────────── */}
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
          <View className="flex-row items-center mb-2">
            <Lock color={C.textTertiary} size={11} />
            <Text
              className="text-[10px] font-semibold ml-1.5"
              style={{color: C.textTertiary, letterSpacing: 0.4}}>
              SECURE PAYMENT VIA RAZORPAY
            </Text>
          </View>
          {/* Premium gradient when valid — same family as Checkout
              Pay, Cart Proceed, PDP Buy now. Disabled state stays
              flat-muted with explicit copy. */}
          {!valid || paying ? (
            <TouchableOpacity
              className="rounded-2xl py-3.5 flex-row items-center justify-center"
              style={{backgroundColor: C.textMuted}}
              disabled
              activeOpacity={1}>
              {paying ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-sm font-bold text-white">
                  Enter at least ₹{MIN_TOPUP}
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
                  onPress={onPay}
                  activeOpacity={0.85}>
                  <Text
                    className="text-sm font-bold text-white mr-2"
                    style={{letterSpacing: -0.2}}>
                    Pay {formatPaise(parsed * 100)}
                  </Text>
                  <ArrowRight color="white" size={15} />
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
