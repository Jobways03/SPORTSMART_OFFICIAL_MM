import React, {forwardRef} from 'react';
import {TextInput, TouchableOpacity, View} from 'react-native';
import {Search, X} from 'lucide-react-native';

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  /** Focus on first mount (e.g. arriving from the Home search bar).
   *  For an already-mounted instance, focus via the forwarded ref. */
  autoFocus?: boolean;
}

// forwardRef exposes the underlying TextInput so callers can focus it
// imperatively (autoFocus only fires on first mount).
export const SearchInput = forwardRef<TextInput, Props>(function SearchInput(
  {value, onChangeText, placeholder, autoFocus},
  ref,
) {
  return (
    <View className="flex-row items-center bg-gray-100 rounded-lg px-3 py-2">
      <Search color="#6b7280" size={18} />
      <TextInput
        ref={ref}
        autoFocus={autoFocus}
        className="flex-1 ml-2 text-base text-gray-900 py-1"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? 'Search'}
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
      />
      {value.length > 0 ? (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          hitSlop={8}
          accessibilityLabel="Clear search">
          <X color="#6b7280" size={18} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
});
