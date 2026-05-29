import type { Response, Request } from 'express';

/**
 * Follow-up #H40 — httpOnly auth-cookie helpers.
 *
 * Pre-Follow-up-H40 all five persona logins (customer / seller /
 * franchise / admin / affiliate) returned the access + refresh tokens
 * in the JSON body and the frontends stashed them in sessionStorage.
 * That model:
 *   • Exposes the token to any JS running in the page (every npm
 *     transitive dep, every chrome-extension content script). One
 *     compromised analytics tag → wholesale account takeover.
 *   • Adds the token to every fetch via an `Authorization: Bearer …`
 *     header, which means CORS preflights on every state-changing
 *     route — the cookie path is preflight-free for GET.
 *
 * The migration runs in two phases:
 *   1. (THIS HELPER) — login routes call `setAuthCookies` AFTER
 *      they've built the JSON response, so the cookie is set
 *      alongside the still-returned `accessToken` / `refreshToken`.
 *      Auth guards accept either source (Bearer wins). Frontends
 *      keep working unchanged.
 *   2. (FOLLOW-UP) — frontends drop sessionStorage, switch fetches
 *      to `credentials: 'include'`, and the API can stop returning
 *      tokens in the response body. That cut-over is per-frontend
 *      so the migration stays incremental.
 *
 * Cookie naming convention: `sm_access_<persona>` + `sm_refresh_<persona>`
 * so all five personas can share a browser without colliding (e.g. a
 * dev logged in as both customer and admin in the same tab).
 */

export type AuthCookiePersona =
  | 'customer'
  | 'seller'
  | 'franchise'
  | 'admin'
  | 'affiliate';

const ACCESS_COOKIE_PREFIX = 'sm_access_';
const REFRESH_COOKIE_PREFIX = 'sm_refresh_';

const ACCESS_TTL_SECONDS_DEFAULT = 60 * 60; // 1h
const REFRESH_TTL_SECONDS_DEFAULT = 30 * 24 * 60 * 60; // 30d

// Refresh-cookie path per persona — narrows the cookie to the route
// that actually consumes it. Customers historically mount at
// /api/v1/auth/refresh (no /customer/ segment); the four other
// personas use /api/v1/<persona>/auth/refresh.
const REFRESH_PATH_BY_PERSONA: Record<AuthCookiePersona, string> = {
  customer: '/api/v1/auth/refresh',
  seller: '/api/v1/seller/auth/refresh',
  franchise: '/api/v1/franchise/auth/refresh',
  admin: '/api/v1/admin/auth/refresh',
  affiliate: '/api/v1/affiliate/auth/refresh',
};

export interface SetAuthCookiesInput {
  persona: AuthCookiePersona;
  accessToken: string;
  refreshToken: string;
  /** Override access TTL (seconds). Defaults to 1h. */
  accessTtlSeconds?: number;
  /** Override refresh TTL (seconds). Defaults to 30d. */
  refreshTtlSeconds?: number;
  /**
   * Cookie domain. Production should set this to `.sportsmart.com` so
   * a browser sees the same cookie across `seller.sportsmart.com`,
   * `admin.sportsmart.com`, etc. Pass undefined / null in dev to keep
   * the cookie scoped to localhost.
   */
  domain?: string | null;
  /**
   * Whether to mark the cookies Secure. True in production / staging,
   * false in dev (localhost over HTTP). Bound by env at the call site.
   */
  secure: boolean;
}

export function accessCookieName(persona: AuthCookiePersona): string {
  return `${ACCESS_COOKIE_PREFIX}${persona}`;
}

export function refreshCookieName(persona: AuthCookiePersona): string {
  return `${REFRESH_COOKIE_PREFIX}${persona}`;
}

/**
 * Set the access + refresh tokens as httpOnly cookies on the response.
 * Idempotent — calling twice for the same persona overwrites the prior
 * cookies. Cookie max-age is in seconds (Express normalises to ms).
 *
 * SameSite=Lax keeps the cookie out of third-party iframes / cross-site
 * POSTs (the threat model for our domain) while still allowing
 * top-level navigations (the link in an order-confirmation email
 * works).
 */
export function setAuthCookies(res: Response, input: SetAuthCookiesInput): void {
  const accessTtlMs =
    (input.accessTtlSeconds ?? ACCESS_TTL_SECONDS_DEFAULT) * 1000;
  const refreshTtlMs =
    (input.refreshTtlSeconds ?? REFRESH_TTL_SECONDS_DEFAULT) * 1000;

  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: input.secure,
    domain: input.domain ?? undefined,
  };

  res.cookie(accessCookieName(input.persona), input.accessToken, {
    ...baseOptions,
    maxAge: accessTtlMs,
    path: '/',
  });
  res.cookie(refreshCookieName(input.persona), input.refreshToken, {
    ...baseOptions,
    maxAge: refreshTtlMs,
    // Refresh-token cookie is restricted to the refresh endpoint so
    // it isn't sent on every API call. Narrowing reduces the
    // exposure window in the unlikely case of a server-side log
    // leak. Customer refresh lives at /api/v1/auth/refresh; the
    // other four personas at /api/v1/<persona>/auth/refresh.
    path: REFRESH_PATH_BY_PERSONA[input.persona],
  });
}

/**
 * Clear the access + refresh cookies on logout. Express requires the
 * same path + domain + secure flag as the original `cookie(...)` call
 * to actually clear them — passing `secure: true` to clearCookie when
 * the original was set with `secure: false` makes the browser ignore
 * the Set-Cookie response in dev (Chrome treats it as a separate
 * cookie because the secure attribute is a distinguishing axis).
 *
 * @param secure  Phase 17 (2026-05-20) — mirror the Secure flag the
 *                cookie was originally set with. Defaults to true for
 *                back-compat with callers that don't supply it.
 */
export function clearAuthCookies(
  res: Response,
  persona: AuthCookiePersona,
  domain?: string | null,
  secure: boolean = true,
): void {
  const baseOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    domain: domain ?? undefined,
  };
  res.clearCookie(accessCookieName(persona), { ...baseOptions, path: '/' });
  res.clearCookie(refreshCookieName(persona), {
    ...baseOptions,
    path: REFRESH_PATH_BY_PERSONA[persona],
  });
}

/**
 * Read the access token from the parsed `req.cookies` populated by the
 * `cookie-parser` middleware wired in main.ts. Returns undefined if no
 * cookie matches; the caller falls back to the Authorization header.
 */
export function readAccessCookie(
  req: Request,
  persona: AuthCookiePersona,
): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[accessCookieName(persona)];
}

/**
 * Read the refresh token from the parsed `req.cookies`. Used by each
 * persona's POST /auth/refresh handler when the request body omits
 * `refreshToken` (i.e. the frontend has switched to cookie-only).
 */
export function readRefreshCookie(
  req: Request,
  persona: AuthCookiePersona,
): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[refreshCookieName(persona)];
}
