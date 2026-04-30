/**
 * Affiliate-portal API helper. Pulls the JWT from sessionStorage
 * (where login.tsx puts it under `affiliateToken`), attaches it to
 * every request, and on 401 wipes the session and redirects to
 * /login. Every page in this app talks to the API through here.
 *
 * Single-token model: unlike seller/franchise/customer portals (which
 * use access + refresh-token rotation), affiliate JWTs are issued for
 * the full session and are not refreshed. A 401 always means re-auth.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('affiliateToken');
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('affiliateToken');
  sessionStorage.removeItem('affiliateProfile');
}

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  // Don't force JSON Content-Type for FormData — the browser must set
  // multipart/form-data with its own boundary or the request body
  // becomes unparseable on the server.
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !headers['Content-Type'] && !isFormData) {
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
  // Standard SportsMart envelope is `{ success, data }` — unwrap when present
  // so callers work with the payload directly.
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
