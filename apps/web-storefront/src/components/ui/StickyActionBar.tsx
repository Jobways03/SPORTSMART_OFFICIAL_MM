import type { ReactNode } from 'react';

/**
 * Mobile-only sticky bottom action bar (`lg:hidden`). Pins a primary CTA to
 * the bottom of the viewport on phones/tablets — used by the PDP (add to
 * cart / buy now), the cart (proceed to checkout), and checkout (place order),
 * where the real action would otherwise sit at the end of a long mobile scroll.
 *
 * Pages that mount this MUST add bottom padding to their content wrapper so
 * nothing hides behind the bar — `pb-24 lg:pb-0` for a single-row bar, more
 * if the content wraps. Honors the iOS home-indicator safe-area inset.
 */
export function StickyActionBar({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-ink-200 px-4 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] ${className}`}
    >
      {children}
    </div>
  );
}
