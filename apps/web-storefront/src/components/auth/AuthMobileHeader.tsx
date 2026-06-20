import Link from 'next/link';

/**
 * Top bar for the customer auth split-screen (login / register / forgot-password
 * + their steps). The branded left panel is `hidden lg:block`, so below `lg`
 * this bar carries the brand: a single CENTERED Sportsmart logo with room to
 * breathe. The "Already have an account? Sign in"-style switch link used to be
 * crammed next to the wordmark and collided/​wrapped at phone widths — it's now
 * desktop-only (there's space beside the form), and every page already repeats
 * the same switch link at the foot of the form for mobile users.
 */
export function AuthMobileHeader({
  switchPrompt,
  switchLabel,
  switchHref,
}: {
  switchPrompt: string;
  switchLabel: string;
  switchHref: string;
}) {
  return (
    <header className="px-6 lg:px-10 pt-8 pb-3 lg:py-6">
      {/* Mobile: centered logo (the brand panel is hidden below lg). */}
      <Link href="/" aria-label="Sportsmart home" className="lg:hidden mx-auto block w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/SportsMart_Web_Banner.avif" alt="SportsMart" className="h-9 w-auto" />
      </Link>
      {/* Desktop: switch link, right-aligned beside the form. */}
      <p className="hidden lg:block text-right text-caption text-ink-600">
        {switchPrompt}{' '}
        <Link
          href={switchHref}
          className="text-accent-dark font-semibold hover:text-ink-900 hover:underline underline-offset-2"
        >
          {switchLabel}
        </Link>
      </p>
    </header>
  );
}
