import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import type {LucideIcon} from 'lucide-react-native';
import {ChevronRight} from 'lucide-react-native';

interface Props {
  icon: LucideIcon;
  label: string;
  hint?: string;
  onPress: () => void;
  destructive?: boolean;
}

// A tappable row used by the Account screen menu. Keeps every row visually
// consistent — same icon size, same chevron, same padding — so we don't
// re-style at every call site.
export function AccountRow({
  icon: Icon,
  label,
  hint,
  onPress,
  destructive,
}: Props) {
  const iconColor = destructive ? '#dc2626' : '#374151';
  const labelColor = destructive ? 'text-red-700' : 'text-gray-900';

  return (
    <TouchableOpacity
      className="flex-row items-center px-6 py-4 border-b border-gray-100 bg-white"
      onPress={onPress}
      activeOpacity={0.7}>
      <Icon color={iconColor} size={20} />
      <View className="flex-1 ml-4">
        <Text className={`text-base font-medium ${labelColor}`}>{label}</Text>
        {hint ? (
          <Text className="text-xs text-gray-500 mt-0.5">{hint}</Text>
        ) : null}
      </View>
      {!destructive ? <ChevronRight color="#9ca3af" size={18} /> : null}
    </TouchableOpacity>
  );
}
