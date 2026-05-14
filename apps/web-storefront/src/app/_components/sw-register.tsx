'use client';

import { useEffect } from 'react';

// Registers the storefront service worker on mount. Kept as a tiny
// client island so the rest of the layout can stay server-rendered.
// Registration is no-op in dev (Next dev server doesn't serve /sw.js
// from .next), guarded by NODE_ENV so HMR isn't interfered with.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => {
          // Swallow — failing to register the SW must never break
          // the page. The site works fine without offline fallback.
        });
    };

    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });

    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}
