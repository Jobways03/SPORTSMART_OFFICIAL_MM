import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Thin wrapper over @nestjs/event-emitter so domain code doesn't
 * import the underlying EventEmitter2 directly. Pattern matches
 * apps/api/src/bootstrap/events/event-bus.service.ts; keeping the
 * same surface here means future shipment-created / tracking-event
 * domain events can be lifted between services unchanged.
 */
export interface DomainEvent {
  /** Dotted event name, e.g. `shipment.created`. */
  readonly name: string;
  /** ISO timestamp captured at publish. */
  readonly occurredAt: string;
  /** Free-form payload — keep it serialisable. */
  readonly payload: Record<string, unknown>;
}

@Injectable()
export class EventBusService {
  constructor(private readonly emitter: EventEmitter2) {}

  publish(event: DomainEvent): void {
    this.emitter.emit(event.name, event);
  }

  /**
   * `pattern` accepts EventEmitter2 wildcards (e.g. `shipment.*`).
   * The returned disposer detaches the listener.
   */
  subscribe<T extends DomainEvent>(
    pattern: string,
    handler: (event: T) => void | Promise<void>,
  ): () => void {
    this.emitter.on(pattern, handler);
    return () => this.emitter.off(pattern, handler);
  }
}
