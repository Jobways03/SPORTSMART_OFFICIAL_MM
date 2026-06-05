import {Platform} from 'react-native';
import {createApiClient} from '@sportsmart/shared-utils';
import {API_URL} from '@env';
import {keychainStorage} from './storage';
import {navigationRef} from '../navigation/navigation-ref';

export {ApiError} from '@sportsmart/shared-utils';
export type {ApiResponse} from '@sportsmart/shared-utils';

// API_BASE resolution:
//   1. process.env.API_URL — explicit override (e.g. when pointing the
//      simulator at a staging URL or a tunnelled localhost via ngrok).
//   2. Platform-aware localhost defaults:
//        - iOS sim shares the Mac's network namespace, so localhost
//          resolves to the host.
//        - Android emulator sees its own loopback when it hears
//          'localhost'; 10.0.2.2 is the conventional alias for the
//          host machine. Real devices need a LAN IP or tunnel.
//        - Web uses an empty base so fetch() stays same-origin
//          (:5173 during Vite dev); Vite's /api proxy then forwards
//          to :8000. Sidesteps browser CORS without touching the API.
// DOM-presence check is more reliable than Platform.OS here: some RN
// Web init paths don't set Platform.OS = 'web' until after this module
// initialises, but `window`/`document` are always defined in a browser.
const IS_WEB =
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  Platform.OS !== 'ios' &&
  Platform.OS !== 'android';
const DEFAULT_LOCAL = IS_WEB
  ? ''
  : Platform.OS === 'android'
  ? 'http://10.0.2.2:8000'
  : 'http://localhost:8000';
// On web, ignore any API_URL override too — Vite proxy expects same-origin.
const apiBaseUrl = IS_WEB ? '' : API_URL || DEFAULT_LOCAL;

const {apiClient, API_BASE} = createApiClient({
  accessTokenKey: 'accessToken',
  refreshTokenKey: 'refreshToken',
  userKey: 'user',
  refreshPath: 'auth/refresh',
  storage: keychainStorage,
  apiBaseUrl,
  onAuthFailure: () => {
    // Kick the user back to the auth stack when the refresh token is
    // dead. resetRoot() empties the navigation history so they can't
    // "back" into a protected screen.
    if (navigationRef.isReady()) {
      navigationRef.resetRoot({
        index: 0,
        routes: [{name: 'Auth'}],
      });
    }
  },
});

export {apiClient, API_BASE};
