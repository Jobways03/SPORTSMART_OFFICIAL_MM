import Link from 'next/link';

/**
 * Shared branded left panel for the customer auth split-screen (login,
 * register, forgot-password + its steps). Renders the gradient backdrop, the
 * subtle diagonal-line overlay, and the Sportsmart logo; `children` is each
 * page's own hero block (headline + copy + feature list), placed in the
 * centered content area. Hidden below `lg` — the form column carries the
 * mobile wordmark. Keeps every auth page visually consistent without
 * duplicating the shell markup on each one.
 */
export function AuthBrandPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hidden lg:block relative overflow-hidden bg-ink-100"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 60% at 85% 15%, rgba(63, 161, 174, 0.45), transparent 60%), radial-gradient(ellipse 70% 50% at 15% 85%, rgba(220, 38, 38, 0.22), transparent 60%), radial-gradient(ellipse 50% 40% at 50% 50%, rgba(250, 204, 21, 0.18), transparent 60%)',
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.04] mix-blend-multiply"
        style={{
          backgroundImage:
            'repeating-linear-gradient(135deg, rgba(26,26,26,1) 0, rgba(26,26,26,1) 1px, transparent 1px, transparent 28px)',
        }}
      />
      <div className="relative h-full flex flex-col p-12 xl:p-16">
        <Link href="/" aria-label="Sportsmart home" className="inline-block w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/SportsMart_Web_Banner.avif" alt="SportsMart" className="h-14 w-auto" />
        </Link>
        <div className="flex-1 flex flex-col justify-center max-w-xl">{children}</div>
      </div>
    </div>
  );
}
