'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Phase 16 (2026-05-20) — Captcha bot-protection widget.
 *
 * Renders a Cloudflare Turnstile (or hCaptcha) challenge when the
 * provider is configured, or a no-op invisible placeholder when
 * NEXT_PUBLIC_CAPTCHA_PROVIDER is 'disabled' (local dev). The widget
 * is invisible to the user in the disabled state — they see nothing
 * — and immediately resolves with an empty token so the parent form
 * can submit. The API's CaptchaVerifierService also short-circuits
 * when CAPTCHA_PROVIDER=disabled, so the end-to-end flow works.
 *
 * Props:
 *   - onToken: called with the freshly issued token (string) or with
 *     an empty string in disabled mode. Parent stores it on its
 *     submit handler.
 *   - className: optional outer wrapper class for layout.
 *
 * The component re-issues a token on mount; the parent should call
 * `resetKey` (any changing key prop) to force a fresh challenge —
 * useful after a failed submit when the previous token has been
 * burned by the API verification (Turnstile tokens are single-use).
 */
interface CaptchaWidgetProps {
  onToken: (token: string) => void;
  className?: string;
  resetKey?: string | number;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    hcaptcha?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const PROVIDER =
  (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? 'disabled').toLowerCase() as
    | 'disabled'
    | 'turnstile'
    | 'hcaptcha';

const SITE_KEY = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY ?? '';

export function CaptchaWidget({
  onToken,
  className,
  resetKey,
}: CaptchaWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  // Disabled mode: emit an empty token immediately and render nothing.
  useEffect(() => {
    if (PROVIDER === 'disabled') {
      onToken('');
    }
  }, [onToken, resetKey]);

  // Load provider script once per page.
  useEffect(() => {
    if (PROVIDER === 'disabled' || !SITE_KEY) return;

    const existing = document.querySelector(
      PROVIDER === 'turnstile'
        ? 'script[data-captcha="turnstile"]'
        : 'script[data-captcha="hcaptcha"]',
    );
    if (existing) {
      setScriptLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.setAttribute(
      'data-captcha',
      PROVIDER === 'turnstile' ? 'turnstile' : 'hcaptcha',
    );
    script.src =
      PROVIDER === 'turnstile'
        ? 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        : 'https://js.hcaptcha.com/1/api.js';
    script.onload = () => setScriptLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Render / reset the widget when ready.
  useEffect(() => {
    if (PROVIDER === 'disabled' || !SITE_KEY) return;
    if (!scriptLoaded || !containerRef.current) return;

    const provider =
      PROVIDER === 'turnstile' ? window.turnstile : window.hcaptcha;
    if (!provider) return;

    // If we already rendered once, reset instead of re-rendering to
    // keep the DOM stable.
    if (widgetIdRef.current) {
      provider.reset(widgetIdRef.current);
      return;
    }

    widgetIdRef.current = provider.render(containerRef.current, {
      sitekey: SITE_KEY,
      callback: (token: string) => onToken(token),
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken(''),
      ...(PROVIDER === 'turnstile' ? { theme: 'light' as const } : {}),
    });
  }, [scriptLoaded, resetKey, onToken]);

  if (PROVIDER === 'disabled') return null;

  if (!SITE_KEY) {
    return (
      <div className={className}>
        <p className="text-caption text-danger">
          Captcha misconfigured (missing site key). Contact support.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className={className} />;
}
