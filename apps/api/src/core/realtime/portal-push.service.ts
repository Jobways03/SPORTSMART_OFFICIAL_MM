import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Response } from 'express';

/**
 * Phase 9 (PR 9.1) — Server-Sent Events push to portal viewers.
 *
 * Why SSE and not WebSocket:
 *   - One-way (server→client) is exactly what the portal needs.
 *     Updates flow when the case state changes; the portal doesn't
 *     send anything back over the same channel.
 *   - Plain HTTP. No new infrastructure, traverses our existing
 *     reverse proxies and CORS config without changes.
 *   - Automatic reconnect built into EventSource. No client-side
 *     ping/pong loop.
 *   - One backend does both polling clients (HTTP) and live clients
 *     (SSE) on the same routes; clients pick by `Accept` header or
 *     by hitting `/stream` vs `/list`.
 *
 * Subscriber model:
 *   Each connected viewer declares a `scope`:
 *     - `{ kind: 'customer-case', customerId, resourceType?, resourceId? }`
 *       — buyer watching their own returns/disputes/tickets
 *     - `{ kind: 'admin-queue' }`
 *       — admin dashboard with all-queue overview
 *     - `{ kind: 'seller-disputes', sellerId }`
 *       — seller-portal dispute list
 *
 * The service owns:
 *   - subscriber registry (Map<id, subscriber>)
 *   - event-bus listeners that fan out to matching subscribers
 *   - SSE-formatted writes to each subscriber's response stream
 *
 * Event filtering happens AT the subscriber, not at the listener,
 * because filtering is per-actor-scope: the same event might fan to
 * an admin (full payload) and a customer (redacted payload).
 */

export type SubscriberScope =
  | { kind: 'customer-case'; customerId: string; resourceType?: string; resourceId?: string }
  | { kind: 'admin-queue' }
  | { kind: 'seller-disputes'; sellerId: string };

export interface Subscriber {
  id: string;
  scope: SubscriberScope;
  res: Response;
  /** Wall-clock time the connection was opened. Drives keepalive cron. */
  connectedAt: Date;
}

interface BroadcastableEvent {
  eventName: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

@Injectable()
export class PortalPushService implements OnModuleDestroy {
  private readonly logger = new Logger(PortalPushService.name);
  private readonly subscribers = new Map<string, Subscriber>();

  /** Periodically write a comment line to keep proxies from idling out. */
  private static readonly KEEPALIVE_MS = 25_000;
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.keepaliveTimer = setInterval(
      () => this.broadcastKeepalive(),
      PortalPushService.KEEPALIVE_MS,
    );
    this.keepaliveTimer.unref?.();
  }

  /**
   * Register a viewer + return a teardown function. The caller's
   * controller invokes this AFTER setting SSE headers on the response.
   */
  register(subscriber: Subscriber): () => void {
    this.subscribers.set(subscriber.id, subscriber);
    // Initial hello frame so EventSource emits an `open` event.
    this.writeFrame(subscriber, 'ready', { id: subscriber.id });
    return () => {
      this.subscribers.delete(subscriber.id);
    };
  }

  /**
   * Test-only / non-event-bus broadcast helper. Call sites should
   * prefer the event bus; this is exposed so unit tests can drive
   * the fanout without standing up an EventEmitter.
   */
  broadcast(eventName: string, evt: BroadcastableEvent): void {
    for (const sub of this.subscribers.values()) {
      if (this.matches(sub, eventName, evt)) {
        this.writeFrame(sub, eventName, evt.payload);
      }
    }
  }

  // ── Event-bus listeners ───────────────────────────────────────

  @OnEvent('returns.return.*')
  onReturnEvent(evt: BroadcastableEvent) {
    this.broadcast(evt.eventName, evt);
  }

  @OnEvent('disputes.*')
  onDisputeEvent(evt: BroadcastableEvent) {
    this.broadcast(evt.eventName, evt);
  }

  @OnEvent('support.ticket.*')
  onTicketEvent(evt: BroadcastableEvent) {
    this.broadcast(evt.eventName, evt);
  }

  @OnEvent('sla.*')
  onSlaEvent(evt: BroadcastableEvent) {
    this.broadcast(evt.eventName, evt);
  }

  // ── Internals ──────────────────────────────────────────────────

  private matches(
    sub: Subscriber,
    eventName: string,
    evt: BroadcastableEvent,
  ): boolean {
    switch (sub.scope.kind) {
      case 'admin-queue':
        // Admin queue receives every domain event by design.
        return true;
      case 'customer-case': {
        const customerId = (evt.payload['customerId'] ?? evt.payload['filedById']) as string | undefined;
        if (sub.scope.customerId !== customerId) return false;
        if (sub.scope.resourceId) {
          // Filter to a single case if scope narrows to it.
          const candidates = [
            evt.payload['returnId'],
            evt.payload['disputeId'],
            evt.payload['ticketId'],
            evt.aggregateId,
          ];
          if (!candidates.includes(sub.scope.resourceId)) return false;
        }
        return true;
      }
      case 'seller-disputes': {
        const sellerId = evt.payload['sellerId'] as string | undefined;
        return sellerId === sub.scope.sellerId;
      }
      default:
        return false;
    }
  }

  private writeFrame(
    sub: Subscriber,
    eventName: string,
    data: unknown,
  ): void {
    try {
      const lines = [
        `event: ${eventName}`,
        `data: ${JSON.stringify(data)}`,
        '',
        '',
      ].join('\n');
      sub.res.write(lines);
    } catch (err) {
      // Connection died; reap the subscriber. Re-throwing would
      // propagate into the EventEmitter and could disrupt other
      // listeners.
      this.logger.warn(
        `SSE write failed for sub ${sub.id}: ${(err as Error).message}`,
      );
      this.subscribers.delete(sub.id);
    }
  }

  private broadcastKeepalive(): void {
    for (const sub of this.subscribers.values()) {
      try {
        // SSE comment line. EventSource ignores it but proxies see
        // bytes flowing.
        sub.res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {
        this.subscribers.delete(sub.id);
      }
    }
  }

  /** Test introspection. */
  subscriberCount(): number {
    return this.subscribers.size;
  }

  onModuleDestroy(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const sub of this.subscribers.values()) {
      try {
        sub.res.end();
      } catch {
        // ignore
      }
    }
    this.subscribers.clear();
  }
}
