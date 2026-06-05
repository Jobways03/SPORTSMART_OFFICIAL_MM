import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {HomeScreen} from '../screens/app/HomeScreen';
import {BrowseStack} from './BrowseStack';
import {CartStack} from './CartStack';
import {AccountStack} from './AccountStack';
import {CustomTabBar} from './CustomTabBar';
import type {AppTabParamList} from './types';

const Tabs = createBottomTabNavigator<AppTabParamList>();

// The bar visual is fully owned by CustomTabBar — icons, labels,
// active state, cart badge and safe-area padding all live there.
// Per-screen options here only set headerShown=false; CustomTabBar
// reads the route name to pick the icon + label.
export function AppTabs() {
  return (
    <Tabs.Navigator
      tabBar={props => <CustomTabBar {...props} />}
      screenOptions={{headerShown: false}}>
      {/* testIDs make the bottom tabs reliably targetable for E2E (Maestro).
          CustomTabBar forwards options.tabBarButtonTestID to the Pressable. */}
      <Tabs.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{tabBarButtonTestID: 'tab-home'}}
      />
      <Tabs.Screen
        name="BrowseTab"
        component={BrowseStack}
        options={{tabBarButtonTestID: 'tab-browse'}}
      />
      <Tabs.Screen
        name="CartTab"
        component={CartStack}
        options={{tabBarButtonTestID: 'tab-cart'}}
      />
      <Tabs.Screen
        name="AccountTab"
        component={AccountStack}
        options={{tabBarButtonTestID: 'tab-account'}}
      />
    </Tabs.Navigator>
  );
}
