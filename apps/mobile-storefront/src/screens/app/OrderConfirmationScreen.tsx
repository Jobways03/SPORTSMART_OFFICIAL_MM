import React from 'react';
import {ScrollView, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {BackButton} from '../../components/BackButton';
import {Gradient} from '../../components/Gradient';
import {useNavigation, useRoute, CommonActions} from '@react-navigation/native';
import {useShareInvite} from '../../lib/share';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Gift,
  Headphones,
  Package,
  Share2,
  Sparkles,
  Truck,
} from 'lucide-react-native';
import type {CartStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<CartStackParamList, 'OrderConfirmation'>;
type Route = RouteProp<CartStackParamList, 'OrderConfirmation'>;

// Warm premium palette mirrors HomeScreen / PDP / Cart / Checkout.
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

// Estimated delivery is a static 3-day window from now — when the
// backend ships a real expected-delivery field on the order, this
// pulls from there instead.
function getEstimatedDelivery(): string {
  const earliest = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const latest = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'});
  return `${fmt(earliest)} — ${fmt(latest)}`;
}

const NEXT_STEPS = [
  {Icon: CheckCircle2, label: 'Order confirmed', sub: 'Just now', done: true},
  {Icon: Package, label: 'Packing & dispatch', sub: 'Within 24 hrs', done: false},
  {Icon: Truck, label: 'Out for delivery', sub: 'In 2–4 days', done: false},
  {Icon: Gift, label: 'Delivered to you', sub: 'In 3–5 days', done: false},
];

export function OrderConfirmationScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const {orderNumber, paid, cod} = params;
  const {share: shareInvite, justCopied: inviteCopied} = useShareInvite();

  const openOrder = () => {
    nav.getParent()?.dispatch(
      CommonActions.navigate({
        name: 'AccountTab',
        params: {
          screen: 'OrderDetail',
          params: {orderNumber},
        },
      }),
    );
  };

  const backToShop = () => {
    nav.popToTop();
    nav.getParent()?.navigate('BrowseTab');
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <View className="px-5 pt-1 pb-2">
        <BackButton onPress={backToShop} />
      </View>
      <ScrollView
        contentContainerStyle={{paddingBottom: 160}}
        showsVerticalScrollIndicator={false}>

        {/* ── Estimated delivery ─────────────────────────────────── */}
        {paid ? (
          <View className="px-5 pt-4">
            <View
              className="rounded-2xl p-4 flex-row items-center"
              style={{backgroundColor: C.surfaceGold}}>
              <View
                className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                style={{backgroundColor: C.gold}}>
                <Truck color="white" size={20} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] font-bold tracking-widest"
                  style={{color: C.goldDeep, letterSpacing: 1.5}}>
                  ESTIMATED DELIVERY
                </Text>
                <Text
                  className="text-sm font-bold mt-0.5"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  {getEstimatedDelivery()}
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{color: C.inkSoft}}>
                  Tracking link will be emailed when shipped
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* ── Next-steps timeline ───────────────────────────────── */}
        {paid ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-5"
              style={{backgroundColor: C.surface}}>
              <Text
                className="text-[10px] font-bold tracking-widest mb-4"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                WHAT HAPPENS NEXT
              </Text>
              {NEXT_STEPS.map((step, idx) => {
                const isLast = idx === NEXT_STEPS.length - 1;
                return (
                  <View key={step.label} className="flex-row">
                    <View className="items-center mr-3">
                      <View
                        className="w-9 h-9 rounded-full items-center justify-center"
                        style={{
                          backgroundColor: step.done
                            ? C.sage
                            : C.surfaceWarm,
                        }}>
                        <step.Icon
                          color={step.done ? 'white' : C.textTertiary}
                          size={15}
                        />
                      </View>
                      {!isLast ? (
                        <View
                          style={{
                            width: 2,
                            flex: 1,
                            backgroundColor: step.done ? C.sage : C.border,
                            marginTop: 2,
                            marginBottom: 2,
                          }}
                        />
                      ) : null}
                    </View>
                    <View
                      className={`flex-1 ${isLast ? 'pb-0' : 'pb-5'}`}>
                      <Text
                        className="text-sm font-bold"
                        style={{
                          color: step.done ? C.ink : C.textSecondary,
                          letterSpacing: -0.2,
                        }}>
                        {step.label}
                      </Text>
                      <Text
                        className="text-[11px] mt-0.5"
                        style={{
                          color: step.done ? C.sageDeep : C.textTertiary,
                        }}>
                        {step.sub}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* ── Pending: retry payment guidance ────────────────────── */}
        {!paid ? (
          <View className="px-5 pt-4">
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surface}}>
              <View className="flex-row items-center mb-3">
                <Clock color={C.goldDeep} size={14} />
                <Text
                  className="text-sm font-bold ml-2"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Two ways to complete
                </Text>
              </View>
              <View
                className="rounded-xl p-3 mb-2 flex-row items-start"
                style={{backgroundColor: C.surfaceWarm}}>
                <View
                  className="w-6 h-6 rounded-full items-center justify-center mr-2 mt-0.5"
                  style={{backgroundColor: C.ink}}>
                  <Text className="text-[10px] font-bold text-white">1</Text>
                </View>
                <View className="flex-1">
                  <Text
                    className="text-xs font-bold"
                    style={{color: C.ink}}>
                    If you already paid
                  </Text>
                  <Text
                    className="text-[11px] mt-0.5"
                    style={{color: C.textSecondary}}>
                    We're verifying with Razorpay. Refresh this order
                    page in a minute — it'll update automatically.
                  </Text>
                </View>
              </View>
              <View
                className="rounded-xl p-3 flex-row items-start"
                style={{backgroundColor: C.surfaceWarm}}>
                <View
                  className="w-6 h-6 rounded-full items-center justify-center mr-2 mt-0.5"
                  style={{backgroundColor: C.ink}}>
                  <Text className="text-[10px] font-bold text-white">2</Text>
                </View>
                <View className="flex-1">
                  <Text
                    className="text-xs font-bold"
                    style={{color: C.ink}}>
                    If you didn't pay
                  </Text>
                  <Text
                    className="text-[11px] mt-0.5"
                    style={{color: C.textSecondary}}>
                    Open this order and tap Retry payment. Your items
                    stay reserved for the next 30 minutes.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* ── Help / support strip ──────────────────────────────── */}
        <View className="px-5 pt-3">
          <View
            className="rounded-2xl p-4 flex-row items-center"
            style={{backgroundColor: C.surface}}>
            <View
              className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
              style={{backgroundColor: C.surfaceSage}}>
              <Headphones color={C.sageDeep} size={18} />
            </View>
            <View className="flex-1">
              <Text
                className="text-sm font-bold"
                style={{color: C.ink, letterSpacing: -0.2}}>
                Need help?
              </Text>
              <Text
                className="text-[11px] mt-0.5"
                style={{color: C.textSecondary}}>
                Reply within 30 minutes · 9 am to 9 pm IST
              </Text>
            </View>
            <Text
              className="text-[10px] font-bold tracking-widest"
              style={{color: C.sageDeep, letterSpacing: 1.5}}>
              CONTACT
            </Text>
          </View>
        </View>

        {/* ── Share with friends (paid only) ────────────────────── */}
        {paid ? (
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-4 overflow-hidden relative"
              style={{backgroundColor: C.surfaceMauve}}>
              <View
                className="absolute rounded-full"
                style={{
                  width: 160,
                  height: 160,
                  right: -50,
                  top: -50,
                  backgroundColor: 'rgba(200,168,120,0.15)',
                }}
              />
              <View className="flex-row items-center mb-2">
                <Sparkles color={C.goldDeep} size={14} />
                <Text
                  className="text-[10px] font-bold tracking-widest ml-2"
                  style={{color: C.goldDeep, letterSpacing: 1.8}}>
                  REFER & EARN
                </Text>
              </View>
              <Text
                className="font-black mb-1"
                style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
                Share Sportsmart, earn ₹500
              </Text>
              <Text
                className="text-xs mb-3"
                style={{color: C.inkSoft}}>
                Friends get ₹250 off, you get ₹500 in wallet on their
                first order.
              </Text>
              <TouchableOpacity
                className="rounded-full px-4 py-2 self-start flex-row items-center"
                style={{backgroundColor: C.ink}}
                activeOpacity={0.85}
                onPress={shareInvite}>
                <Share2 color="white" size={12} />
                <Text
                  className="text-[11px] font-bold text-white ml-1.5"
                  style={{letterSpacing: 0.3}}>
                  {inviteCopied ? 'Link copied!' : 'Share invite link'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Sticky bottom CTAs ────────────────────────────────── */}
      <View
        className="absolute bottom-0 left-0 right-0 px-5 pt-4 pb-4 flex-row"
        style={{
          backgroundColor: C.surface,
          borderTopWidth: 1,
          borderTopColor: C.border,
          gap: 10,
          shadowColor: C.ink,
          shadowOpacity: 0.08,
          shadowOffset: {width: 0, height: -6},
          shadowRadius: 16,
          elevation: 12,
        }}>
        {/* Both CTAs are the same solid red. Plain TouchableOpacitys
            (no Gradient) so the labels centre reliably — the Gradient
            wrapper's extra layer was pushing "View order" off-centre. */}
        <TouchableOpacity
          className="flex-1 rounded-2xl items-center justify-center"
          style={{backgroundColor: C.sageDeep, height: 50}}
          onPress={backToShop}
          activeOpacity={0.85}>
          <Text
            className="text-sm font-bold"
            style={{color: 'white', letterSpacing: -0.2}}>
            Keep shopping
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 rounded-2xl flex-row items-center justify-center"
          style={{
            backgroundColor: C.sageDeep,
            height: 50,
            shadowColor: C.sageDeep,
            shadowOpacity: 0.32,
            shadowOffset: {width: 0, height: 4},
            shadowRadius: 10,
            elevation: 6,
          }}
          onPress={openOrder}
          activeOpacity={0.85}>
          <Text
            className="text-sm font-bold text-white mr-2"
            style={{letterSpacing: -0.2}}>
            View order
          </Text>
          <ArrowRight color="white" size={15} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
