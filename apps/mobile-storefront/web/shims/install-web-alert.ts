// react-native-web ships `Alert.alert` as a no-op:
//
//     class Alert { static alert() {} }
//
// So every `Alert.alert(...)` across the app silently does nothing in the
// web preview — confirmations (remove from cart, delete address, log out,
// cancel order) never appear, and their destructive `onPress` never runs.
// The user just sees a dead button.
//
// This installs a browser-backed implementation so those flows work on web.
// Imported first from web/index.tsx; native (iOS/Android) never loads this
// file, so the real native Alert is untouched there.
import {Alert} from 'react-native';

type AlertButton = {
  text?: string;
  onPress?: (value?: string) => void;
  style?: 'default' | 'cancel' | 'destructive';
};

const webAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
): void => {
  const body = [title, message].filter(Boolean).join('\n\n');

  // No buttons (or a single acknowledge button) → informational alert.
  if (!buttons || buttons.length <= 1) {
    if (typeof window !== 'undefined') window.alert(body);
    buttons?.[0]?.onPress?.();
    return;
  }

  // Two-or-more buttons → a confirmation. The browser confirm() only
  // offers OK / Cancel, so map: OK → the first non-cancel ("action")
  // button, Cancel → the cancel button. This covers the app's pattern
  // of [{Cancel}, {Remove/Delete/Confirm, destructive}].
  const cancelBtn = buttons.find(b => b.style === 'cancel');
  const actionBtn =
    buttons.find(b => b.style !== 'cancel') ?? buttons[buttons.length - 1];
  const confirmed =
    typeof window !== 'undefined' ? window.confirm(body) : true;
  if (confirmed) actionBtn?.onPress?.();
  else cancelBtn?.onPress?.();
};

(Alert as unknown as {alert: typeof webAlert}).alert = webAlert;

export {};
