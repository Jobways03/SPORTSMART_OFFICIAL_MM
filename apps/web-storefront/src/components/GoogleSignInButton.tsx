'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Sign in with Google" button (Google Identity Services / GIS).
 *
 * Mirrors the CaptchaWidget pattern: it injects the third-party GIS
 * script (https://accounts.google.com/gsi/client) into <head> exactly
 * once (double-inject-guarded by a data attribute), then renders the
 * official Google-rendered button into a ref.
 *
 * Configuration:
 *   - The public OAuth client id is read from
 *     NEXT_PUBLIC_GOOGLE_CLIENT_ID (baked at build, public by design).
 *   - If the env var is unset, the component renders `null` so the
 *     auth pages degrade gracefully (no broken button in local dev /
 *     misconfigured environments).
 *
 * On a successful Google sign-in the GIS callback fires with a signed
 * JWT `credential`. We hand it straight to the `onSuccess` prop — the
 * parent page is responsible for exchanging it with the API
 * (`POST /auth/google`) and running its own post-login sequence + its
 * own ApiError-based inline error UI. Keeping the network call in the
 * page lets both /login and /register reuse their existing error UX.
 *
 * The latest `onSuccess` is held in a ref so the GIS button is only
 * initialised / re-rendered when the script loads or the visible text
 * changes — not on every parent re-render.
 */
interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
}

interface GsiButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number | string;
  locale?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfiguration) => void;
          renderButton: (
            parent: HTMLElement,
            options: GsiButtonConfiguration,
          ) => void;
          cancel: () => void;
        };
      };
    };
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

// GIS hard-caps the rendered button width at 400px and floors usable
// widths around 200px. We measure the container and clamp into range
// so the button is as wide as the surrounding CTA allows (centered by
// the parent's `flex justify-center`).
const MIN_BUTTON_WIDTH = 240;
const MAX_BUTTON_WIDTH = 400;

interface GoogleSignInButtonProps {
  /** Called with the signed Google JWT credential on success. */
  onSuccess: (credential: string) => void | Promise<void>;
  /** Visible button copy. Defaults to "Continue with Google". */
  text?: GsiButtonConfiguration['text'];
  /** Wrapper class for layout (e.g. spacing + `flex justify-center`). */
  className?: string;
}

export function GoogleSignInButton({
  onSuccess,
  text = 'continue_with',
  className,
}: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  // Hold the latest onSuccess so the GIS init effect doesn't depend on
  // it (the parent passes a fresh closure each render).
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  // Load the GIS script once per page.
  useEffect(() => {
    if (!CLIENT_ID) return;
    if (window.google?.accounts?.id) {
      setScriptLoaded(true);
      return;
    }

    const existing = document.querySelector(
      'script[data-gsi="google"]',
    ) as HTMLScriptElement | null;
    if (existing) {
      const onload = () => setScriptLoaded(true);
      existing.addEventListener('load', onload);
      // It may have finished loading between the query and the listener.
      if (window.google?.accounts?.id) setScriptLoaded(true);
      return () => existing.removeEventListener('load', onload);
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.setAttribute('data-gsi', 'google');
    script.onload = () => setScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Initialise GIS and render the button once the script is ready.
  useEffect(() => {
    if (!CLIENT_ID || !scriptLoaded) return;
    const container = containerRef.current;
    const google = window.google;
    if (!container || !google?.accounts?.id) return;

    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: (response: GoogleCredentialResponse) => {
        if (response?.credential) {
          void onSuccessRef.current(response.credential);
        }
      },
      cancel_on_tap_outside: true,
    });

    const measured = container.offsetWidth || MIN_BUTTON_WIDTH;
    const width = Math.min(
      Math.max(measured, MIN_BUTTON_WIDTH),
      MAX_BUTTON_WIDTH,
    );

    google.accounts.id.renderButton(container, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text,
      shape: 'pill',
      logo_alignment: 'left',
      width,
    });

    return () => {
      try {
        google.accounts.id.cancel();
      } catch {
        // GIS may be mid-teardown; ignore.
      }
      container.innerHTML = '';
    };
  }, [scriptLoaded, text]);

  // Graceful no-op when the client id isn't configured.
  if (!CLIENT_ID) return null;

  return <div ref={containerRef} className={className} />;
}
