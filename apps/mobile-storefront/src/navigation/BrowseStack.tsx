import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {BrowseScreen} from '../screens/app/BrowseScreen';
import {ProductDetailScreen} from '../screens/app/ProductDetailScreen';
import type {BrowseStackParamList} from './types';

const Stack = createNativeStackNavigator<BrowseStackParamList>();

export function BrowseStack() {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Browse" component={BrowseScreen} />
      <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
    </Stack.Navigator>
  );
}
