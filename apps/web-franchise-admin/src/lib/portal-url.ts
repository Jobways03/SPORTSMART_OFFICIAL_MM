/**
 * Resolve a sibling portal's base URL at RUNTIME from this admin app's own
 * host, so impersonate redirects (which open the target portal in a new tab)
 * resolve correctly in production + staging WITHOUT a per-app build-time env
 * var. NEXT_PUBLIC_* values are baked at build time and were never set for the
 * portal URLs, so they fell back to localhost — which broke impersonate in
 * production ("This site can't be reached" on localhost:3005 / :4003).
 *
 * Mapping (derived from the current admin subdomain):
 *   <type>-admin.<base>  --seller-->    <type>-seller.<base>   (d2c-admin -> d2c-seller)
 *   *.<base>             --franchise--> franchise.<base>
 * e.g. d2c-admin.sportsmart.com           -> d2c-seller.sportsmart.com / franchise.sportsmart.com
 *      retail-admin.staging.sportsmart.com -> retail-seller.staging.sportsmart.com
 *
 * On localhost (local dev) it returns the supplied dev fallback (the existing
 * NEXT_PUBLIC_* / localhost value), so the dev flow is unchanged.
 */
export function siblingPortalUrl(
  target: 'seller' | 'franchise',
  devFallback: string,
): string {
  if (typeof window === 'undefined') return devFallback;
  const { protocol, host } = window.location; // e.g. d2c-admin.sportsmart.com[:port]
  const isLocal =
    host.startsWith('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('0.0.0.0');
  const firstDot = host.indexOf('.');
  if (isLocal || firstDot <= 0) return devFallback;
  const adminSub = host.slice(0, firstDot); // d2c-admin
  const baseDomain = host.slice(firstDot + 1); // sportsmart.com | staging.sportsmart.com
  const targetSub =
    target === 'franchise' ? 'franchise' : adminSub.replace(/-admin$/, '-seller');
  return `${protocol}//${targetSub}.${baseDomain}`;
}
