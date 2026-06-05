import React from 'react';
import {Text, TouchableOpacity, View} from 'react-native';
import {AlertCircle} from 'lucide-react-native';

interface Props {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Pull down to try again, or come back in a moment.',
  onRetry,
}: Props) {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6 py-12">
      <AlertCircle color="#dc2626" size={48} />
      <Text className="text-lg font-semibold text-gray-900 mt-4 mb-2">{title}</Text>
      <Text className="text-base text-gray-500 text-center mb-6">{message}</Text>
      {onRetry ? (
        <TouchableOpacity
          className="bg-primary rounded-lg px-6 py-3"
          onPress={onRetry}
          activeOpacity={0.8}>
          <Text className="text-white font-semibold">Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
