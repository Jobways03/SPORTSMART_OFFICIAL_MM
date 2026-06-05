import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {StackActions, useNavigation} from '@react-navigation/native';
import {AccountScreen} from '../screens/app/AccountScreen';
import {EditProfileScreen} from '../screens/app/EditProfileScreen';
import {WishlistScreen} from '../screens/app/WishlistScreen';
import {AddressesScreen} from '../screens/app/AddressesScreen';
import {AddressFormScreen} from '../screens/app/AddressFormScreen';
import {OrdersScreen} from '../screens/app/OrdersScreen';
import {OrderDetailScreen} from '../screens/app/OrderDetailScreen';
import {ReturnsScreen} from '../screens/app/ReturnsScreen';
import {ReturnDetailScreen} from '../screens/app/ReturnDetailScreen';
import {CreateReturnScreen} from '../screens/app/CreateReturnScreen';
import {WalletScreen} from '../screens/app/WalletScreen';
import {WalletTopupScreen} from '../screens/app/WalletTopupScreen';
import {InvoicesScreen} from '../screens/app/InvoicesScreen';
import {TicketsScreen} from '../screens/app/TicketsScreen';
import {TicketDetailScreen} from '../screens/app/TicketDetailScreen';
import {CreateTicketScreen} from '../screens/app/CreateTicketScreen';
import {ChangePasswordScreen} from '../screens/app/ChangePasswordScreen';
import {NotificationPreferencesScreen} from '../screens/app/NotificationPreferencesScreen';
import {AboutScreen} from '../screens/app/AboutScreen';
import {DataExportScreen} from '../screens/app/DataExportScreen';
import {PrivacyConsentScreen} from '../screens/app/PrivacyConsentScreen';
import {AccessHistoryScreen} from '../screens/app/AccessHistoryScreen';
import {BlogsScreen} from '../screens/app/BlogsScreen';
import {BlogPostScreen} from '../screens/app/BlogPostScreen';
import type {AccountStackParamList} from './types';

const Stack = createNativeStackNavigator<AccountStackParamList>();

// Wraps EVERY Account screen (via the navigator's `screenLayout`) so that
// pressing the Account tab returns to the Account menu: the focused screen
// handles `tabPress` and pops its stack to the root. A single root-screen
// listener doesn't fire when a sub-page (Support, Orders…) is on top, so
// wrapping every screen is what makes "tap Account → main page" reliable.
function ResetOnAccountTabPress({children}: {children: React.ReactNode}) {
  const navigation = useNavigation();
  React.useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = (navigation as any).addListener('tabPress', () => {
      if (navigation.canGoBack()) {
        navigation.dispatch(StackActions.popToTop());
      }
    });
    return unsubscribe;
  }, [navigation]);
  return <>{children}</>;
}

export function AccountStack() {
  return (
    <Stack.Navigator
      initialRouteName="Account"
      screenOptions={{headerShown: false}}
      screenLayout={({children}) => (
        <ResetOnAccountTabPress>{children}</ResetOnAccountTabPress>
      )}>
      <Stack.Screen name="Account" component={AccountScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="Wishlist" component={WishlistScreen} />
      <Stack.Screen name="Addresses" component={AddressesScreen} />
      <Stack.Screen name="AddressForm" component={AddressFormScreen} />
      <Stack.Screen name="Orders" component={OrdersScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <Stack.Screen name="Returns" component={ReturnsScreen} />
      <Stack.Screen name="ReturnDetail" component={ReturnDetailScreen} />
      <Stack.Screen name="CreateReturn" component={CreateReturnScreen} />
      <Stack.Screen name="Wallet" component={WalletScreen} />
      <Stack.Screen name="WalletTopup" component={WalletTopupScreen} />
      <Stack.Screen name="Invoices" component={InvoicesScreen} />
      <Stack.Screen name="Tickets" component={TicketsScreen} />
      <Stack.Screen name="TicketDetail" component={TicketDetailScreen} />
      <Stack.Screen name="CreateTicket" component={CreateTicketScreen} />
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
      />
      <Stack.Screen name="About" component={AboutScreen} />
      <Stack.Screen name="DataExport" component={DataExportScreen} />
      <Stack.Screen name="PrivacyConsent" component={PrivacyConsentScreen} />
      <Stack.Screen name="AccessHistory" component={AccessHistoryScreen} />
      <Stack.Screen name="Blogs" component={BlogsScreen} />
      <Stack.Screen name="BlogPost" component={BlogPostScreen} />
    </Stack.Navigator>
  );
}
