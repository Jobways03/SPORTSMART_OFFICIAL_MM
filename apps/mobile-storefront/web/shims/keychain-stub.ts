// Web replacement for react-native-keychain. The native package stores
// values in the iOS Keychain / Android EncryptedSharedPreferences; on
// web we use localStorage. Keychain's `service` option becomes the
// localStorage key prefix so isolation between values is preserved.
//
// Security caveat: localStorage is readable by any JS on the same
// origin (XSS surface). For production-grade web auth we'd want
// httpOnly cookies, but this stub exists for the dev preview only —
// the mobile app on iOS/Android uses the real keychain.

type GenericResult = {service: string; username: string; password: string};

function storageKey(service: string): string {
  return `__keychain_${service}`;
}

export async function getGenericPassword(
  options?: {service?: string},
): Promise<GenericResult | false> {
  const service = options?.service ?? 'default';
  try {
    const raw = localStorage.getItem(storageKey(service));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as {username: string; password: string};
    return {service, username: parsed.username, password: parsed.password};
  } catch {
    return false;
  }
}

export async function setGenericPassword(
  username: string,
  password: string,
  options?: {service?: string},
): Promise<boolean> {
  const service = options?.service ?? 'default';
  try {
    localStorage.setItem(
      storageKey(service),
      JSON.stringify({username, password}),
    );
    return true;
  } catch {
    return false;
  }
}

export async function resetGenericPassword(
  options?: {service?: string},
): Promise<boolean> {
  const service = options?.service ?? 'default';
  try {
    localStorage.removeItem(storageKey(service));
    return true;
  } catch {
    return false;
  }
}

// Re-export the named exports the package's TypeScript types declare,
// so import { getGenericPassword } from 'react-native-keychain' works.
export default {
  getGenericPassword,
  setGenericPassword,
  resetGenericPassword,
};
