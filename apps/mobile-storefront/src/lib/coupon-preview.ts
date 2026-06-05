import AsyncStorage from '@react-native-async-storage/async-storage';
import type {PreviewedCoupon} from '../services/checkout.service';

// Coupon preview shared between the cart (where it's applied) and checkout
// (where it's reflected + sent to place-order). The coupon is always
// re-validated server-side at place-order, so this is purely an advisory
// preview — never the source of truth for the charge.
//
// Source of truth is an in-memory module variable: it's shared across
// screens within a session (navigation doesn't reload modules) and behaves
// identically on web + native, so the cart → checkout handoff never depends
// on AsyncStorage's platform quirks. AsyncStorage is a best-effort backup
// so the preview also survives an app restart / hard reload.
const KEY = 'sm.previewedCoupon';

let memoryCoupon: PreviewedCoupon | null = null;

export async function getCouponPreview(): Promise<PreviewedCoupon | null> {
  if (memoryCoupon) return memoryCoupon;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      memoryCoupon = JSON.parse(raw) as PreviewedCoupon;
      return memoryCoupon;
    }
  } catch {
    // fall through to null
  }
  return null;
}

export async function setCouponPreview(coupon: PreviewedCoupon): Promise<void> {
  memoryCoupon = coupon;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(coupon));
  } catch {
    // Non-fatal: in-memory copy still carries the handoff this session.
  }
}

export async function clearCouponPreview(): Promise<void> {
  memoryCoupon = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
