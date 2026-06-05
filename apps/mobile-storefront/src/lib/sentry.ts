import * as Sentry from '@sentry/react-native';
import {SENTRY_DSN, SENTRY_ENVIRONMENT} from '@env';

let initialised = false;

/**
 * Initialise Sentry at app boot. Idempotent — safe to call twice.
 * When SENTRY_DSN is empty, this is a no-op so dev builds don't pollute
 * any project.
 *
 * Sentry's native side (@sentry/react-native bridges to sentry-cocoa
 * + sentry-android) is autolinked, so the bundle compiles and the JS
 * methods exist even when the DSN is blank — they just discard events.
 */
export function initSentry(): void {
  if (initialised) return;
  initialised = true;

  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT || 'development',
    // Capture 100% of transactions in non-prod, 20% in prod. Cheap on
    // staging where volume is low, conservative on prod where it isn't.
    tracesSampleRate: SENTRY_ENVIRONMENT === 'production' ? 0.2 : 1.0,
    // Sentry's auto-instrumentation hooks into fetch + navigation. We
    // accept the defaults — they're tuned for RN apps.
    enableAutoSessionTracking: true,
    sessionTrackingIntervalMillis: 30_000,
  });
}

/**
 * Manually capture an exception with optional context. Used by
 * ErrorBoundary; can also be called from anywhere a caught error
 * deserves an event (e.g. a failed background sync).
 */
export function reportError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!SENTRY_DSN) {
    // eslint-disable-next-line no-console
    console.error('[reportError]', error, context);
    return;
  }
  if (error instanceof Error) {
    Sentry.captureException(error, {extra: context});
  } else {
    Sentry.captureMessage(String(error), {level: 'error', extra: context});
  }
}

/** Wraps the root component so Sentry's profiling integrations attach. */
export const wrapApp = Sentry.wrap;
