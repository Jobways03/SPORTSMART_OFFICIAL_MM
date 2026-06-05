import React from 'react';
import {Text, View} from 'react-native';
import {PackageOpen} from 'lucide-react-native';

interface Props {
  title: string;
  message?: string;
}

export function EmptyState({title, message}: Props) {
  return (
    <View className="flex-1 items-center justify-center px-6 py-12">
      <PackageOpen color="#9ca3af" size={48} />
      <Text className="text-lg font-semibold text-gray-700 mt-4 mb-1">{title}</Text>
      {message ? (
        <Text className="text-base text-gray-500 text-center">{message}</Text>
      ) : null}
    </View>
  );
}
