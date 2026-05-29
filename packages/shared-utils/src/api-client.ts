/**
 * Shared API client factory. Originally written for the six Next.js apps
 * (each owns its own `src/lib/api-client.ts` that calls `createApiClient`
 * with actor-specific token keys + refresh endpoint). Now also consumed by
 * `apps/mobile-storefront` via a Keychain-backed `TokenStorage` adapter.
 *
 * The client handles: single-flight refresh on 401 (so a burst of parallel
 * 401s share one refresh call), an automatic retry after successful refresh,
 * and a fallback "clear session + escalate" when refresh fails. Token
 * storage and the post-failure escalation are pluggable so the same code
 * works in a browser (sessionStorage + window.location redirect) and in
 * React Native (Keychain + navigation.reset).
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

/**
 * Pluggable token storage. Methods may be sync or async — the client
 * always awaits them. Web injects a sessionStorage adapter; React Native
 * injects a Keychain/SecureStore adapter.
 */
export interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface ApiClientConfig {
  /** Storage key for the short-lived access token. */
  accessTokenKey: string;
  /** Storage key for the refresh token. */
  refreshTokenKey: string;
  /** Storage key for the actor profile payload (cleared on logout). */
  userKey: string;
  /** Path (relative to `/api/v1`) of the refresh endpoint for this actor. */
  refreshPath: string;
  /** Where to redirect after session expiry. Defaults to `/login`. Web only. */
  loginPath?: string;
  /**
   * Storage adapter. Defaults to a sessionStorage-backed adapter that
   * preserves the original web behavior exactly. Pass a Keychain adapter
   * on mobile.
   */
  storage?: TokenStorage;
  /**
   * Called after tokens are cleared when auth fails irrecoverably (refresh
   * failed or returned 401). Defaults to `window.location.href = loginPath`
   * in a browser. Mobile passes a navigation reset.
   */
  onAuthFailure?: () => void;
  /** Override the API base URL. Default reads NEXT_PUBLIC_API_URL or falls back. */
  apiBaseUrl?: string;
}

export interface ApiClient {
  apiClient: <T = unknown>(
    endpoint: string,
    options?: RequestInit,
  ) => Promise<ApiResponse<T>>;
  API_BASE: string;
}

function resolveApiBase(override?: string): string {
  // Honour empty-string explicitly — `''` means "use relative URLs"
  // (caller wants requests to stay same-origin, e.g. the mobile-
  // storefront web build that routes through Vite's /api proxy).
  // `undefined` falls through to env / default lookup.
  if (override !== undefined) return override;
  const v =
    typeof process !== 'undefined' && process.env
      ? process.env.NEXT_PUBLIC_API_URL
      : undefined;
  if (v) return v;
  if (
    typeof process !== 'undefined' &&
    process.env &&
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be set in production — refusing to default to localhost.',
    );
  }
  return 'http://localhost:8000';
}

/**
 * Default storage adapter — sessionStorage on web, no-op on SSR / RN.
 * Preserves the original behavior of the client before storage was pluggable.
 */
function createSessionStorageAdapter(): TokenStorage {
  return {
    getItem(key) {
      if (typeof window === 'undefined') return null;
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      if (typeof window === 'undefined') return;
      try {
        sessionStorage.setItem(key, value);
      } catch {
        // ignore quota / privacy-mode errors
      }
    },
    removeItem(key) {
      if (typeof window === 'undefined') return;
      try {
        sessionStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const API_BASE = resolveApiBase(config.apiBaseUrl);
  const loginPath = config.loginPath ?? '/login';
  const storage = config.storage ?? createSessionStorageAdapter();

  const defaultAuthFailure = (): void => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname !== loginPath) {
      window.location.href = loginPath;
    }
  };
  const onAuthFailure = config.onAuthFailure ?? defaultAuthFailure;

  const getAccessToken = async (): Promise<string | null> => {
    try {
      return await storage.getItem(config.accessTokenKey);
    } catch {
      return null;
    }
  };

  const clearTokensAndNotify = async (): Promise<void> => {
    try {
      await Promise.all([
        storage.removeItem(config.accessTokenKey),
        storage.removeItem(config.refreshTokenKey),
        storage.removeItem(config.userKey),
      ]);
    } catch {
      // ignore — escalate anyway
    }
    onAuthFailure();
  };

  // Single in-flight refresh promise so concurrent 401s share the same attempt.
  let refreshPromise: Promise<boolean> | null = null;

  const tryRefreshToken = async (): Promise<boolean> => {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      let refreshToken: string | null = null;
      try {
        refreshToken = await storage.getItem(config.refreshTokenKey);
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
        await storage.setItem(config.accessTokenKey, data.accessToken);
        await storage.setItem(config.refreshTokenKey, data.refreshToken);
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
    const token = await getAccessToken();

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
      // The Nest GlobalExceptionFilter always wraps `message` in an array,
      // but every caller expects a string. Flatten it here so consumers
      // don't silently render `[object Object]` or fall back to generic copy.
      if (Array.isArray((body as { message?: unknown }).message)) {
        const arr = (body as unknown as { message: unknown[] }).message;
        (body as { message: string }).message = arr
          .map((m) => (typeof m === 'string' ? m : JSON.stringify(m)))
          .join('; ');
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
        await clearTokensAndNotify();
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
