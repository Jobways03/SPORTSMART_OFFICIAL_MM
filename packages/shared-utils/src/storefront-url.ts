/**
 * Resolve a URL on the customer STOREFRONT from any seller/partner portal
 * (retail-seller, d2c-seller, franchise, affiliate). The legal pages (Terms,
 * Privacy, etc.) live ONLY on the storefront, so the portals link across to it.
 *
 * Derived from the caller's host so it resolves in every environment without a
 * build-time env var:
 *   prod     retail-seller.sportsmart.com          -> shop.sportsmart.com
 *   staging  retail-seller.staging.sportsmart.com  -> shop.staging.sportsmart.com
 *   local    localhost:<port>                      -> localhost:4005
 *
 * Pass the current host (window.location.hostname). When omitted/null (SSR or
 * pre-hydration), defaults to the production storefront so a server render still
 * emits a valid URL.
 */
export function resolveStorefrontUrl(path: string, host?: string | null): string {
  if (!host) return `https://shop.sportsmart.com${path}`;
  if (host === 'localhost' || host === '127.0.0.1') {
    return `http://localhost:4005${path}`;
  }
  // Strip the portal's own subdomain label, then prefix the storefront's ("shop").
  const base = host.replace(/^[^.]+\./, '');
  return `https://shop.${base}${path}`;
}

/** Canonical storefront paths for the legal pages the portals link to. */
export const STOREFRONT_LEGAL_PATHS = {
  terms: '/pages/terms-and-conditions',
  privacy: '/pages/privacy-policy',
} as const;
