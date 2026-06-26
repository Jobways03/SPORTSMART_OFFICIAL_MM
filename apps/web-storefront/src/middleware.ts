import { NextRequest, NextResponse } from 'next/server';
import legacyRedirect from './data/shopify-legacy-redirect.json';

/**
 * Affiliate referral capture (SRS §7.1).
 *
 * If a request arrives with `?ref=AFXXXX`, write a long-lived
 * `sm_ref` cookie so that even if the customer browses other pages,
 * leaves and comes back, or closes the tab and returns within 30
 * days, the referral still attaches at checkout.
 *
 * Last-click model: a fresh `?ref=` always overwrites the previous
 * cookie (SRS §7.1 final paragraph).
 *
 * The cookie is httpOnly=false on purpose — the checkout page reads
 * it client-side to send the value as `referralCode` in the
 * place-order POST. Once the order is placed, the server's
 * `ReferralAttribution` row is the source of truth, so the cookie
 * being readable by JS is fine.
 *
 * Inactive / expired affiliate codes are silently ignored at the
 * resolution layer (`AffiliatePublicFacade.resolveAttribution`), so
 * we don't try to validate the code here — keep the middleware
 * fast and stateless.
 */
const REF_COOKIE_NAME = 'sm_ref';
const REF_COOKIE_TTL_DAYS = 30;

/**
 * Legacy Shopify URL → `classic.<domain>` redirect (clean-launch migration).
 *
 * The new platform launches with an ALL-NEW catalog (no Shopify data migrated),
 * yet the new storefront reuses the SAME URL structure as Shopify
 * (`/products/<slug>`, `/collections/<slug>`, `/pages/<slug>`, `/blogs/<slug>`).
 * So we must NOT blanket-redirect those prefixes — that would 301 live
 * new-platform pages to the dead store. Instead we redirect ONLY the explicit
 * set of OLD Shopify paths (populated from the Shopify export at cutover) to the
 * SAME path on the classic host, where the legacy store still lives. New-platform
 * URLs are never in that set, so they pass through untouched.
 *
 * Config: src/data/shopify-legacy-redirect.json — committed and EMPTY by default
 * (⇒ no-op). At cutover set `classicHost` + `paths` and redeploy; no env var or
 * infra change is needed. See docs/runbooks/PRODUCTION_APEX_CUTOVER.md.
 */
type LegacyRedirectConfig = { classicHost?: string; paths?: string[] };
const LEGACY = legacyRedirect as LegacyRedirectConfig;
// Normalize away a trailing slash so "/products/x" and "/products/x/" match.
const stripTrailingSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const LEGACY_HOST = (LEGACY.classicHost ?? '').replace(/\/+$/, '');
const LEGACY_PATHS = new Set((LEGACY.paths ?? []).map(stripTrailingSlash));

export function middleware(request: NextRequest) {
  // Legacy Shopify path → permanent (301) redirect to the same path on the
  // classic host. Allow-list only, so new-platform URLs are never touched.
  if (LEGACY_HOST && LEGACY_PATHS.size > 0) {
    if (LEGACY_PATHS.has(stripTrailingSlash(request.nextUrl.pathname))) {
      // Preserve the original path (incl. any trailing slash) + query string.
      return NextResponse.redirect(
        `${LEGACY_HOST}${request.nextUrl.pathname}${request.nextUrl.search}`,
        301,
      );
    }
  }

  const ref = request.nextUrl.searchParams.get('ref');
  if (!ref) {
    return NextResponse.next();
  }

  // Trim + cap length so a malicious URL can't blow up the cookie.
  const trimmed = ref.trim().slice(0, 64);
  if (!trimmed) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set({
    name: REF_COOKIE_NAME,
    value: trimmed,
    path: '/',
    maxAge: REF_COOKIE_TTL_DAYS * 24 * 60 * 60,
    sameSite: 'lax',
    httpOnly: false,
  });
  return response;
}

// Run on every customer-facing route. Skip API routes (Next.js
// rewrites them to the backend), Next internals, and static
// assets — they don't carry meaningful `?ref=` URLs.
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)).*)',
  ],
};
