import React, {useEffect, useMemo, useState} from 'react';
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
import {showAlert} from '../../lib/dialog';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Gradient} from '../../components/Gradient';
import {useNavigation, useRoute, CommonActions} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {RouteProp} from '@react-navigation/native';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  Info,
  Minus,
  Package,
  Plus,
  RotateCcw,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react-native';
import type {Asset} from 'react-native-image-picker';
import {useCreateReturn, useReturnEligibility} from '../../queries/useReturns';
import {REASON_CATEGORIES} from '../../services/returns.service';
import {returnEvidenceService} from '../../services/return-evidence.service';
import {pickFromGallery, takePhoto} from '../../lib/imagePicker';
import {Spinner} from '../../components/Spinner';
import {ErrorState} from '../../components/ErrorState';
import {CachedImage} from '../../components/CachedImage';
import {formatINR} from '../../lib/format';
import type {AccountStackParamList} from '../../navigation/types';

const MAX_EVIDENCE = 5;

type Nav = NativeStackNavigationProp<AccountStackParamList, 'CreateReturn'>;
type Route = RouteProp<AccountStackParamList, 'CreateReturn'>;

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

interface ItemDraft {
  orderItemId: string;
  quantity: number;
  reasonCategory: string;
}

export function CreateReturnScreen() {
  const nav = useNavigation<Nav>();
  const {params} = useRoute<Route>();
  const query = useReturnEligibility(params.masterOrderId);
  const create = useCreateReturn();

  const [activeSubOrderId, setActiveSubOrderId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const eligibleSubs = useMemo(
    () => (query.data?.eligibleSubOrders ?? []).filter(s => !s.windowExpired),
    [query.data],
  );

  useEffect(() => {
    if (eligibleSubs.length === 1 && !activeSubOrderId) {
      setActiveSubOrderId(eligibleSubs[0].subOrderId);
    }
  }, [eligibleSubs, activeSubOrderId]);

  // All derived data + useMemo computed up front so the hook count
  // doesn't shift when query.isLoading / isError / eligibleSubs flip.
  // estRefund safely handles the null-activeSub case (no eligible
  // subs yet → returns 0) so the hook can run unconditionally.
  const activeSub = activeSubOrderId
    ? eligibleSubs.find(s => s.subOrderId === activeSubOrderId) ?? null
    : null;

  const selectedItems = Object.values(drafts);
  const canSubmit =
    !!activeSub &&
    selectedItems.length > 0 &&
    selectedItems.every(d => d.quantity > 0 && d.reasonCategory) &&
    consent;

  const estRefund = useMemo(() => {
    if (!activeSub) return 0;
    return selectedItems.reduce((sum, d) => {
      const item = activeSub.items.find(i => i.orderItemId === d.orderItemId);
      return item ? sum + Number(item.unitPrice) * d.quantity : sum;
    }, 0);
  }, [activeSub, selectedItems]);

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

  // No sub-order eligible at all — premium empty state.
  if (eligibleSubs.length === 0) {
    return (
      <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
        <Header nav={nav} />
        <View className="flex-1 items-center justify-center px-6">
          <View
            className="w-20 h-20 rounded-full items-center justify-center mb-5"
            style={{backgroundColor: C.surfaceCoral}}>
            <X color={C.coralDeep} size={32} />
          </View>
          <Text
            className="text-lg font-black mb-2"
            style={{color: C.ink, letterSpacing: -0.4}}>
            Nothing eligible to return
          </Text>
          <Text
            className="text-sm text-center leading-5"
            style={{color: C.textSecondary, maxWidth: 280}}>
            {query.data.reason ??
              'The return window has passed for every item, or this order is not yet delivered.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const uploadAssets = async (assets: Asset[]) => {
    if (assets.length === 0) return;
    setUploading(true);
    try {
      const remaining = MAX_EVIDENCE - evidenceUrls.length;
      const next: string[] = [];
      for (const asset of assets.slice(0, remaining)) {
        if (!asset.uri) continue;
        if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
          showAlert(
            'Photo too large',
            `"${asset.fileName ?? 'Image'}" is larger than 5MB and was skipped.`,
          );
          continue;
        }
        try {
          const res = await returnEvidenceService.upload({
            uri: asset.uri,
            name: asset.fileName ?? `evidence-${Date.now()}.jpg`,
            type: asset.type ?? 'image/jpeg',
          });
          if (res.data?.url) next.push(res.data.url);
        } catch (err) {
          showAlert(
            'Upload failed',
            err instanceof Error ? err.message : 'Try again.',
          );
        }
      }
      if (next.length > 0) setEvidenceUrls(prev => [...prev, ...next]);
    } finally {
      setUploading(false);
    }
  };

  const onAddPhotoPress = () => {
    const remaining = MAX_EVIDENCE - evidenceUrls.length;
    if (remaining <= 0) return;
    showAlert('Add photo', undefined, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Choose from gallery',
        onPress: async () => {
          const assets = await pickFromGallery({multiple: true, remaining});
          await uploadAssets(assets);
        },
      },
      {
        text: 'Take photo',
        onPress: async () => {
          const assets = await takePhoto();
          await uploadAssets(assets);
        },
      },
    ]);
  };

  const removeEvidence = (idx: number) =>
    setEvidenceUrls(prev => prev.filter((_, i) => i !== idx));

  const onSubmit = () => {
    if (!activeSub || !canSubmit) return;
    create.mutate(
      {
        subOrderId: activeSub.subOrderId,
        items: selectedItems.map(d => ({
          orderItemId: d.orderItemId,
          quantity: d.quantity,
          reasonCategory: d.reasonCategory,
          reasonDetail: notes.trim() || undefined,
        })),
        customerNotes: notes.trim() || undefined,
        forfeitConsent: true,
        evidenceFileUrls: evidenceUrls,
      },
      {
        onSuccess: res => {
          if (res.data) {
            nav.dispatch(
              CommonActions.reset({
                index: 1,
                routes: [
                  {name: 'Returns'},
                  {name: 'ReturnDetail', params: {returnId: res.data.id}},
                ],
              }),
            );
          } else {
            nav.goBack();
          }
        },
        onError: err =>
          showAlert(
            'Could not start return',
            err instanceof Error ? err.message : 'Try again.',
          ),
      },
    );
  };

  const toggleItem = (
    item: NonNullable<typeof activeSub>['items'][number],
    available: number,
  ) => {
    setDrafts(prev => {
      const next = {...prev};
      if (next[item.orderItemId]) {
        delete next[item.orderItemId];
      } else {
        next[item.orderItemId] = {
          orderItemId: item.orderItemId,
          quantity: Math.min(1, available),
          reasonCategory: '',
        };
      }
      return next;
    });
  };

  const updateDraft = (orderItemId: string, patch: Partial<ItemDraft>) => {
    setDrafts(prev =>
      prev[orderItemId]
        ? {...prev, [orderItemId]: {...prev[orderItemId], ...patch}}
        : prev,
    );
  };

  return (
    <SafeAreaView className="flex-1" style={{backgroundColor: C.bg}} edges={['top']}>
      <Header nav={nav} />

      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{paddingBottom: 160}}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* ── Return request hero — dark gradient service surface */}
          <View className="px-5 pt-4">
            <View
              style={{
                borderRadius: 20,
                overflow: 'hidden',
                shadowColor: C.sageDeep,
                shadowOpacity: 0.22,
                shadowOffset: {width: 0, height: 10},
                shadowRadius: 16,
                elevation: 8,
              }}>
              <Gradient
                colors={[C.ink, C.sageDeep]}
                angle={140}
                borderRadius={20}>
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
                <View className="flex-row items-center p-4">
                  <View
                    className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.16)',
                      borderWidth: 1,
                      borderColor: 'rgba(255,255,255,0.28)',
                    }}>
                    <RotateCcw color="white" size={18} />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-[10px] font-bold tracking-widest"
                      style={{
                        color: 'rgba(255,255,255,0.72)',
                        letterSpacing: 1.8,
                      }}>
                      RETURN REQUEST
                    </Text>
                    <Text
                      className="font-black mt-0.5"
                      style={{
                        color: 'white',
                        fontSize: 16,
                        letterSpacing: -0.3,
                      }}>
                      Hassle-free returns
                    </Text>
                    <Text
                      className="text-[11px] mt-0.5"
                      style={{
                        color: 'rgba(255,255,255,0.78)',
                      }}>
                      Free home pickup · Refund in 3–5 days
                    </Text>
                  </View>
                </View>
              </Gradient>
            </View>
          </View>

          {/* ── Shipment picker (only when multiple) ───────── */}
          {eligibleSubs.length > 1 ? (
            <View className="px-5 pt-5">
              <SectionLabel>WHICH SHIPMENT?</SectionLabel>
              <View
                className="rounded-2xl overflow-hidden"
                style={{backgroundColor: C.surface}}>
                {eligibleSubs.map((sub, idx) => {
                  const selected = sub.subOrderId === activeSubOrderId;
                  return (
                    <TouchableOpacity
                      key={sub.subOrderId}
                      className="px-4 py-3.5 flex-row items-center"
                      style={
                        idx === 0
                          ? undefined
                          : {borderTopWidth: 1, borderTopColor: C.border}
                      }
                      onPress={() => {
                        setActiveSubOrderId(sub.subOrderId);
                        setDrafts({});
                      }}
                      activeOpacity={0.7}>
                      <View
                        className="w-5 h-5 rounded-full items-center justify-center mr-3"
                        style={{
                          borderWidth: 2,
                          borderColor: selected ? C.ink : C.textMuted,
                          backgroundColor: selected ? C.ink : 'transparent',
                        }}>
                        {selected ? (
                          <Check color="white" size={11} />
                        ) : null}
                      </View>
                      <View className="flex-1">
                        <Text
                          className="text-sm font-bold"
                          style={{color: C.ink, letterSpacing: -0.2}}>
                          Shipment {idx + 1}
                        </Text>
                        <Text
                          className="text-[11px] mt-0.5"
                          style={{color: C.textSecondary}}>
                          {sub.items.filter(i => i.eligible).length} eligible{' '}
                          {sub.items.filter(i => i.eligible).length === 1
                            ? 'item'
                            : 'items'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {activeSub ? (
            <>
              {/* ── Items to return ─────────────────────────────── */}
              <View className="px-5 pt-5">
                <View className="flex-row items-end justify-between mb-2">
                  <View>
                    <Text
                      className="text-[10px] font-bold tracking-widest"
                      style={{color: C.textTertiary, letterSpacing: 1.8}}>
                      PICK ITEMS TO RETURN
                    </Text>
                    <Text
                      className="text-[11px] mt-0.5"
                      style={{color: C.textTertiary}}>
                      Tap an item, set quantity + reason
                    </Text>
                  </View>
                  {selectedItems.length > 0 ? (
                    <View
                      className="rounded-full px-2.5 py-1"
                      style={{backgroundColor: C.surfaceSage}}>
                      <Text
                        className="text-[10px] font-bold"
                        style={{color: C.sageDeep, letterSpacing: 0.3}}>
                        {selectedItems.length} SELECTED
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={{gap: 10}}>
                  {activeSub.items.map(item => {
                    const draft = drafts[item.orderItemId];
                    const selected = !!draft;
                    const available = item.availableForReturn;
                    const disabled = !item.eligible || available === 0;

                    return (
                      <View
                        key={item.orderItemId}
                        className="rounded-2xl overflow-hidden"
                        style={{
                          backgroundColor: C.surface,
                          opacity: disabled ? 0.55 : 1,
                          borderWidth: selected ? 1.5 : 0,
                          borderColor: C.ink,
                        }}>
                        {/* Item row */}
                        <TouchableOpacity
                          className="p-3 flex-row items-start"
                          disabled={disabled}
                          onPress={() => toggleItem(item, available)}
                          activeOpacity={0.7}>
                          {/* Tap indicator */}
                          <View
                            className="w-5 h-5 rounded-md items-center justify-center mr-3 mt-1"
                            style={{
                              backgroundColor: selected
                                ? C.ink
                                : 'transparent',
                              borderWidth: selected ? 0 : 2,
                              borderColor: C.border,
                            }}>
                            {selected ? (
                              <Check color="white" size={11} />
                            ) : null}
                          </View>
                          <View
                            className="w-14 h-14 rounded-xl overflow-hidden mr-3"
                            style={{backgroundColor: C.surfaceWarm}}>
                            {item.imageUrl ? (
                              <CachedImage
                                source={{uri: item.imageUrl}}
                                className="w-full h-full"
                                resizeMode="cover"
                              />
                            ) : (
                              <View className="w-full h-full items-center justify-center">
                                <Text style={{fontSize: 22, opacity: 0.3}}>
                                  📦
                                </Text>
                              </View>
                            )}
                          </View>
                          <View className="flex-1">
                            <Text
                              className="text-xs font-bold"
                              style={{color: C.ink, letterSpacing: -0.1}}
                              numberOfLines={2}>
                              {item.productTitle}
                            </Text>
                            {item.variantTitle ? (
                              <Text
                                className="text-[10px] mt-0.5"
                                style={{color: C.textTertiary}}>
                                {item.variantTitle}
                              </Text>
                            ) : null}
                            <Text
                              className="text-[11px] mt-1 font-semibold"
                              style={{color: C.textSecondary}}>
                              Ordered {item.quantity} ·{' '}
                              {formatINR(item.unitPrice)}
                            </Text>
                            {disabled ? (
                              <View
                                className="rounded-full px-2 py-0.5 mt-1.5 self-start"
                                style={{backgroundColor: C.surfaceCoral}}>
                                <Text
                                  className="text-[10px] font-bold"
                                  style={{color: C.coralDeep}}>
                                  {item.ineligibleReason === 'WINDOW_EXPIRED'
                                    ? 'Return window passed'
                                    : item.ineligibleReason ===
                                      'ALREADY_RETURNED'
                                    ? 'Already returned'
                                    : item.ineligibleReason ===
                                      'PREVIOUSLY_REJECTED'
                                    ? 'Previously rejected'
                                    : 'Not eligible'}
                                </Text>
                              </View>
                            ) : item.alreadyReturnedQty > 0 ? (
                              <View
                                className="rounded-full px-2 py-0.5 mt-1.5 self-start"
                                style={{backgroundColor: C.surfaceGold}}>
                                <Text
                                  className="text-[10px] font-bold"
                                  style={{color: C.goldDeep}}>
                                  {item.alreadyReturnedQty} already returned ·{' '}
                                  {available} left
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </TouchableOpacity>

                        {/* Expanded body when selected */}
                        {selected ? (
                          <View
                            className="px-4 py-3"
                            style={{
                              backgroundColor: C.surfaceWarm,
                              borderTopWidth: 1,
                              borderTopColor: C.border,
                            }}>
                            {/* Qty stepper */}
                            <View className="flex-row items-center justify-between mb-3">
                              <Text
                                className="text-[10px] font-bold tracking-widest"
                                style={{
                                  color: C.textTertiary,
                                  letterSpacing: 1.2,
                                }}>
                                QUANTITY
                              </Text>
                              <View
                                className="flex-row items-center rounded-full"
                                style={{backgroundColor: C.surface}}>
                                <TouchableOpacity
                                  className="w-8 h-8 items-center justify-center"
                                  disabled={draft.quantity <= 1}
                                  onPress={() =>
                                    updateDraft(item.orderItemId, {
                                      quantity: draft.quantity - 1,
                                    })
                                  }>
                                  <Minus
                                    color={
                                      draft.quantity <= 1
                                        ? C.textMuted
                                        : C.ink
                                    }
                                    size={12}
                                  />
                                </TouchableOpacity>
                                <Text
                                  className="text-sm font-bold px-2"
                                  style={{
                                    color: C.ink,
                                    minWidth: 24,
                                    textAlign: 'center',
                                  }}>
                                  {draft.quantity}
                                </Text>
                                <TouchableOpacity
                                  className="w-8 h-8 items-center justify-center"
                                  disabled={draft.quantity >= available}
                                  onPress={() =>
                                    updateDraft(item.orderItemId, {
                                      quantity: draft.quantity + 1,
                                    })
                                  }>
                                  <Plus
                                    color={
                                      draft.quantity >= available
                                        ? C.textMuted
                                        : C.ink
                                    }
                                    size={12}
                                  />
                                </TouchableOpacity>
                              </View>
                              <Text
                                className="text-[10px] ml-2"
                                style={{color: C.textTertiary}}>
                                of {available}
                              </Text>
                            </View>

                            {/* Reason chips */}
                            <Text
                              className="text-[10px] font-bold tracking-widest mb-2"
                              style={{
                                color: C.textTertiary,
                                letterSpacing: 1.2,
                              }}>
                              REASON
                            </Text>
                            <View className="flex-row flex-wrap" style={{gap: 6}}>
                              {REASON_CATEGORIES.map(r => {
                                const isSel = r.value === draft.reasonCategory;
                                return (
                                  <TouchableOpacity
                                    key={r.value}
                                    className="rounded-full px-3 py-1.5"
                                    style={{
                                      backgroundColor: isSel
                                        ? C.ink
                                        : C.surface,
                                    }}
                                    onPress={() =>
                                      updateDraft(item.orderItemId, {
                                        reasonCategory: r.value,
                                      })
                                    }
                                    activeOpacity={0.7}>
                                    <Text
                                      className="text-[11px] font-semibold"
                                      style={{
                                        color: isSel ? 'white' : C.ink,
                                      }}>
                                      {r.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* ── Notes ──────────────────────────────────────── */}
              <View className="px-5 pt-5">
                <SectionLabel>ADDITIONAL NOTES · OPTIONAL</SectionLabel>
                <View
                  className="rounded-2xl p-3"
                  style={{
                    backgroundColor: C.surface,
                    borderWidth: 1.5,
                    borderColor: notes ? C.ink : C.border,
                  }}>
                  <TextInput
                    className="text-sm"
                    style={{
                      color: C.ink,
                      height: 80,
                      textAlignVertical: 'top',
                      padding: 8,
                    }}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Describe the issue in more detail — sizes, defects, photos missing context, etc."
                    placeholderTextColor={C.textMuted}
                    multiline
                    editable={!create.isPending}
                  />
                </View>
              </View>

              {/* ── Photo evidence ─────────────────────────────── */}
              <View className="px-5 pt-5">
                <View className="flex-row items-end justify-between mb-2 px-1">
                  <View>
                    <Text
                      className="text-[10px] font-bold tracking-widest"
                      style={{color: C.textTertiary, letterSpacing: 1.8}}>
                      PHOTOS · {evidenceUrls.length}/{MAX_EVIDENCE}
                    </Text>
                    <Text
                      className="text-[11px] mt-0.5"
                      style={{color: C.textTertiary}}>
                      Approvals are faster with photos
                    </Text>
                  </View>
                </View>

                <View
                  className="rounded-2xl p-3 flex-row flex-wrap"
                  style={{backgroundColor: C.surface}}>
                  {evidenceUrls.map((url, idx) => (
                    <View
                      key={url}
                      className="w-20 h-20 mr-2 mb-2 rounded-xl overflow-hidden"
                      style={{backgroundColor: C.surfaceWarm}}>
                      <CachedImage
                        source={{uri: url}}
                        className="w-full h-full"
                        resizeMode="cover"
                      />
                      <TouchableOpacity
                        className="absolute w-5 h-5 rounded-full items-center justify-center"
                        style={{
                          top: 4,
                          right: 4,
                          backgroundColor: 'rgba(15,23,42,0.85)',
                        }}
                        onPress={() => removeEvidence(idx)}
                        accessibilityLabel="Remove photo">
                        <X color="white" size={11} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {evidenceUrls.length < MAX_EVIDENCE ? (
                    <TouchableOpacity
                      className="w-20 h-20 mr-2 mb-2 rounded-xl items-center justify-center"
                      style={{
                        backgroundColor: C.surfaceWarm,
                        borderWidth: 1.5,
                        borderColor: C.border,
                        borderStyle: 'dashed',
                      }}
                      onPress={onAddPhotoPress}
                      disabled={uploading}
                      activeOpacity={0.7}>
                      {uploading ? (
                        <ActivityIndicator color={C.textTertiary} size="small" />
                      ) : (
                        <>
                          <Camera color={C.textTertiary} size={20} />
                          <Text
                            className="text-[9px] mt-1 font-semibold"
                            style={{color: C.textTertiary}}>
                            ADD
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {/* ── Estimated refund + Consent ─────────────────── */}
              <View className="px-5 pt-5">
                {estRefund > 0 ? (
                  <View
                    className="rounded-2xl p-4 flex-row items-center mb-3"
                    style={{backgroundColor: C.surfaceSage}}>
                    <View
                      className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                      style={{backgroundColor: C.sage}}>
                      <Wallet color="white" size={18} />
                    </View>
                    <View className="flex-1">
                      <Text
                        className="text-[10px] font-bold tracking-widest"
                        style={{color: C.sageDeep, letterSpacing: 1.5}}>
                        ESTIMATED REFUND
                      </Text>
                      <Text
                        className="text-xl font-black mt-0.5"
                        style={{color: C.ink, letterSpacing: -0.5}}>
                        {formatINR(estRefund)}
                      </Text>
                    </View>
                    <Text
                      className="text-[10px] font-bold"
                      style={{color: C.sageDeep}}>
                      AFTER QC
                    </Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  className="rounded-2xl p-4 flex-row items-center"
                  style={{
                    backgroundColor: consent ? C.surfaceSage : C.surface,
                    borderWidth: 1.5,
                    borderColor: consent ? C.sage : C.border,
                  }}
                  onPress={() => setConsent(v => !v)}
                  activeOpacity={0.85}>
                  <View
                    className="w-6 h-6 rounded-md items-center justify-center mr-3"
                    style={{
                      backgroundColor: consent ? C.ink : 'transparent',
                      borderWidth: consent ? 0 : 2,
                      borderColor: C.border,
                    }}>
                    {consent ? <Check color="white" size={14} /> : null}
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-sm font-bold"
                      style={{color: C.ink, letterSpacing: -0.2}}>
                      I understand the return policy
                    </Text>
                    <Text
                      className="text-[11px] mt-0.5"
                      style={{color: C.textSecondary}}>
                      Unused · Original packaging · Subject to QC
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* ── Trust strip ────────────────────────────────── */}
              <View className="px-5 pt-3">
                <View
                  className="rounded-2xl p-3 flex-row items-center"
                  style={{backgroundColor: C.surface}}>
                  <ShieldCheck color={C.sageDeep} size={13} />
                  <Text
                    className="text-[11px] ml-2 flex-1 leading-4"
                    style={{color: C.textSecondary, fontWeight: '600'}}>
                    Refund safety guarantee · Money back via wallet or bank
                  </Text>
                </View>
              </View>
            </>
          ) : null}
        </ScrollView>

        {/* ── Sticky bottom submit bar ───────────────────────────── */}
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
          {/* Validation hint */}
          {selectedItems.length === 0 ? (
            <View className="flex-row items-center mb-2">
              <Info color={C.textTertiary} size={11} />
              <Text
                className="text-[10px] ml-1.5 font-semibold"
                style={{color: C.textTertiary, letterSpacing: 0.3}}>
                PICK AT LEAST ONE ITEM
              </Text>
            </View>
          ) : selectedItems.some(d => !d.reasonCategory) ? (
            <View className="flex-row items-center mb-2">
              <AlertCircle color={C.goldDeep} size={11} />
              <Text
                className="text-[10px] ml-1.5 font-semibold"
                style={{color: C.goldDeep, letterSpacing: 0.3}}>
                ADD A REASON TO EACH SELECTED ITEM
              </Text>
            </View>
          ) : !consent ? (
            <View className="flex-row items-center mb-2">
              <AlertCircle color={C.goldDeep} size={11} />
              <Text
                className="text-[10px] ml-1.5 font-semibold"
                style={{color: C.goldDeep, letterSpacing: 0.3}}>
                ACCEPT THE RETURN POLICY ABOVE
              </Text>
            </View>
          ) : (
            <View className="flex-row items-center mb-2">
              <CheckCircle2 color={C.sageDeep} size={11} />
              <Text
                className="text-[10px] ml-1.5 font-semibold"
                style={{color: C.sageDeep, letterSpacing: 0.3}}>
                READY TO SUBMIT
              </Text>
            </View>
          )}

          {/* Premium gradient when ready; flat-muted with explicit
              labels for the disabled / loading states. */}
          {!canSubmit || create.isPending ? (
            <TouchableOpacity
              className="rounded-2xl py-3.5 flex-row items-center justify-center"
              style={{backgroundColor: C.textMuted}}
              disabled
              activeOpacity={1}>
              {create.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-sm font-bold text-white">
                  Submit return
                  {estRefund > 0 ? ` · ${formatINR(estRefund)}` : ''}
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
                  onPress={onSubmit}
                  activeOpacity={0.85}>
                  <RotateCcw color="white" size={15} />
                  <Text
                    className="text-sm font-bold text-white ml-2"
                    style={{letterSpacing: -0.2}}>
                    Submit return
                    {estRefund > 0 ? ` · ${formatINR(estRefund)}` : ''}
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

function Header({nav}: {nav: Nav}) {
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
          REFUND REQUEST
        </Text>
        <Text
          className="font-black"
          style={{color: C.ink, fontSize: 18, letterSpacing: -0.4}}>
          Start a return
        </Text>
      </View>
    </View>
  );
}

function SectionLabel({children}: {children: React.ReactNode}) {
  return (
    <Text
      className="text-[10px] font-bold tracking-widest mb-2 px-1"
      style={{color: C.textTertiary, letterSpacing: 1.8}}>
      {children}
    </Text>
  );
}
