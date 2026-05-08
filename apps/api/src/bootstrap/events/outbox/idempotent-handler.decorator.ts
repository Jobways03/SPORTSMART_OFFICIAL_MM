import type { DomainEvent } from '../domain-event.interface';
import type { EventDeduplicationService } from './event-deduplication.service';

/**
 * Phase 2 (PR 2.3) — declarative event-handler dedup.
 *
 * Wraps a `@OnEvent('...')` handler so it consults the
 * EventDeduplicationService before running.
 *
 * Usage:
 *
 *   @Injectable()
 *   class DisputeRefundHandler {
 *     constructor(
 *       private readonly wallet: WalletPublicFacade,
 *       protected readonly eventDedup: EventDeduplicationService,
 *     ) {}
 *
 *     @OnEvent('disputes.decided')
 *     @IdempotentHandler()
 *     async onDecided(event: DomainEvent<DecidedPayload>) {
 *       // runs at most once per (eventId, this handler)
 *     }
 *   }
 *
 * Convention: the host class MUST expose `eventDedup` as an
 * accessible property (public or protected) of type
 * EventDeduplicationService. The decorator looks it up via `this`.
 *
 * Order matters when stacking decorators: NestJS's `@OnEvent` is the
 * outer one (registers a listener), `@IdempotentHandler` is inner
 * (transforms the method body that listener calls). The example above
 * has them in the right order — `@IdempotentHandler` directly above
 * the method, `@OnEvent` above that.
 *
 * Why a decorator (and not just a one-liner inside the handler)?
 *   - Easier to spot in code review — every handler that needs dedup
 *     advertises it at the signature.
 *   - Centralised name resolution (we use `Class.method` as the
 *     handler key, so a future rename is a deliberate decision).
 *   - Trivial to write a lint rule that requires every @OnEvent on
 *     a money-moving handler to also have @IdempotentHandler.
 */
export function IdempotentHandler(opts?: {
  /**
   * Optional override for the handler name used in event_deduplication.
   * Defaults to `Class.method`. Override only if the class is renamed
   * but the dedup history must continue under the old name.
   */
  handler?: string;
}): MethodDecorator {
  return function <T>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
  ) {
    const original = descriptor.value as unknown as (
      this: { eventDedup: EventDeduplicationService },
      event: DomainEvent,
      ...rest: unknown[]
    ) => Promise<unknown>;

    if (typeof original !== 'function') {
      throw new Error(
        `@IdempotentHandler can only be applied to methods (got ${String(propertyKey)})`,
      );
    }

    const className = (target as { constructor: { name: string } }).constructor
      ?.name ?? 'AnonymousHandler';
    const handlerName =
      opts?.handler ?? `${className}.${String(propertyKey)}`;

    const wrapped = async function (
      this: { eventDedup?: EventDeduplicationService },
      event: DomainEvent,
      ...rest: unknown[]
    ): Promise<unknown> {
      // No eventDedup attached → fall through (graceful in tests that
      // instantiate the handler without DI).
      if (!this.eventDedup) {
        return original.call(
          this as { eventDedup: EventDeduplicationService },
          event,
          ...rest,
        );
      }
      const proceed = await this.eventDedup.tryConsume(event, handlerName);
      if (!proceed) return undefined;
      return original.call(
        this as { eventDedup: EventDeduplicationService },
        event,
        ...rest,
      );
    };

    descriptor.value = wrapped as unknown as T;
    return descriptor;
  };
}
