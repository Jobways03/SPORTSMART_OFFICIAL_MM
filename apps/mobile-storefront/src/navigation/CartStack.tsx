import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {CartScreen} from '../screens/app/CartScreen';
import {CheckoutScreen} from '../screens/app/CheckoutScreen';
import {OrderConfirmationScreen} from '../screens/app/OrderConfirmationScreen';
import type {CartStackParamList} from './types';

const Stack = createNativeStackNavigator<CartStackParamList>();

export function CartStack() {
  return (
    <Stack.Navigator screenOptions={{headerShown: false}}>
      <Stack.Screen name="Cart" component={CartScreen} />
      <Stack.Screen name="Checkout" component={CheckoutScreen} />
      <Stack.Screen
        name="OrderConfirmation"
        component={OrderConfirmationScreen}
        // Block back-swipe so the user doesn't accidentally land back on
        // checkout after a successful payment.
        options={{gestureEnabled: false}}
      />
    </Stack.Navigator>
  );
}
