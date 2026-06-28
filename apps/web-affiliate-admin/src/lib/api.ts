/**
 * Affiliate-admin API helper. Reads the JWT from sessionStorage
 * (`adminToken`), attaches it on every request, and on 401 wipes
 * the session and redirects to /login.
 *
 * NOTE (2026-06-08): this app does NOT use the shared `createApiClient`
 * from @sportsmart/shared-utils — it has its own single-token `apiFetch`
 * (returns the unwrapped `.data`, used by ~30 call sites), whereas the
 * shared client returns the full ApiResponse envelope and uses an
 * access/refresh token pair. A full migration was judged too risky, so
 * the shared client's STEP_UP_REQUIRED recovery is reimplemented inline
 * here against the same `registerStepUpHandler` registrar — the
 * StepUpHandlerProvider plugs into it identically to the other admin apps.
 */
import type { StepUpHandler } from '@sportsmart/shared-utils';

export type { StepUpHandler };

/**
 * Step-up handler registrar (module-local mirror of shared-utils'
 * registerStepUpHandler). The shared-utils registrar feeds the shared
 * `createApiClient`, which this app does NOT use — so its own apiFetch
 * reads this local handler instead. The StepUpHandlerProvider in this app
 * calls registerStepUpHandler from here on mount / null on unmount.
 */
let stepUpHandler: StepUpHandler | null = null;

export function registerStepUpHandler(handler: StepUpHandler | null): void {
  stepUpHandler = handler;
}
/**
 * Resolve the API base. Dev fallback is fine; production with a
 * missing env would silently issue API calls against localhost from
 * each user's browser — throw at module load instead.
 */
function resolveApiBase(): string {
  const v = process.env.NEXT_PUBLIC_API_URL;
  if (v) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be set in production for web-affiliate-admin — refusing to default to localhost.',
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
  return sessionStorage.getItem('adminToken');
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('adminToken');
  sessionStorage.removeItem('adminProfile');
}

/**
 * STEP_UP_REQUIRED detection. The backend signals "this destructive route
 * needs a fresh MFA step-up" with HTTP 403 + body.code === 'STEP_UP_REQUIRED'.
 * Nest's GlobalExceptionFilter sometimes nests the structured error under
 * `.data`, so check both shapes — mirrors shared-utils' api-client.
 */
function isStepUpRequiredBody(body: any): boolean {
  if (!body || typeof body !== 'object') return false;
  if (body.code === 'STEP_UP_REQUIRED') return true;
  return body?.data?.code === 'STEP_UP_REQUIRED';
}

function extractStepUpMeta(body: any): { maxAgeMs?: number; message?: string } {
  if (!body || typeof body !== 'object') return {};
  return {
    maxAgeMs: body?.meta?.maxAgeMs ?? body?.data?.meta?.maxAgeMs,
    message: typeof body?.message === 'string' ? body.message : undefined,
  };
}

/**
 * One raw round-trip. Kept separate from apiFetch so the step-up path can
 * replay the exact same request after a successful elevation.
 */
async function rawFetch(path: string, init: RequestInit) {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { res, body };
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
// lacking the header (e.g. PATCH /admin/affiliates/:id/approve). This app does
// NOT use the shared `createApiClient` (which auto-attaches), so we mirror that
// behavior here. Injected ONCE — before the step-up replay in apiFetch — so the
// replay reuses the SAME key (that's what makes it idempotent). Explicit keys
// passed by the caller still win; non-idempotent routes ignore it.
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
  let { res, body } = await rawFetch(path, init);

  if (res.status === 401) {
    clearSession();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError(401, 'Session expired', body);
  }

  // Step-up recovery: if a destructive route 403s with STEP_UP_REQUIRED and
  // a handler is registered (StepUpHandlerProvider does so on mount), hand
  // off — the modal collects a code, POSTs /admin/mfa/step-up, and resolves
  // true on success. We then replay the original request exactly once.
  if (res.status === 403 && isStepUpRequiredBody(body) && stepUpHandler) {
    let elevated = false;
    try {
      elevated = await stepUpHandler(extractStepUpMeta(body));
    } catch {
      elevated = false;
    }
    if (elevated) {
      ({ res, body } = await rawFetch(path, init));
      if (res.status === 401) {
        clearSession();
        if (typeof window !== 'undefined') window.location.href = '/login';
        throw new ApiError(401, 'Session expired', body);
      }
    }
  }

  if (!res.ok) {
    const msg =
      (Array.isArray(body?.message) ? body.message[0] : body?.message) ||
      `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, body);
  }
  return (body && typeof body === 'object' && 'data' in body ? body.data : body) as T;
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

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
