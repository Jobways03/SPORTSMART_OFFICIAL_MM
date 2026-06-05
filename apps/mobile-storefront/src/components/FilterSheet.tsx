import React, {useEffect, useState} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {X} from 'lucide-react-native';
import {useFilters} from '../queries/useFilters';
import {SORT_OPTIONS, SortKey} from '../services/filters.service';
import {Spinner} from './Spinner';

export interface FilterDraft {
  sort: SortKey;
  minPrice: string;
  maxPrice: string;
  filters: Record<string, string[]>;
}

interface Props {
  visible: boolean;
  // Snapshot of the parent's current filter state. The sheet owns a
  // draft copy so users can tweak without re-fetching products per
  // keystroke; Apply commits the draft back up.
  initial: FilterDraft;
  // Optional categoryId / search context so faceted counts narrow to
  // what's actually selectable in the user's current Browse scope.
  categoryId?: string;
  search?: string;
  onApply: (next: FilterDraft) => void;
  onClose: () => void;
}

const EMPTY: FilterDraft = {
  sort: '',
  minPrice: '',
  maxPrice: '',
  filters: {},
};

export function FilterSheet({
  visible,
  initial,
  categoryId,
  search,
  onApply,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<FilterDraft>(initial);

  // Reset the draft whenever the sheet opens — otherwise an old draft
  // sticks around if the user backed out without Apply and re-opens.
  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  const filtersQuery = useFilters(
    {categoryId, search, activeFilters: draft.filters},
    visible,
  );

  const toggleFilterValue = (key: string, value: string) => {
    setDraft(prev => {
      const current = prev.filters[key] ?? [];
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      const filters = {...prev.filters};
      if (next.length === 0) delete filters[key];
      else filters[key] = next;
      return {...prev, filters};
    });
  };

  const activeFilterCount =
    Object.values(draft.filters).reduce((sum, vs) => sum + vs.length, 0) +
    (draft.sort ? 1 : 0) +
    (draft.minPrice || draft.maxPrice ? 1 : 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
        <View className="flex-row items-center px-4 py-3 border-b border-gray-100 bg-white">
          <TouchableOpacity onPress={onClose} className="p-2 -ml-2">
            <X color="#111827" size={22} />
          </TouchableOpacity>
          <Text className="flex-1 text-base font-semibold text-gray-900 ml-2">
            Sort & filter
          </Text>
          <TouchableOpacity onPress={() => setDraft(EMPTY)}>
            <Text className="text-sm font-semibold text-primary">Clear all</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{flex: 1}}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}>
          <ScrollView
            contentContainerClassName="pb-32"
            keyboardShouldPersistTaps="handled">
            {/* Sort */}
            <View className="bg-white mt-4 px-6 py-4">
              <Text className="text-sm font-semibold text-gray-900 mb-3">
                Sort by
              </Text>
              <View className="flex-row flex-wrap">
                {SORT_OPTIONS.map(opt => {
                  const selected = opt.value === draft.sort;
                  return (
                    <TouchableOpacity
                      key={opt.value || 'recommended'}
                      className={`border rounded-full px-3 py-2 mr-2 mb-2 ${
                        selected
                          ? 'border-primary bg-blue-50'
                          : 'border-gray-300'
                      }`}
                      onPress={() => setDraft(p => ({...p, sort: opt.value}))}
                      activeOpacity={0.7}>
                      <Text
                        className={`text-xs ${
                          selected
                            ? 'font-semibold text-primary'
                            : 'text-gray-700'
                        }`}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Price range */}
            <View className="bg-white mt-4 px-6 py-4">
              <Text className="text-sm font-semibold text-gray-900 mb-3">
                Price (₹)
              </Text>
              <View className="flex-row">
                <View className="flex-1 mr-2">
                  <Text className="text-xs text-gray-500 mb-1">Min</Text>
                  <TextInput
                    className="border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900"
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#9ca3af"
                    value={draft.minPrice}
                    onChangeText={t =>
                      setDraft(p => ({
                        ...p,
                        minPrice: t.replace(/[^\d]/g, ''),
                      }))
                    }
                  />
                </View>
                <View className="flex-1 ml-2">
                  <Text className="text-xs text-gray-500 mb-1">Max</Text>
                  <TextInput
                    className="border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900"
                    keyboardType="number-pad"
                    placeholder="∞"
                    placeholderTextColor="#9ca3af"
                    value={draft.maxPrice}
                    onChangeText={t =>
                      setDraft(p => ({
                        ...p,
                        maxPrice: t.replace(/[^\d]/g, ''),
                      }))
                    }
                  />
                </View>
              </View>
            </View>

            {/* Facets from /storefront/filters */}
            {filtersQuery.isLoading ? (
              <View className="bg-white mt-4 py-8">
                <Spinner />
              </View>
            ) : null}

            {(filtersQuery.data ?? []).map(group => (
              <View key={group.key} className="bg-white mt-4 px-6 py-4">
                <Text className="text-sm font-semibold text-gray-900 mb-3">
                  {group.label}
                </Text>
                <View className="flex-row flex-wrap">
                  {(group.values ?? []).map(v => {
                    const active = (draft.filters[group.key] ?? []).includes(
                      v.value,
                    );
                    const dim = v.count === 0 && !active;
                    return (
                      <TouchableOpacity
                        key={v.value}
                        className={`border rounded-full px-3 py-2 mr-2 mb-2 ${
                          active
                            ? 'border-primary bg-blue-50'
                            : 'border-gray-300'
                        } ${dim ? 'opacity-40' : ''}`}
                        disabled={dim}
                        onPress={() => toggleFilterValue(group.key, v.value)}
                        activeOpacity={0.7}>
                        <View className="flex-row items-center">
                          {v.colorHex ? (
                            <View
                              className="w-3 h-3 rounded-full mr-2 border border-gray-200"
                              style={{backgroundColor: v.colorHex}}
                            />
                          ) : null}
                          <Text
                            className={`text-xs ${
                              active
                                ? 'font-semibold text-primary'
                                : 'text-gray-700'
                            }`}>
                            {v.label}
                            {group.showCounts && v.count > 0 ? ` (${v.count})` : ''}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>

          <View className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-6 py-4">
            <TouchableOpacity
              className="bg-primary rounded-lg py-4 items-center"
              onPress={() => onApply(draft)}
              activeOpacity={0.85}>
              <Text className="text-white font-semibold text-base">
                {activeFilterCount > 0
                  ? `Apply (${activeFilterCount})`
                  : 'Apply'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
