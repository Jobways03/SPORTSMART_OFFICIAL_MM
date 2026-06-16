/**
 * web-admin shell home.
 *
 * This app was previously missing all of its Next scaffolding (no
 * package.json / config / root layout), so it could not boot. The only
 * source it carried was a set of half-finished Nova admin pages
 * (flash-sales, blog-posts, events, product-reviews, storefront-content,
 * storefront-slots) that depend on service modules which were never
 * committed here. Those pages now live under `src/app/_parked/` so they
 * are preserved but excluded from routing and the build — the active
 * implementation of that functionality lives in `web-admin-storefront`.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <span className="inline-block w-fit rounded bg-brand px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">
        Sportsmart Admin
      </span>
      <h1 className="text-3xl font-bold text-ink-900">Admin console shell</h1>
      <p className="text-ink-600">
        This app boots on port 4010. The Nova admin pages it once held are
        parked under <code>src/app/_parked/</code> pending wiring of their
        service layer; the active admin storefront runs in{' '}
        <code>web-admin-storefront</code> on port 4000.
      </p>
    </main>
  );
}
