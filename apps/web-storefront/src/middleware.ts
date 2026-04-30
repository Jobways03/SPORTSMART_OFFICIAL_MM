import { NextRequest, NextResponse } from 'next/server';

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

export function middleware(request: NextRequest) {
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
