// Web replacement for @sentry/react-native. The two SDKs share the
// same `init` / `captureException` / `captureMessage` surface, so we
// just re-export from @sentry/browser and add the `wrap` HOC the RN
// SDK provides (browser SDK doesn't ship `wrap` — we provide an
// identity passthrough since it's only used for profiling integrations
// that don't apply on web).

import * as SentryBrowser from '@sentry/browser';

export const init = SentryBrowser.init;
export const captureException = SentryBrowser.captureException;
export const captureMessage = SentryBrowser.captureMessage;
export const setUser = SentryBrowser.setUser;
export const setTag = SentryBrowser.setTag;
export const setContext = SentryBrowser.setContext;
export const addBreadcrumb = SentryBrowser.addBreadcrumb;

// @sentry/react-native's `wrap(App)` enables performance + profiling
// integrations. The browser SDK does that via init options instead,
// so on web `wrap` is just identity.
export function wrap<T>(component: T): T {
  return component;
}

export default {
  init,
  captureException,
  captureMessage,
  setUser,
  setTag,
  setContext,
  addBreadcrumb,
  wrap,
};
