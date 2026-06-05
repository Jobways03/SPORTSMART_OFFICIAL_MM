// Web replacement for posthog-react-native. The default export of the
// RN package is a class you `new PostHog(apiKey, options)`; the web
// SDK (posthog-js) is a singleton you `posthog.init(apiKey, options)`.
// We wrap posthog-js in a class with the same shape so call sites in
// lib/analytics.ts don't need a separate web version.

import posthogJs, {PostHog as PostHogJs} from 'posthog-js';

interface PostHogOptions {
  host?: string;
  flushAt?: number;
  flushInterval?: number;
}

class PostHog {
  private inner: PostHogJs;

  constructor(apiKey: string, options?: PostHogOptions) {
    posthogJs.init(apiKey, {
      api_host: options?.host ?? 'https://us.i.posthog.com',
      // posthog-js batches automatically; flushAt/flushInterval don't
      // map directly but session-replay + autocapture are sensible
      // defaults for web.
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
    });
    this.inner = posthogJs;
  }

  identify(userId: string, props?: Record<string, unknown>) {
    this.inner.identify(userId, props as Record<string, string>);
  }

  capture(event: string, props?: Record<string, unknown>) {
    this.inner.capture(event, props as Record<string, string>);
  }

  screen(name: string, props?: Record<string, unknown>) {
    // posthog-js uses $pageview as the canonical screen event.
    this.inner.capture('$pageview', {
      screen_name: name,
      ...(props ?? {}),
    } as Record<string, string>);
  }

  reset() {
    this.inner.reset();
  }
}

export default PostHog;
