/**
 * Shared API client factory for the six Next.js apps. Each app owns its own
 * `src/lib/api-client.ts` that calls `createApiClient({...})` with its
 * actor-specific token keys and refresh endpoint, then re-exports the
 * resulting `apiClient` function. The 64+ consumers per app import from
 * `@/lib/api-client` as before — only the implementation moved.
 *
 * The client handles: single-flight refresh on 401 (so a burst of parallel
 * 401s share one refresh call), an automatic retry after successful refresh,
 * and a fallback "clear session + redirect to login" when refresh fails.
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: Array<{ field: string; message: string }>;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiResponse,
  ) {
    super(body.message || 'Request failed');
  }
}

export interface ApiClientConfig {
  /** sessionStorage key for the short-lived access token. */
  accessTokenKey: string;
  /** sessionStorage key for the refresh token. */
  refreshTokenKey: string;
  /** sessionStorage key for the actor profile payload (cleared on logout). */
  userKey: string;
  /** Path (relative to `/api/v1`) of the refresh endpoint for this actor. */
  refreshPath: string;
  /** Where to redirect after session expiry. Defaults to `/login`. */
  loginPath?: string;
}

export interface ApiClient {
  apiClient: <T = unknown>(
    endpoint: string,
    options?: RequestInit,
  ) => Promise<ApiResponse<T>>;
  API_BASE: string;
}

function resolveApiBase(): string {
  const v = process.env.NEXT_PUBLIC_API_URL;
  if (v) return v;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be set in production — refusing to default to localhost.',
    );
  }
  return 'http://localhost:4000';
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const API_BASE = resolveApiBase();
  const loginPath = config.loginPath ?? '/login';

  const getAccessToken = (): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      return sessionStorage.getItem(config.accessTokenKey);
    } catch {
      return null;
    }
  };

  const clearTokensAndRedirect = (): void => {
    if (typeof window === 'undefined') return;
    try {
      sessionStorage.removeItem(config.accessTokenKey);
      sessionStorage.removeItem(config.refreshTokenKey);
      sessionStorage.removeItem(config.userKey);
    } catch {
      // ignore
    }
    if (window.location.pathname !== loginPath) {
      window.location.href = loginPath;
    }
  };

  // Single in-flight refresh promise so concurrent 401s share the same attempt.
  let refreshPromise: Promise<boolean> | null = null;

  const tryRefreshToken = async (): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      let refreshToken: string | null = null;
      try {
        refreshToken = sessionStorage.getItem(config.refreshTokenKey);
      } catch {
        return false;
      }
      if (!refreshToken) return false;

      // Hard cap on the refresh call so a hung /auth/refresh never wedges
      // every downstream request in the app.
      const refreshAbort = new AbortController();
      const refreshTimer = setTimeout(() => refreshAbort.abort(), 20_000);
      try {
        const res = await fetch(`${API_BASE}/api/v1/${config.refreshPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          signal: refreshAbort.signal,
        });
        if (!res.ok) return false;
        const body = await res.json();
        const data = body?.data;
        if (!data?.accessToken || !data?.refreshToken) return false;
        sessionStorage.setItem(config.accessTokenKey, data.accessToken);
        sessionStorage.setItem(config.refreshTokenKey, data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(refreshTimer);
      }
    })();

    try {
      return await refreshPromise;
    } finally {
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  };

  const DEFAULT_TIMEOUT_MS = 60_000;

  // Combine the caller's AbortSignal (if any) with a timeout-driven one so
  // a hung request can't block the UI indefinitely. Falls back to a plain
  // timeout signal when no caller signal was provided.
  const buildSignal = (userSignal: AbortSignal | null | undefined): {
    signal: AbortSignal;
    cleanup: () => void;
  } => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
    };
    const onUserAbort = () => controller.abort();
    if (userSignal) {
      if (userSignal.aborted) controller.abort();
      else userSignal.addEventListener('abort', onUserAbort, { once: true });
    }
    return { signal: controller.signal, cleanup };
  };

  const makeRequest = async <T>(
    url: string,
    options: RequestInit,
  ): Promise<{ ok: boolean; status: number; body: ApiResponse<T> }> => {
    const { headers: optionHeaders, body: requestBody, signal: userSignal, ...restOptions } =
      options;
    const token = getAccessToken();

    // Only force JSON content-type when the body isn't a FormData payload —
    // browsers must set their own multipart boundary for FormData uploads.
    const isFormData =
      typeof FormData !== 'undefined' && requestBody instanceof FormData;

    const headers: Record<string, string> = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(optionHeaders as Record<string, string>),
    };

    const { signal, cleanup } = buildSignal(userSignal);
    try {
      const response = await fetch(url, {
        ...restOptions,
        body: requestBody,
        headers,
        signal,
      });
      let body: ApiResponse<T>;
      try {
        body = await response.json();
      } catch {
        // Non-JSON error response (gateway HTML, timeout text, etc.) —
        // synthesize a typed envelope so callers always get a uniform shape.
        body = {
          success: false,
          message: `Request failed with status ${response.status}`,
        } as ApiResponse<T>;
      }
      return { ok: response.ok, status: response.status, body };
    } finally {
      cleanup();
    }
  };

  const apiClient = async <T = unknown>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<ApiResponse<T>> => {
    const url = `${API_BASE}/api/v1${endpoint}`;

    let attempt = await makeRequest<T>(url, options);

    if (attempt.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        attempt = await makeRequest<T>(url, options);
      }
      if (attempt.status === 401) {
        clearTokensAndRedirect();
        throw new ApiError(attempt.status, attempt.body);
      }
    }

    if (!attempt.ok) {
      throw new ApiError(attempt.status, attempt.body);
    }

    return attempt.body;
  };

  return { apiClient, API_BASE };
}
