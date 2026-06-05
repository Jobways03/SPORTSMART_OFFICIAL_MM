import React from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gradient} from '../../components/Gradient';
import {showAlert} from '../../lib/dialog';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Crown,
  Edit3,
  Info,
  MapPin,
  Plus,
  Star,
  Trash2,
} from 'lucide-react-native';
import {
  useAddresses,
  useDeleteAddress,
  useSetDefaultAddress,
} from '../../queries/useAddresses';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'Addresses'>;

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

// Pick a label for each saved address based on what's there. With no
// address-type field on the API, this is a small heuristic that gives
// the cards visual hierarchy until type lands server-side.
function labelFor(addr: {addressLine1: string; locality: string | null}): {
  text: string;
  bg: string;
  fg: string;
} {
  const haystack = `${addr.addressLine1} ${addr.locality ?? ''}`.toLowerCase();
  if (/office|tower|complex|park|corp|business/.test(haystack)) {
    return {text: 'OFFICE', bg: C.surfaceMauve, fg: C.inkSoft};
  }
  return {text: 'HOME', bg: C.surfaceSage, fg: C.sageDeep};
}

export function AddressesScreen() {
  const nav = useNavigation<Nav>();
  const query = useAddresses();
  const removeMutation = useDeleteAddress();
  const setDefaultMutation = useSetDefaultAddress();

  if (query.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
        <Header nav={nav} count={0} />
        <View className="flex-1 items-center justify-center">
          <Spinner />
        </View>
      </SafeAreaView>
    );
  }
  if (query.isError) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <ErrorState onRetry={query.refetch} />
      </SafeAreaView>
    );
  }

  const addresses = query.data ?? [];

  // Default first, then everything else in their natural order.
  const sorted = [...addresses].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault),
  );

  if (addresses.length === 0) return <EmptyAddresses nav={nav} />;

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} count={addresses.length} />

      <FlatList
        data={sorted}
        keyExtractor={item => item.id}
        contentContainerStyle={{paddingBottom: 100}}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={query.refetch}
            tintColor={C.sageDeep}
          />
        }
        ListHeaderComponent={
          <>
            {/* ── Top info card ─────────────────────────────────── */}
            <View className="px-5 pt-4">
              <View
                className="rounded-2xl p-4 flex-row items-center"
                style={{backgroundColor: C.surfaceSage}}>
                <View
                  className="w-10 h-10 rounded-full items-center justify-center mr-3"
                  style={{backgroundColor: C.sage}}>
                  <Info color="white" size={16} />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-xs font-bold"
                    style={{color: C.ink, letterSpacing: -0.2}}>
                    Default ships fastest
                  </Text>
                  <Text
                    className="text-[11px] mt-0.5"
                    style={{color: C.inkSoft}}>
                    Checkout uses the default address. Edit any time.
                  </Text>
                </View>
              </View>
            </View>

            <View className="px-5 pt-5 pb-1">
              <Text
                className="text-[10px] font-bold tracking-widest"
                style={{color: C.textTertiary, letterSpacing: 1.8}}>
                SAVED · {addresses.length}
              </Text>
            </View>
          </>
        }
        ItemSeparatorComponent={() => <View style={{height: 10}} />}
        renderItem={({item}) => {
          const label = labelFor(item);
          const isDefault = item.isDefault;
          return (
            <View className="px-5">
              <TouchableOpacity
                className="rounded-2xl overflow-hidden"
                style={{
                  backgroundColor: C.surface,
                  borderWidth: isDefault ? 1.5 : 1,
                  borderColor: isDefault ? C.gold : C.border,
                }}
                onPress={() =>
                  nav.navigate('AddressForm', {addressId: item.id})
                }
                activeOpacity={0.85}>
                {/* Default ribbon */}
                {isDefault ? (
                  <View
                    className="flex-row items-center px-4 py-2"
                    style={{backgroundColor: C.surfaceGold}}>
                    <Crown color={C.goldDeep} size={11} />
                    <Text
                      className="text-[10px] font-bold ml-1.5"
                      style={{color: C.goldDeep, letterSpacing: 1.5}}>
                      DEFAULT ADDRESS
                    </Text>
                    <View className="flex-1" />
                    <CheckCircle2 color={C.goldDeep} size={12} />
                  </View>
                ) : null}

                {/* Body */}
                <View className="p-4">
                  <View className="flex-row items-start mb-3">
                    <View
                      className="w-10 h-10 rounded-2xl items-center justify-center mr-3"
                      style={{backgroundColor: label.bg}}>
                      <MapPin color={label.fg} size={17} />
                    </View>
                    <View className="flex-1">
                      <View className="flex-row items-center mb-1">
                        <Text
                          className="text-sm font-bold flex-1 mr-2"
                          style={{color: C.ink, letterSpacing: -0.2}}
                          numberOfLines={1}>
                          {item.fullName}
                        </Text>
                        <View
                          className="rounded-full px-2 py-0.5"
                          style={{backgroundColor: label.bg}}>
                          <Text
                            className="text-[9px] font-bold"
                            style={{
                              color: label.fg,
                              letterSpacing: 0.5,
                            }}>
                            {label.text}
                          </Text>
                        </View>
                      </View>
                      <Text
                        className="text-xs leading-5"
                        style={{color: C.textSecondary}}>
                        {item.addressLine1}
                        {item.addressLine2 ? `, ${item.addressLine2}` : ''}
                      </Text>
                      <Text
                        className="text-xs leading-5"
                        style={{color: C.textSecondary}}>
                        {[item.locality, item.city, item.state]
                          .filter(Boolean)
                          .join(', ')}{' '}
                        — {item.postalCode}
                      </Text>
                      <Text
                        className="text-[11px] mt-1"
                        style={{color: C.textTertiary}}>
                        📞 {item.phone}
                      </Text>
                    </View>
                  </View>

                  {/* Action row */}
                  <View
                    className="flex-row items-center pt-3 border-t"
                    style={{borderColor: C.border, gap: 8}}>
                    <TouchableOpacity
                      className="flex-1 rounded-full py-2 flex-row items-center justify-center"
                      style={{backgroundColor: C.surfaceWarm}}
                      onPress={() =>
                        nav.navigate('AddressForm', {addressId: item.id})
                      }
                      activeOpacity={0.7}>
                      <Edit3 color={C.ink} size={11} />
                      <Text
                        className="text-[11px] font-bold ml-1.5"
                        style={{color: C.ink, letterSpacing: 0.3}}>
                        EDIT
                      </Text>
                    </TouchableOpacity>
                    {!isDefault ? (
                      <TouchableOpacity
                        className="flex-1 rounded-full py-2 flex-row items-center justify-center"
                        style={{backgroundColor: C.surfaceGold}}
                        disabled={setDefaultMutation.isPending}
                        onPress={() => setDefaultMutation.mutate(item.id)}
                        activeOpacity={0.7}>
                        <Star
                          color={C.goldDeep}
                          fill={C.goldDeep}
                          size={11}
                        />
                        <Text
                          className="text-[11px] font-bold ml-1.5"
                          style={{
                            color: C.goldDeep,
                            letterSpacing: 0.3,
                          }}>
                          {setDefaultMutation.isPending
                            ? 'SAVING…'
                            : 'SET DEFAULT'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      className="rounded-full px-3 py-2 items-center justify-center"
                      style={{backgroundColor: C.surfaceCoral}}
                      disabled={removeMutation.isPending}
                      onPress={() =>
                        showAlert('Delete address?', item.fullName, [
                          {text: 'Cancel', style: 'cancel'},
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => removeMutation.mutate(item.id),
                          },
                        ])
                      }
                      activeOpacity={0.7}>
                      <Trash2 color={C.sageDeep} size={13} />
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {/* ── Sticky bottom Add CTA ──────────────────────────────── */}
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
              onPress={() => nav.navigate('AddressForm', {})}
              activeOpacity={0.85}>
              <Plus color="white" size={16} />
              <Text
                className="text-sm font-bold text-white ml-2"
                style={{letterSpacing: -0.2}}>
                Add a new address
              </Text>
            </TouchableOpacity>
          </Gradient>
        </View>
      </View>
    </SafeAreaView>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function Header({nav, count}: {nav: Nav; count: number}) {
  return (
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
          SHIPPING
        </Text>
        <Text
          className="font-black"
          style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
          Addresses
        </Text>
      </View>
      <View
        className="rounded-full px-2.5 py-1 flex-row items-center"
        style={{backgroundColor: C.surfaceSage}}>
        <MapPin color={C.sageDeep} size={10} />
        <Text
          className="text-[11px] font-bold ml-1"
          style={{color: C.sageDeep}}>
          {count}
        </Text>
      </View>
    </View>
  );
}

function EmptyAddresses({nav}: {nav: Nav}) {
  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} count={0} />
      <View className="flex-1 items-center justify-center px-6">
        {/* Layered medallion — outer sage ring + inner gradient
            with white pin, matches the OrdersScreen / Wishlist
            empty-state pattern. */}
        <View
          className="w-28 h-28 rounded-full items-center justify-center mb-6"
          style={{
            backgroundColor: C.surfaceSage,
            borderWidth: 2,
            borderColor: C.surface,
            shadowColor: C.sageDeep,
            shadowOpacity: 0.18,
            shadowOffset: {width: 0, height: 8},
            shadowRadius: 16,
            elevation: 6,
          }}>
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              overflow: 'hidden',
            }}>
            <Gradient
              colors={[C.sageDeep, C.ink]}
              angle={135}
              borderRadius={40}
              style={{
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <MapPin color="white" size={34} />
            </Gradient>
          </View>
        </View>
        <Text
          className="text-xl font-black mb-2"
          style={{color: C.ink, letterSpacing: -0.5}}>
          Add your first address
        </Text>
        <Text
          className="text-sm text-center mb-8 leading-5"
          style={{color: C.textSecondary, maxWidth: 280}}>
          Saving an address makes checkout one tap. We use it for
          shipping and delivery estimates.
        </Text>
        <View
          style={{
            borderRadius: 32,
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
            borderRadius={32}>
            <TouchableOpacity
              className="px-8 py-3.5 flex-row items-center"
              onPress={() => nav.navigate('AddressForm', {})}
              activeOpacity={0.85}>
              <Plus color="white" size={15} />
              <Text
                className="text-sm font-bold text-white ml-2"
                style={{letterSpacing: -0.2}}>
                Add address
              </Text>
              <ArrowRight
                color="white"
                size={15}
                style={{marginLeft: 6}}
              />
            </TouchableOpacity>
          </Gradient>
        </View>
      </View>
    </SafeAreaView>
  );
}
