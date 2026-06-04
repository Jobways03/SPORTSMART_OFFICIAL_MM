import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped context propagated through async boundaries via
 * Node's AsyncLocalStorage. Same pattern as apps/api's
 * request-context.ts — the request-logging middleware populates the
 * store, the logger reads from it to prefix log lines, and the
 * exception filter falls back to it when `req.id` isn't available
 * (e.g. crashes inside async event handlers).
 */
export interface RequestContext {
  /** Stable per-request id from `x-request-id` or generated UUID. */
  requestId: string;
  /** Authenticated API-key id when present. */
  apiKeyId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export class RequestContextService {
  static run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  static current(): RequestContext | null {
    return storage.getStore() ?? null;
  }

  static requestId(): string | undefined {
    return storage.getStore()?.requestId;
  }
}
