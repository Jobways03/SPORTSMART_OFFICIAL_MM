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
import {useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Home,
  Info,
  MapPin,
  Phone,
  User,
  X,
} from 'lucide-react-native';
import {Modal as RNModal} from 'react-native';
import {
  useAddresses,
  useCreateAddress,
  useUpdateAddress,
} from '../../queries/useAddresses';
import {showAlert} from '../../lib/dialog';
import {pincodesService} from '../../services/pincodes.service';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import type {AccountStackParamList} from '../../navigation/types';

type Nav = NativeStackNavigationProp<AccountStackParamList, 'AddressForm'>;
type Route = RouteProp<AccountStackParamList, 'AddressForm'>;

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

const ADDRESS_TYPES = [
  {label: 'Home', value: 'home', Icon: Home},
  {label: 'Office', value: 'office', Icon: Briefcase},
  {label: 'Other', value: 'other', Icon: Building2},
];

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'phone-pad' | 'number-pad';
  maxLength?: number;
  multiline?: boolean;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  rightSlot?: React.ReactNode;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  maxLength,
  multiline,
  disabled,
  required,
  hint,
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
          minHeight: multiline ? 80 : 48,
        }}>
        <TextInput
          className="flex-1 text-sm"
          style={{
            color: C.ink,
            paddingVertical: multiline ? 12 : 0,
          }}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={C.textMuted}
          keyboardType={keyboardType ?? 'default'}
          maxLength={maxLength}
          multiline={multiline}
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
        {rightSlot}
      </View>
      {hint ? (
        <Text
          className="text-[10px] mt-1"
          style={{color: C.textTertiary}}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function AddressFormScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const isEdit = !!params.addressId;

  const addressesQuery = useAddresses();
  const createMutation = useCreateAddress();
  const updateMutation = useUpdateAddress();
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const existing = isEdit
    ? addressesQuery.data?.find(a => a.id === params.addressId) ?? null
    : null;

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [locality, setLocality] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [addressType, setAddressType] = useState('home');
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [pincodeError, setPincodeError] = useState<string | null>(null);
  const [pincodeOk, setPincodeOk] = useState(false);
  // Post-offices for the entered pincode. Surface as a locality picker
  // (mirrors the web checkout): typing a valid pincode populates this,
  // tapping an entry sets `locality` and locks city/state to the
  // server-derived values until the user edits the pincode again.
  const [places, setPlaces] = useState<string[]>([]);
  const [localityPickerOpen, setLocalityPickerOpen] = useState(false);
  const [pincodeAutoFilled, setPincodeAutoFilled] = useState(false);

  // Pincode auto-fill (preserves existing race-safety via cancelled flag).
  useEffect(() => {
    if (postalCode.length !== 6) {
      setPincodeError(null);
      setPincodeOk(false);
      setPlaces([]);
      setPincodeAutoFilled(false);
      return;
    }
    let cancelled = false;
    setPincodeLoading(true);
    setPincodeError(null);
    setPincodeOk(false);
    pincodesService
      .lookup(postalCode)
      .then(res => {
        if (cancelled) return;
        if (res.data?.district || res.data?.state) {
          // Authoritative server values overwrite any leftover input —
          // mirrors web checkout, where typing a valid pincode resets
          // city/state to whatever India Post says they are.
          setCity(res.data.district || '');
          setState(res.data.state || '');
          setPincodeOk(true);
          setPincodeAutoFilled(true);
          const names = (res.data.places ?? [])
            .map(p => p.name)
            .filter((n): n is string => !!n);
          setPlaces(names);
        } else {
          setPincodeError('Pincode not recognized.');
          setPlaces([]);
          setPincodeAutoFilled(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPincodeError('Could not look up pincode.');
          setPlaces([]);
          setPincodeAutoFilled(false);
        }
      })
      .finally(() => {
        if (!cancelled) setPincodeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postalCode]);

  useEffect(() => {
    if (existing) {
      setFullName(existing.fullName);
      setPhone(existing.phone);
      setAddressLine1(existing.addressLine1);
      setAddressLine2(existing.addressLine2 ?? '');
      setLocality(existing.locality ?? '');
      setCity(existing.city);
      setState(existing.state);
      setPostalCode(existing.postalCode);
      setIsDefault(existing.isDefault);
      // Address-type heuristic from the line text — until the API
      // carries the type explicitly. Matches the AddressesScreen label.
      const haystack = `${existing.addressLine1} ${existing.locality ?? ''}`.toLowerCase();
      setAddressType(
        /office|tower|complex|park|corp|business/.test(haystack)
          ? 'office'
          : 'home',
      );
    }
  }, [existing]);

  if (isEdit && addressesQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <Spinner fullscreen />
      </SafeAreaView>
    );
  }
  if (isEdit && (addressesQuery.isError || !existing)) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}}>
        <ErrorState
          title="Address not found"
          message="It may have been removed."
          onRetry={() => nav.goBack()}
        />
      </SafeAreaView>
    );
  }

  const onSubmit = () => {
    if (
      !fullName.trim() ||
      !phone.trim() ||
      !addressLine1.trim() ||
      !city.trim() ||
      !state.trim() ||
      !postalCode.trim()
    ) {
      showAlert('Missing info', 'Fill all required fields to continue.');
      return;
    }
    if (!/^\d{6}$/.test(postalCode.trim())) {
      showAlert('Invalid pincode', 'Pincode must be 6 digits.');
      return;
    }
    const payload = {
      fullName: fullName.trim(),
      phone: phone.trim(),
      addressLine1: addressLine1.trim(),
      addressLine2: addressLine2.trim() || undefined,
      locality: locality.trim() || undefined,
      city: city.trim(),
      state: state.trim(),
      postalCode: postalCode.trim(),
      isDefault,
    };

    const handler = isEdit
      ? updateMutation.mutateAsync({id: params.addressId!, payload})
      : createMutation.mutateAsync(payload);

    handler
      .then(() => nav.goBack())
      .catch(err =>
        showAlert(
          'Could not save',
          err instanceof Error ? err.message : 'Try again.',
        ),
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
            {isEdit ? 'EDITING' : 'NEW'}
          </Text>
          <Text
            className="font-black"
            style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
            {isEdit ? 'Edit address' : 'Add address'}
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
          {/* ── Address type picker — gradient active state ─── */}
          <View className="px-5 pt-4">
            <SectionLabel>SAVE AS</SectionLabel>
            <View className="flex-row" style={{gap: 8}}>
              {ADDRESS_TYPES.map(t => {
                const isActive = addressType === t.value;
                if (isActive) {
                  return (
                    <View
                      key={t.value}
                      className="flex-1"
                      style={{
                        borderRadius: 16,
                        overflow: 'hidden',
                        shadowColor: C.sageDeep,
                        shadowOpacity: 0.28,
                        shadowOffset: {width: 0, height: 4},
                        shadowRadius: 8,
                        elevation: 4,
                      }}>
                      <Gradient
                        colors={[C.sageDeep, C.ink]}
                        angle={135}
                        borderRadius={16}>
                        <TouchableOpacity
                          className="items-center justify-center py-4"
                          onPress={() => setAddressType(t.value)}
                          activeOpacity={0.85}>
                          <t.Icon color="white" size={20} />
                          <Text
                            className="text-xs font-bold mt-1.5"
                            style={{
                              color: 'white',
                              letterSpacing: -0.1,
                            }}>
                            {t.label}
                          </Text>
                        </TouchableOpacity>
                      </Gradient>
                    </View>
                  );
                }
                return (
                  <TouchableOpacity
                    key={t.value}
                    className="flex-1 rounded-2xl items-center justify-center py-4"
                    style={{
                      backgroundColor: C.surface,
                      borderWidth: 1.5,
                      borderColor: C.border,
                    }}
                    onPress={() => setAddressType(t.value)}
                    activeOpacity={0.7}>
                    <t.Icon color={C.ink} size={20} />
                    <Text
                      className="text-xs font-bold mt-1.5"
                      style={{
                        color: C.ink,
                        letterSpacing: -0.1,
                      }}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── Recipient section ──────────────────────────────── */}
          <View className="px-5 pt-5">
            <SectionLabel>RECIPIENT</SectionLabel>
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surface}}>
              <Field
                label="Full name"
                value={fullName}
                onChange={setFullName}
                placeholder="Priya Sharma"
                disabled={isSubmitting}
                required
              />
              <Field
                label="Phone"
                value={phone}
                onChange={t => setPhone(t.replace(/[^\d+]/g, ''))}
                placeholder="+91 9876543210"
                keyboardType="phone-pad"
                maxLength={15}
                disabled={isSubmitting}
                required
                hint="We'll text delivery updates to this number"
              />
            </View>
          </View>

          {/* ── Address section ────────────────────────────────── */}
          <View className="px-5 pt-5">
            <SectionLabel>ADDRESS</SectionLabel>
            <View
              className="rounded-2xl p-4"
              style={{backgroundColor: C.surface}}>
              {/* Pincode first — auto-fills city + state below */}
              <Field
                label="Pincode"
                value={postalCode}
                onChange={t => setPostalCode(t.replace(/\D/g, ''))}
                placeholder="6-digit pincode"
                keyboardType="number-pad"
                maxLength={6}
                disabled={isSubmitting}
                required
                rightSlot={
                  pincodeLoading ? (
                    <ActivityIndicator size="small" color={C.textTertiary} />
                  ) : pincodeOk ? (
                    <CheckCircle2 color={C.sageDeep} size={16} />
                  ) : null
                }
                hint={
                  pincodeError
                    ? pincodeError
                    : pincodeOk
                    ? 'City and state auto-filled below'
                    : 'Enter your 6-digit area pincode'
                }
              />
              <Field
                label="House / flat number, street"
                value={addressLine1}
                onChange={setAddressLine1}
                placeholder="Flat 4B, Cedar Apartments, Park Street"
                disabled={isSubmitting}
                required
              />
              <Field
                label="Apartment / landmark"
                value={addressLine2}
                onChange={setAddressLine2}
                placeholder="Near the metro station"
                disabled={isSubmitting}
              />
              {places.length > 0 ? (
                <View className="mb-4">
                  <Text
                    className="text-[11px] font-bold tracking-wide mb-1.5"
                    style={{color: C.ink, letterSpacing: 0.2}}>
                    LOCALITY <Text style={{color: C.textMuted}}> · TAP TO PICK</Text>
                  </Text>
                  <TouchableOpacity
                    className="rounded-xl flex-row items-center px-4"
                    style={{
                      backgroundColor: C.surface,
                      borderWidth: 1.5,
                      borderColor: locality ? C.ink : C.border,
                      minHeight: 48,
                    }}
                    disabled={isSubmitting}
                    activeOpacity={0.7}
                    onPress={() => setLocalityPickerOpen(true)}>
                    <Text
                      className="flex-1 text-sm"
                      style={{color: locality ? C.ink : C.textMuted}}>
                      {locality || `Pick from ${places.length} options`}
                    </Text>
                    <ChevronDown color={C.textTertiary} size={16} />
                  </TouchableOpacity>
                  <Text
                    className="text-[10px] mt-1"
                    style={{color: C.textTertiary}}>
                    Choose the post office / area for this pincode
                  </Text>
                </View>
              ) : (
                <Field
                  label="Locality"
                  value={locality}
                  onChange={setLocality}
                  placeholder="Indiranagar"
                  disabled={isSubmitting}
                />
              )}
              <View className="flex-row" style={{gap: 8}}>
                <View className="flex-1">
                  <Field
                    label="City"
                    value={city}
                    onChange={setCity}
                    placeholder="Bengaluru"
                    disabled={isSubmitting}
                    required
                  />
                </View>
                <View className="flex-1">
                  <Field
                    label="State"
                    value={state}
                    onChange={setState}
                    placeholder="Karnataka"
                    disabled={isSubmitting}
                    required
                  />
                </View>
              </View>
            </View>
          </View>

          {/* ── Default toggle ────────────────────────────────── */}
          <View className="px-5 pt-5">
            <TouchableOpacity
              className="rounded-2xl p-4 flex-row items-center"
              style={{
                backgroundColor: isDefault ? C.surfaceGold : C.surface,
                borderWidth: 1.5,
                borderColor: isDefault ? C.gold : C.border,
              }}
              onPress={() => setIsDefault(v => !v)}
              activeOpacity={0.85}>
              <View
                className="w-6 h-6 rounded-md items-center justify-center mr-3"
                style={{
                  backgroundColor: isDefault ? C.ink : 'transparent',
                  borderWidth: isDefault ? 0 : 2,
                  borderColor: C.border,
                }}>
                {isDefault ? <Check color="white" size={14} /> : null}
              </View>
              <View className="flex-1">
                <Text
                  className="text-sm font-bold"
                  style={{color: C.ink, letterSpacing: -0.2}}>
                  Set as default
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{color: C.textSecondary}}>
                  Pre-selected at every checkout
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* ── Privacy / trust note ───────────────────────────── */}
          <View className="px-5 pt-3">
            <View
              className="rounded-2xl p-3 flex-row items-center"
              style={{backgroundColor: C.surfaceSage}}>
              <Info color={C.sageDeep} size={13} />
              <Text
                className="text-[11px] ml-2 flex-1 leading-4"
                style={{color: C.sageDeep, fontWeight: '600'}}>
                We share your address only with the courier — never with
                sellers or third parties.
              </Text>
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
          {isSubmitting ? (
            <TouchableOpacity
              className="rounded-2xl py-3.5 flex-row items-center justify-center"
              style={{backgroundColor: C.textMuted}}
              disabled
              activeOpacity={1}>
              <ActivityIndicator color="white" />
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
                  onPress={onSubmit}
                  activeOpacity={0.85}>
                  <MapPin color="white" size={15} />
                  <Text
                    className="text-sm font-bold text-white ml-2"
                    style={{letterSpacing: -0.2}}>
                    {isEdit ? 'Save changes' : 'Save address'}
                  </Text>
                </TouchableOpacity>
              </Gradient>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <RNModal
        visible={localityPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLocalityPickerOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setLocalityPickerOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(15,23,42,0.55)',
            justifyContent: 'flex-end',
          }}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{
              backgroundColor: C.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 28,
              maxHeight: '70%',
            }}>
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: C.border,
                alignSelf: 'center',
                marginBottom: 12,
              }}
            />
            <View className="flex-row items-center justify-between mb-3">
              <Text
                className="text-base font-extrabold"
                style={{color: C.ink, letterSpacing: -0.3}}>
                Pick your locality
              </Text>
              <TouchableOpacity
                onPress={() => setLocalityPickerOpen(false)}
                style={{padding: 6}}
                activeOpacity={0.7}>
                <X color={C.ink} size={18} />
              </TouchableOpacity>
            </View>
            <Text
              className="text-[11px] mb-3"
              style={{color: C.textTertiary}}>
              {city ? `${city}, ${state} · ` : ''}Pincode {postalCode}
            </Text>
            <ScrollView style={{maxHeight: 360}}>
              {places.map(name => {
                const selected = locality === name;
                return (
                  <TouchableOpacity
                    key={name}
                    onPress={() => {
                      setLocality(name);
                      setLocalityPickerOpen(false);
                    }}
                    activeOpacity={0.7}
                    className="rounded-xl px-4 py-3 flex-row items-center mb-2"
                    style={{
                      backgroundColor: selected ? C.surfaceSage : C.bg,
                      borderWidth: 1.5,
                      borderColor: selected ? C.sageDeep : 'transparent',
                    }}>
                    <Text
                      className="flex-1 text-sm"
                      style={{
                        color: C.ink,
                        fontWeight: selected ? '700' : '500',
                      }}>
                      {name}
                    </Text>
                    {selected ? (
                      <Check color={C.sageDeep} size={16} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </RNModal>
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
