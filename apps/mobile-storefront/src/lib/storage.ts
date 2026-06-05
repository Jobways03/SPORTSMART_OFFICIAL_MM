import * as Keychain from 'react-native-keychain';
import type {TokenStorage} from '@sportsmart/shared-utils';

// On RN we can't co-mingle multiple values under one Keychain service, so
// every key gets its own service name. The service is the unit of read/
// write isolation in Keychain; this scheme keeps tokens and user-profile
// JSON separately revocable.
const SERVICE_PREFIX = 'com.sportsmart.storefront.';

// We persist using setGenericPassword(username, password). Keychain
// requires both — we set the username to the storage key for traceability
// (visible in Keychain Access on macOS) but only the password is consumed.
const KEYCHAIN_USERNAME = 'token';

export const keychainStorage: TokenStorage = {
  async getItem(key) {
    try {
      const result = await Keychain.getGenericPassword({
        service: SERVICE_PREFIX + key,
      });
      if (!result) return null;
      return result.password;
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      await Keychain.setGenericPassword(KEYCHAIN_USERNAME, value, {
        service: SERVICE_PREFIX + key,
      });
    } catch {
      // Keychain can fail when biometrics aren't enrolled or the
      // user denies access — swallow so an unauthenticated retry can
      // still proceed.
    }
  },
  async removeItem(key) {
    try {
      await Keychain.resetGenericPassword({service: SERVICE_PREFIX + key});
    } catch {
      // ignore
    }
  },
};
