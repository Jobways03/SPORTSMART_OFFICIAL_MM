import type {LinkingOptions} from '@react-navigation/native';
import type {RootStackParamList} from './types';

// React Navigation parses incoming URLs against this config tree.
// Prefix `sportsmart://` is the iOS URL Type / Android intent-filter
// scheme registered on the native side. Once App/Universal Links
// are wired (apple-app-site-association + assetlinks.json on the
// sportsmart.com domain) the array below grows to include 'https://...'.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['sportsmart://'],
  config: {
    screens: {
      // Unauthenticated stack — only login deep-link is meaningful here;
      // every other path falls through to Login because RootNavigator
      // mounts AuthStack when isAuthenticated is false.
      Auth: {
        screens: {
          Login: 'login',
          Register: 'register',
        },
      },
      // Authenticated app shell. RootNavigator swaps between Auth/App
      // based on auth state — when not signed in, the user lands on
      // Login and is bounced through to the linked screen after auth.
      App: {
        screens: {
          HomeTab: 'home',
          BrowseTab: {
            screens: {
              Browse: 'browse',
              ProductDetail: 'product/:productSlug',
            },
          },
          CartTab: {
            screens: {
              Cart: 'cart',
            },
          },
          AccountTab: {
            screens: {
              Account: 'account',
              Orders: 'orders',
              OrderDetail: 'order/:orderNumber',
              Returns: 'returns',
              ReturnDetail: 'return/:returnId',
              Wishlist: 'wishlist',
              Wallet: 'wallet',
              Addresses: 'addresses',
              EditProfile: 'profile',
              Tickets: 'support',
              TicketDetail: 'support/:ticketId',
            },
          },
        },
      },
    },
  },
};
