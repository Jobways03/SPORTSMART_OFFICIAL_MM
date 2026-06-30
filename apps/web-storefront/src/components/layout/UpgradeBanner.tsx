import { Sparkles, ArrowRight } from 'lucide-react';

// Classic (previous-generation) storefront. Kept as a constant so the
// destination is changed in one place if the legacy host ever moves.
const CLASSIC_URL = 'https://classic.sportsmart.com';

// The scrolling notice. Repeated inside the marquee track so the
// `translateX(-50%)` keyframe loops seamlessly (same pattern as SportStrip).
const Message = () => (
  <span className="inline-flex items-center gap-2 px-10 text-body-lg sm:text-h3 font-medium">
    <Sparkles className="size-5 shrink-0 text-accent-dark" strokeWidth={1.75} />
    <span>
      <span className="font-semibold">Sportsmart.com is upgrading to our new web app.</span>{' '}
      To access the previous version, please visit{' '}
      <span className="font-semibold text-accent-dark">classic.sportsmart.com</span>.
    </span>
  </span>
);

/**
 * Migration notice shown directly beneath the navbar while the new web app
 * rolls out. The message scrolls as a marquee; the CTA stays pinned (and
 * clickable) on the right and points users at the classic storefront.
 */
export function UpgradeBanner() {
  return (
    <div className="bg-gold border-y border-gold-dark/40 text-ink-900">
      <div className="group w-full px-4 sm:px-6 lg:px-10 py-3.5 flex items-center gap-4">
        {/* Scrolling message — pauses on hover so it can be read in full. */}
        <div className="relative flex-1 overflow-hidden">
          <div className="flex w-max animate-marquee whitespace-nowrap group-hover:[animation-play-state:paused]">
            <Message />
            <Message />
            <Message />
            <Message />
          </div>
        </div>

        <a
          href={CLASSIC_URL}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-ink-900 px-5 text-body-lg font-semibold text-white transition hover:bg-ink-800 active:bg-ink-700"
        >
          Go to classic site
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </a>
      </div>
    </div>
  );
}
