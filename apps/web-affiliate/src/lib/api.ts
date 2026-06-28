/**
 * Affiliate-portal API helper.
 *
 * Phase 22 (2026-05-20) — Rewritten per the affiliate registration
 * audit:
 *
 *   • `credentials: 'include'` so httpOnly cookies
 *     (sm_access_affiliate / sm_refresh_affiliate) ride every request.
 *     The login response also sets these cookies; the access JWT and
 *     refresh token in cookie form are the source of truth.
 *   • Single-flight refresh on 401: a parallel burst of 401s now
 *     dedupes onto one refresh call, the original requests retry
 *     once on success. Prior code did a hard redirect to /login on
 *     the first 401, so a 1-hour access TTL meant the affiliate had
 *     to re-login hourly.
 *   • Refresh token is captured at login (Phase 22) so the legacy
 *     "single-JWT, no rotation" comment no longer applies.
 *   • Tokens still kept in sessionStorage as a fallback for envs
 *     where the cookie path is broken (different domain / dev split);
 *     fetch attaches the Bearer header iff the cookie path isn't
 *     working. New deployments rely on the cookies and can drop the
 *     sessionStorage layer once cross-origin is stable.
 */

function resolveApiBase(): string {
  const v = process.env.NEXT_PUBLIC_API_URL;
  if (v) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be set in production for web-affiliate — refusing to default to localhost.',
    );
  }
  return 'http://localhost:8000/api/v1';
}

export const API_BASE = resolveApiBase();

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('affiliateToken');
}

function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('affiliateRefreshToken');
}

export function storeTokens(input: {
  accessToken: string;
  refreshToken?: string;
}) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem('affiliateToken', input.accessToken);
  if (input.refreshToken) {
    sessionStorage.setItem('affiliateRefreshToken', input.refreshToken);
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('affiliateToken');
  sessionStorage.removeItem('affiliateRefreshToken');
  sessionStorage.removeItem('affiliateProfile');
}

/**
 * Single-flight refresh. `inFlightRefresh` ensures multiple parallel
 * 401s share one refresh call rather than each kicking off their own.
 * Resolves to true if the refresh succeeded (and new tokens are
 * stored), false otherwise.
 */
let inFlightRefresh: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;
  const refreshToken = getRefreshToken();
  inFlightRefresh = (async () => {
    try {
      const res = await fetch(`${API_BASE}/affiliate/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
      if (!res.ok) return false;
      const body = await res.json();
      const data = body?.data ?? {};
      if (data.accessToken) {
        storeTokens({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      inFlightRefresh = null;
    }
  })();
  return inFlightRefresh;
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  const isFormData =
    typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !headers['Content-Type'] && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  // Bearer is a fallback for envs where the cookie path is broken.
  // When the cookie + bearer both arrive, the API guard prefers the
  // cookie.
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
}

// Generate an idempotency key. Prefers crypto.randomUUID; falls back to a
// timestamp+random string so it never throws. Always 8–128 printable-ASCII
// chars (the backend's X-Idempotency-Key validation rule).
function genIdempotencyKey(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* fall through to the non-crypto fallback */
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

// Auto-attach an X-Idempotency-Key on mutating requests that don't already
// carry one. Backend endpoints decorated with @Idempotent REJECT mutations
// lacking the header (e.g. POST /affiliate/me/payouts). This app does NOT use
// the shared `createApiClient` (which auto-attaches), so we mirror that
// behavior here. Injected ONCE — before the 401-refresh replay in apiFetch —
// so the retry reuses the SAME key (that's what makes it idempotent). Explicit
// keys passed by the caller still win; non-idempotent routes ignore it.
function ensureIdempotencyKey(init: RequestInit): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  if (
    method !== 'POST' &&
    method !== 'PUT' &&
    method !== 'PATCH' &&
    method !== 'DELETE'
  ) {
    return init;
  }
  const existing = init.headers as Record<string, string> | undefined;
  const hasKey =
    !!existing &&
    Object.keys(existing).some((k) => k.toLowerCase() === 'x-idempotency-key');
  if (hasKey) return init;
  return {
    ...init,
    headers: { ...(existing ?? {}), 'X-Idempotency-Key': genIdempotencyKey() },
  };
}

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  init = ensureIdempotencyKey(init);
  let res = await rawFetch(path, init);

  // 401 → try refresh once. If the refresh succeeds, retry the
  // original request with the new access token. If it fails, fall
  // through to the existing clearSession + redirect.
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await rawFetch(path, init);
    }
  }

  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (res.status === 401) {
    clearSession();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError(401, 'Session expired', body);
  }
  if (!res.ok) {
    const msg =
      (Array.isArray(body?.message) ? body.message[0] : body?.message) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, body);
  }
  return (body && typeof body === 'object' && 'data' in body
    ? body.data
    : body) as T;
}

/**
 * Phase 22 (2026-05-20) — server-side logout.
 *
 * POST /affiliate/auth/logout revokes the current AffiliateSession
 * and clears the httpOnly cookies. Pass `{ all: true }` to revoke
 * every active session ("log out of all devices"). Always clears
 * the local sessionStorage afterwards — a 401 here just means the
 * access token expired in-flight; we still want the UI to go to
 * /login.
 */
export async function logout(opts?: { all?: boolean }): Promise<void> {
  try {
    const qs = opts?.all ? '?all=true' : '';
    await apiFetch(`/affiliate/auth/logout${qs}`, { method: 'POST' });
  } catch {
    // ignore — local clear runs either way.
  }
  clearSession();
}

export function formatINR(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
