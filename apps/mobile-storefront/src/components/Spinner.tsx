import React from 'react';
import {ActivityIndicator, View} from 'react-native';

export function Spinner({fullscreen = false}: {fullscreen?: boolean}) {
  return (
    <View
      className={
        fullscreen
          ? 'flex-1 items-center justify-center bg-white'
          : 'py-8 items-center'
      }>
      <ActivityIndicator size="large" color="#2563eb" />
    </View>
  );
}
