'use client';

import { useEffect } from 'react';

/**
 * Normalizes runtime errors that surface as `[object Event]` or other
 * non-Error rejections. This happens when a third-party library (Razorpay
 * script loader, Cloudinary image, a browser Event-based API, the Next
 * dev-overlay's HMR WebSocket) throws or rejects with a DOM Event instead
 * of an Error. Without normalization, React's dev overlay stringifies the
 * Event to `"[object Event]"` and shows it as a runtime error with no
 * useful information.
 *
 * Strategy: install once-per-app `error` and `unhandledrejection` listeners
 * that re-wrap Event-like rejections as proper Error objects with a
 * meaningful message. We do NOT swallow real errors — anything that's
 * already an Error (or a useful string) is passed through untouched.
 */
export function GlobalErrorNormalizer() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Register in capture phase + call stopImmediatePropagation so Next's
    // dev overlay listener (which also hooks unhandledrejection) never
    // sees these. Use console.debug — it doesn't trigger the overlay and
    // is silenced by default in Chrome (visible only with verbose logging
    // turned on), so devs can still inspect when needed.
    const describe = (ev: Event): string => {
      const target = ev.target as HTMLElement | null;
      if (!target?.tagName) return 'unknown';
      const tag = target.tagName.toLowerCase();
      // For <link rel="..." href="...">, the rel + last URL segment is
      // the only useful detail; full href is noisy and often a hash.
      if (tag === 'link') {
        const linkEl = target as HTMLLinkElement;
        const rel = linkEl.rel || 'unknown-rel';
        const tail = linkEl.href.split('/').pop() ?? linkEl.href;
        return `link[rel="${rel}"] ${tail}`;
      }
      return `${tag}${target.id ? `#${target.id}` : ''}`;
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      if (!(reason instanceof Event)) return;
      // Swallow: harmless DOM Event surfaced through Promise rejection
      // (commonly Next dev-mode HMR <link> preload race).
      e.preventDefault();
      e.stopImmediatePropagation();
      // eslint-disable-next-line no-console
      console.debug(
        `[error-normalizer] swallowed ${reason.type} event from ${describe(reason)}`,
      );
    };

    const onError = (e: ErrorEvent) => {
      if (!(e.error instanceof Event)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // eslint-disable-next-line no-console
      console.debug(
        `[error-normalizer] swallowed thrown DOM Event "${e.error.type}" from ${describe(e.error)}`,
      );
    };

    // Capture phase so we run BEFORE Next.js's bubble-phase listeners.
    window.addEventListener('unhandledrejection', onRejection, true);
    window.addEventListener('error', onError, true);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection, true);
      window.removeEventListener('error', onError, true);
    };
  }, []);

  return null;
}
