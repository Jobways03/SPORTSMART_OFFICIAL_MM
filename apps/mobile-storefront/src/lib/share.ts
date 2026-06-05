import {useCallback, useState} from 'react';
import {Share} from 'react-native';
import {LINKS} from './links';

// Placeholder invite target. There's no referral backend yet (nothing
// mints per-user codes), so we share the storefront URL. Swap INVITE_URL
// for a per-user referral link once that exists — callers don't change.
const INVITE_URL = LINKS.website;
const INVITE_MESSAGE =
  'Get ₹250 off your first order on Sportsmart — and I get ₹500 in my wallet when you shop. Join here:';

export type ShareResult = 'shared' | 'copied' | 'unavailable';

/**
 * Cross-platform invite share:
 *  - native (and web browsers with the Web Share API) → share sheet
 *  - web without navigator.share (most desktop browsers) → clipboard copy
 *
 * react-native-web's Share.share() forwards to navigator.share and
 * rejects when it's missing, so we catch that and fall back.
 */
export async function shareInviteLink(): Promise<ShareResult> {
  const text = `${INVITE_MESSAGE} ${INVITE_URL}`;
  try {
    await Share.share({
      message: text,
      url: INVITE_URL,
      title: 'Sportsmart invite',
    });
    return 'shared';
  } catch {
    const clipboard =
      typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (clipboard?.writeText) {
      try {
        await clipboard.writeText(text);
        return 'copied';
      } catch {
        return 'unavailable';
      }
    }
    return 'unavailable';
  }
}

/**
 * Hook for the "Share invite" buttons. Returns the share action plus a
 * transient `justCopied` flag so a button can confirm a clipboard copy
 * on web (where there's no share sheet to provide its own feedback).
 */
export function useShareInvite() {
  const [justCopied, setJustCopied] = useState(false);
  const share = useCallback(async () => {
    const result = await shareInviteLink();
    if (result === 'copied') {
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 2000);
    }
  }, []);
  return {share, justCopied};
}
