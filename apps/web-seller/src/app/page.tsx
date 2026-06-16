/**
 * web-seller shell home.
 *
 * This app had no committed source at all (only stale build artifacts), so
 * it could not boot. This is a minimal placeholder shell so it starts on
 * port 4011 alongside the rest of the monorepo. The seller-facing features
 * currently live in the dedicated apps (`web-d2c-seller`, `web-retail-seller`,
 * `web-franchise`); flesh this out when the unified seller console is built.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <span className="inline-block w-fit rounded bg-brand px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">
        Sportsmart Seller
      </span>
      <h1 className="text-3xl font-bold text-ink-900">Seller console shell</h1>
      <p className="text-ink-600">
        Placeholder app booting on port 4011. Seller features currently live in{' '}
        <code>web-d2c-seller</code>, <code>web-retail-seller</code>, and{' '}
        <code>web-franchise</code>.
      </p>
    </main>
  );
}
