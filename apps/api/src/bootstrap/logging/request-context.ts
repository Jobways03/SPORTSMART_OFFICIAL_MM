import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Phase 11 (2026-05-16) — Request-scoped context propagated through
 * async boundaries via Node's AsyncLocalStorage.
 *
 * Pre-Phase-11 the request id was attached to `req.id` only. That
 * works for synchronous code with a reference to `req`, but every
 * downstream caller (services, repositories, event handlers fired
 * via the in-process bus) lost the correlation: their log lines
 * showed no request id, and tracing a payment-callback -> stock
 * release -> notification email chain meant grepping by user id +
 * timestamp.
 *
 * AsyncLocalStorage is the right primitive here: Node propagates the
 * store across `await`, `setImmediate`, `setTimeout`, and `process.
 * nextTick`. We populate it in the request-logging middleware and
 * read it everywhere else — the logger auto-prefixes log lines, and
 * the exception filter uses it as a fallback when `req.id` is not
 * available (e.g. crashes inside async event handlers).
 *
 * NestJS event handlers triggered by `@OnEvent('foo')` run inside
 * the EventEmitter2 emit call stack, so the AsyncLocalStorage store
 * STILL propagates as long as the publisher runs `eventBus.publish`
 * inside the request context. The OutboxPublisher runs OUTSIDE any
 * request context — its log lines correctly show no request id.
 */

export interface RequestContext {
  /** Stable per-request id from `x-request-id` or generated UUID. */
  requestId: string;
  /** Optional actor id (customer / seller / admin) if the request was authenticated. */
  actorId?: string;
  /** Optional actor type label. */
  actorType?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export class RequestContextService {
  /** Run `fn` with the given context bound to the async chain. */
  static run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  }

  /** Read the current context if any. Returns null outside any request. */
  static current(): RequestContext | null {
    return storage.getStore() ?? null;
  }

  /** Convenience — current request id or null. */
  static requestId(): string | null {
    return storage.getStore()?.requestId ?? null;
  }
}
