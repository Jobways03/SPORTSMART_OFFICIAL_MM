import {
  Injectable,
  Logger,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { RedisService } from '../../bootstrap/cache/redis.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { MetricsRegistry } from '../metrics/metrics.registry';
import { AuditPublicFacade } from '../../modules/audit/application/facades/audit-public.facade';
import {
  SubscriberScope,
  ResolvedAudience,
  familyOf,
  familyAllowedForScope,
  isInternalOnly,
  normalizeType,
  buildPayloadFor,
  resourceIdOf,
} from './portal-sse.types';

/**
 * Phase 9 (PR 9.1) — Server-Sent Events push to portal viewers.
 *
 * Hardened (Portal-SSE audit): subscriber registry with per-actor
 * connection caps + backpressure; central audience resolution (payload +
 * cached DB lookup) so events that omit customerId/sellerId still route
 * correctly; per-scope event-family allowlist + payload redaction (no PII
 * / financials / internal notes leak to customers/sellers, no firehose to
 * admins); a Redis pub/sub bridge so fan-out works across API replicas;
 * stable `id:` lines + outbox-backed Last-Event-Id replay; heartbeat
 * frames, audit on open/close, and a subscriber-count gauge.
 */
export interface Subscriber {
  id: string;
  scope: SubscriberScope;
  /** Stable per-actor key for the connection cap. */
  actorKey: string;
  /** Actor id for audit. */
  actorId: string;
  actorType: string;
  res: Response;
  connectedAt: Date;
  /** Consecutive failed (un-drained) writes; drop the slow client past N. */
  failedWrites: number;
}

interface BroadcastableEvent {
  eventName: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

const REDIS_CHANNEL = 'portal:sse:events';

@Injectable()
export class PortalPushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PortalPushService.name);
  private readonly subscribers = new Map<string, Subscriber>();
  /** actorKey -> set of subscriber ids, for per-actor connection caps. */
  private readonly byActor = new Map<string, Set<string>>();

  private static readonly KEEPALIVE_MS = 25_000;
  /** Drop a subscriber after this many consecutive un-drained writes. */
  private static readonly MAX_FAILED_WRITES = 50;
  /** Bound a reconnect replay so a long gap can't dump the whole outbox. */
  private static readonly REPLAY_LIMIT = 200;

  private keepaliveTimer: NodeJS.Timeout | null = null;

  // Redis pub/sub bridge (multi-replica fan-out). Inactive in dev/test or
  // when Redis isn't reachable — falls back to direct local fan-out.
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private bridgeActive = false;

  private readonly subscriberGauge: ReturnType<MetricsRegistry['gauge']> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    @Optional() private readonly metrics?: MetricsRegistry,
    @Optional() private readonly audit?: AuditPublicFacade,
  ) {
    this.subscriberGauge = this.metrics?.gauge(
      'portal_sse_subscribers',
      'Active portal SSE subscriber connections, by scope kind.',
    );
    this.keepaliveTimer = setInterval(
      () => this.broadcastHeartbeat(),
      PortalPushService.KEEPALIVE_MS,
    );
    this.keepaliveTimer.unref?.();
  }

  async onModuleInit(): Promise<void> {
    // Stand up the Redis bridge so events published on one replica reach
    // subscribers on every replica. A dedicated SUBSCRIBE connection
    // (ioredis requires a separate connection for subscriber mode).
    try {
      const client = this.redis.getClient?.();
      if (!client) return;
      this.pubClient = client;
      this.subClient = client.duplicate();
      this.subClient.on('message', (channel: string, message: string) => {
        if (channel === REDIS_CHANNEL) void this.onRedisMessage(message);
      });
      this.subClient.on('error', (e: Error) =>
        this.logger.warn(`Portal SSE Redis subscriber error: ${e.message}`),
      );
      // Re-arm on every (re)connect rather than resolving the bridge ONCE.
      // ioredis emits 'ready' on the initial connect AND after each reconnect,
      // so if Redis is unreachable at boot (e.g. mid-failover) the bridge is no
      // longer latched OFF forever — this replica rejoins multi-replica fan-out
      // the moment Redis recovers. SUBSCRIBE is idempotent, so re-issuing it on
      // a reconnect (ioredis also auto-resubscribes) is harmless.
      this.subClient.on('ready', () => {
        this.subClient
          ?.subscribe(REDIS_CHANNEL)
          .then(() => {
            if (!this.bridgeActive) {
              this.bridgeActive = true;
              this.logger.log(
                'Portal SSE Redis bridge active (multi-replica fan-out)',
              );
            }
          })
          .catch((e: Error) =>
            this.logger.warn(
              `Portal SSE bridge subscribe failed: ${e.message}`,
            ),
          );
      });
      // On a (transient) disconnect, mark the bridge inactive so publishes
      // degrade to local fan-out IMMEDIATELY rather than paying the per-command
      // timeout against a dead socket. 'ready' re-arms it on reconnect.
      this.subClient.on('close', () => {
        this.bridgeActive = false;
      });
    } catch (e) {
      this.bridgeActive = false;
      this.logger.warn(
        `Portal SSE Redis bridge unavailable — local fan-out only: ${(e as Error).message}`,
      );
    }
  }

  // ── Registration ────────────────────────────────────────────────

  /**
   * Register a viewer; returns a teardown function. Enforces the
   * per-actor connection cap (evicts the oldest), writes the `ready`
   * frame, replays any events missed since `lastEventId`, and records
   * the open in the audit log + subscriber gauge.
   */
  register(
    subscriber: Subscriber,
    opts?: { lastEventId?: string },
  ): () => void {
    this.enforceConnectionCap(subscriber);

    this.subscribers.set(subscriber.id, subscriber);
    let set = this.byActor.get(subscriber.actorKey);
    if (!set) {
      set = new Set();
      this.byActor.set(subscriber.actorKey, set);
    }
    set.add(subscriber.id);
    this.subscriberGauge?.inc({ scope: subscriber.scope.kind });

    this.writeFrame(subscriber, 'READY', { id: subscriber.id }, undefined);

    if (opts?.lastEventId) {
      void this.replayMissed(subscriber, opts.lastEventId);
    }

    void this.audit
      ?.writeAuditLog({
        actorId: subscriber.actorId,
        actorType: subscriber.actorType,
        action: 'portal.stream.opened',
        module: 'realtime',
        resource: 'portal_stream',
        resourceId: subscriber.scope.kind,
        newValue: { subscriberId: subscriber.id },
      })
      .catch(() => undefined);

    return () => this.unregister(subscriber.id);
  }

  private unregister(id: string): void {
    const sub = this.subscribers.get(id);
    if (!sub) return;
    this.subscribers.delete(id);
    const set = this.byActor.get(sub.actorKey);
    if (set) {
      set.delete(id);
      if (set.size === 0) this.byActor.delete(sub.actorKey);
    }
    this.subscriberGauge?.dec({ scope: sub.scope.kind });
    void this.audit
      ?.writeAuditLog({
        actorId: sub.actorId,
        actorType: sub.actorType,
        action: 'portal.stream.closed',
        module: 'realtime',
        resource: 'portal_stream',
        resourceId: sub.scope.kind,
        newValue: { subscriberId: id },
      })
      .catch(() => undefined);
  }

  /** Cap connections per actor; evict the oldest when at the limit. */
  private enforceConnectionCap(subscriber: Subscriber): void {
    const cap =
      subscriber.scope.kind === 'admin-queue'
        ? this.env.getNumber('PORTAL_SSE_MAX_CONN_PER_ADMIN', 3)
        : this.env.getNumber('PORTAL_SSE_MAX_CONN_PER_ACTOR', 5);
    const set = this.byActor.get(subscriber.actorKey);
    if (!set) return;
    while (set.size >= cap) {
      const oldestId = set.values().next().value as string | undefined;
      if (!oldestId) break;
      const oldest = this.subscribers.get(oldestId);
      this.subscribers.delete(oldestId);
      set.delete(oldestId);
      if (oldest) {
        this.subscriberGauge?.dec({ scope: oldest.scope.kind });
        try {
          oldest.res.write('event: evicted\ndata: {"reason":"connection_cap"}\n\n');
          oldest.res.end();
        } catch {
          // already gone
        }
      }
    }
  }

  // ── Event-bus listeners ───────────────────────────────────────────

  @OnEvent('returns.return.*')
  onReturnEvent(evt: BroadcastableEvent) {
    return this.handleDomainEvent(evt);
  }

  @OnEvent('disputes.*')
  onDisputeEvent(evt: BroadcastableEvent) {
    return this.handleDomainEvent(evt);
  }

  // FIX: publishers emit `tickets.*`, not `support.ticket.*` — the old
  // wildcard matched nothing, so the entire ticket stream was dead.
  @OnEvent('tickets.*')
  onTicketEvent(evt: BroadcastableEvent) {
    return this.handleDomainEvent(evt);
  }

  @OnEvent('sla.*')
  onSlaEvent(evt: BroadcastableEvent) {
    return this.handleDomainEvent(evt);
  }

  // Affiliate earnings/payout lifecycle (commission confirmed/reversed,
  // payout requested/approved/paid/failed). Scoped to commission.* /
  // payout.* so affiliate auth/account/coupon events never stream.
  @OnEvent('affiliate.commission.*')
  onAffiliateCommissionEvent(evt: BroadcastableEvent) {
    return this.handleDomainEvent(evt);
  }

  @OnEvent('affiliate.payout.*')
  onAffiliatePayoutEvent(evt: BroadcastableEvent) {
    return this.handleDomainEvent(evt);
  }

  /**
   * When the Redis bridge is active, publish to the channel and let the
   * subscriber (on every replica, including this one) do the fan-out — so
   * a single fan-out path serves all replicas. Otherwise fan out locally.
   */
  private async handleDomainEvent(evt: BroadcastableEvent): Promise<void> {
    if (!familyOf(evt.eventName)) return;
    if (this.bridgeActive && this.pubClient) {
      try {
        await this.pubClient.publish(
          REDIS_CHANNEL,
          JSON.stringify({
            eventName: evt.eventName,
            aggregateId: evt.aggregateId,
            payload: evt.payload,
            occurredAt: evt.occurredAt,
          }),
        );
        return;
      } catch (e) {
        this.logger.warn(
          `Portal SSE Redis publish failed, falling back to local: ${(e as Error).message}`,
        );
      }
    }
    await this.broadcastEvent(evt);
  }

  private async onRedisMessage(message: string): Promise<void> {
    try {
      const raw = JSON.parse(message) as BroadcastableEvent & { occurredAt: string };
      await this.broadcastEvent({
        eventName: raw.eventName,
        aggregateId: raw.aggregateId,
        payload: raw.payload ?? {},
        occurredAt: new Date(raw.occurredAt),
      });
    } catch (e) {
      this.logger.warn(`Portal SSE bad Redis message: ${(e as Error).message}`);
    }
  }

  /**
   * Public for tests: resolve the audience ONCE, then fan to every local
   * subscriber whose scope is allowed + matches.
   */
  async broadcastEvent(evt: BroadcastableEvent): Promise<void> {
    if (this.subscribers.size === 0) return;
    const family = familyOf(evt.eventName);
    if (!family) return;
    const audience = await this.resolveAudience(evt);
    const evtResourceId = resourceIdOf(evt.payload, evt.aggregateId);
    const eventId =
      typeof evt.payload['eventId'] === 'string'
        ? (evt.payload['eventId'] as string)
        : undefined;
    for (const sub of this.subscribers.values()) {
      if (!this.matchesScope(sub, evt.eventName, family, audience, evtResourceId)) continue;
      const data = buildPayloadFor(sub.scope.kind, evt.eventName, evt.payload, evt.aggregateId);
      this.writeFrame(sub, normalizeType(evt.eventName), data, eventId);
    }
  }

  /** Back-compat shim used by older tests. */
  broadcast(eventName: string, evt: BroadcastableEvent): void {
    void this.broadcastEvent({ ...evt, eventName });
  }

  // ── Matching + audience resolution ────────────────────────────────

  private matchesScope(
    sub: Subscriber,
    eventName: string,
    family: ReturnType<typeof familyOf>,
    audience: ResolvedAudience,
    evtResourceId: string,
  ): boolean {
    if (!family) return false;
    if (!familyAllowedForScope(sub.scope.kind, family)) return false;

    switch (sub.scope.kind) {
      case 'admin-queue': {
        // Optional opt-in queue filter (?queues=returns,disputes).
        if (sub.scope.queues && !sub.scope.queues.includes(family)) return false;
        return true;
      }
      case 'customer-case': {
        if (isInternalOnly(eventName)) return false;
        if (audience.customerId !== sub.scope.customerId) return false;
        // Narrowed to a single case: ownership of that resource was
        // verified at subscribe time, so an id match is sufficient here.
        if (sub.scope.resourceId && evtResourceId !== sub.scope.resourceId) return false;
        return true;
      }
      case 'seller-disputes': {
        if (isInternalOnly(eventName)) return false;
        return audience.sellerId === sub.scope.sellerId;
      }
      case 'franchise-cases': {
        if (isInternalOnly(eventName)) return false;
        return audience.franchiseId === sub.scope.franchiseId;
      }
      case 'affiliate-earnings': {
        return audience.affiliateId === sub.scope.affiliateId;
      }
      default:
        return false;
    }
  }

  /**
   * Resolve the owners of the aggregate an event touches.
   *
   * Payload-first (cheap), then a cached DB fallback keyed by resource id —
   * because most return/dispute/ticket events do NOT carry customerId /
   * sellerId in their payload (so the naive payload-only matcher silently
   * dropped them). One cached lookup per resource covers every event on it.
   */
  private readonly audienceCache = new Map<
    string,
    { value: ResolvedAudience; at: number }
  >();
  private static readonly AUDIENCE_TTL_MS = 60_000;

  private async resolveAudience(evt: BroadcastableEvent): Promise<ResolvedAudience> {
    const p = evt.payload;
    const fromType = (idKey: string, typeKey: string, want: string): string | undefined => {
      const t = p[typeKey];
      return typeof t === 'string' && t.toUpperCase() === want && typeof p[idKey] === 'string'
        ? (p[idKey] as string)
        : undefined;
    };

    let customerId =
      (typeof p['customerId'] === 'string' ? (p['customerId'] as string) : undefined) ??
      fromType('filedById', 'filedByType', 'CUSTOMER') ??
      fromType('recipientId', 'recipientType', 'CUSTOMER') ??
      fromType('senderId', 'senderType', 'CUSTOMER') ??
      fromType('creatorId', 'creatorType', 'CUSTOMER');
    let sellerId =
      (typeof p['sellerId'] === 'string' ? (p['sellerId'] as string) : undefined) ??
      fromType('filedById', 'filedByType', 'SELLER') ??
      fromType('recipientId', 'recipientType', 'SELLER') ??
      fromType('creatorId', 'creatorType', 'SELLER');
    let franchiseId =
      (typeof p['franchiseId'] === 'string' ? (p['franchiseId'] as string) : undefined) ??
      (typeof p['franchiseIdSnapshot'] === 'string'
        ? (p['franchiseIdSnapshot'] as string)
        : undefined);
    let affiliateId =
      typeof p['affiliateId'] === 'string' ? (p['affiliateId'] as string) : undefined;

    // affiliate events carry affiliateId directly — no DB needed for them.
    if (evt.eventName.startsWith('affiliate.') && affiliateId) {
      return { affiliateId };
    }
    if (customerId && sellerId && franchiseId) return { customerId, sellerId, franchiseId, affiliateId };

    const dbResolved = await this.resolveFromDb(evt);
    customerId = customerId ?? dbResolved.customerId;
    sellerId = sellerId ?? dbResolved.sellerId;
    franchiseId = franchiseId ?? dbResolved.franchiseId;
    affiliateId = affiliateId ?? dbResolved.affiliateId;
    return { customerId, sellerId, franchiseId, affiliateId };
  }

  private async resolveFromDb(evt: BroadcastableEvent): Promise<ResolvedAudience> {
    const p = evt.payload;
    const returnId =
      typeof p['returnId'] === 'string' ? (p['returnId'] as string) : undefined;
    const disputeId =
      typeof p['disputeId'] === 'string' ? (p['disputeId'] as string) : undefined;
    const ticketId =
      typeof p['ticketId'] === 'string' ? (p['ticketId'] as string) : undefined;
    const commissionId =
      typeof p['commissionId'] === 'string' ? (p['commissionId'] as string) : undefined;
    const payoutRequestId =
      typeof p['payoutRequestId'] === 'string' ? (p['payoutRequestId'] as string) : undefined;

    let kind: 'return' | 'dispute' | 'ticket' | 'commission' | 'payout' | null = null;
    let id: string | undefined;
    if (evt.eventName.startsWith('returns.return.')) {
      kind = 'return';
      id = returnId ?? evt.aggregateId;
    } else if (evt.eventName.startsWith('disputes.')) {
      kind = 'dispute';
      id = disputeId ?? evt.aggregateId;
    } else if (evt.eventName.startsWith('tickets.')) {
      kind = 'ticket';
      id = ticketId ?? evt.aggregateId;
    } else if (evt.eventName.startsWith('affiliate.commission.')) {
      kind = 'commission';
      id = commissionId ?? evt.aggregateId;
    } else if (evt.eventName.startsWith('affiliate.payout.')) {
      kind = 'payout';
      id = payoutRequestId ?? evt.aggregateId;
    }
    if (!kind || !id) return {};

    const cacheKey = `${kind}:${id}`;
    const cached = this.audienceCache.get(cacheKey);
    if (cached && Date.now() - cached.at < PortalPushService.AUDIENCE_TTL_MS) {
      return cached.value;
    }

    let value: ResolvedAudience = {};
    try {
      if (kind === 'return') {
        const row = await this.prisma.return.findUnique({
          where: { id },
          select: {
            customerId: true,
            sellerIdSnapshot: true,
            franchiseIdSnapshot: true,
          },
        });
        if (row) {
          value = {
            customerId: row.customerId,
            sellerId: row.sellerIdSnapshot ?? undefined,
            franchiseId: row.franchiseIdSnapshot ?? undefined,
          };
        }
      } else if (kind === 'dispute') {
        const row = await this.prisma.dispute.findUnique({
          where: { id },
          select: {
            filedById: true,
            filedByType: true,
            subOrder: { select: { sellerId: true, franchiseId: true } },
          },
        });
        if (row) {
          value = {
            customerId: row.filedByType === 'CUSTOMER' ? row.filedById : undefined,
            sellerId:
              row.subOrder?.sellerId ??
              (row.filedByType === 'SELLER' ? row.filedById : undefined),
            franchiseId: row.subOrder?.franchiseId ?? undefined,
          };
        }
      } else if (kind === 'ticket') {
        const row = await this.prisma.ticket.findUnique({
          where: { id },
          select: { creatorId: true, creatorType: true },
        });
        if (row) {
          value = {
            customerId: row.creatorType === 'CUSTOMER' ? row.creatorId : undefined,
            sellerId: row.creatorType === 'SELLER' ? row.creatorId : undefined,
          };
        }
      } else if (kind === 'commission') {
        const row = await this.prisma.affiliateCommission.findUnique({
          where: { id },
          select: { affiliateId: true },
        });
        if (row) value = { affiliateId: row.affiliateId };
      } else if (kind === 'payout') {
        const row = await this.prisma.affiliatePayoutRequest.findUnique({
          where: { id },
          select: { affiliateId: true },
        });
        if (row) value = { affiliateId: row.affiliateId };
      }
    } catch (e) {
      this.logger.warn(`Portal SSE audience lookup failed (${cacheKey}): ${(e as Error).message}`);
    }
    this.audienceCache.set(cacheKey, { value, at: Date.now() });
    return value;
  }

  // ── Outbound writes ───────────────────────────────────────────────

  private writeFrame(
    sub: Subscriber,
    type: string,
    data: unknown,
    eventId: string | undefined,
  ): void {
    try {
      const parts: string[] = [];
      if (eventId) parts.push(`id: ${eventId}`);
      parts.push(`event: ${type}`);
      parts.push(`data: ${JSON.stringify(data)}`);
      parts.push('', '');
      const drained = sub.res.write(parts.join('\n'));
      if (drained) {
        sub.failedWrites = 0;
      } else {
        // Backpressure: the kernel buffer is full (slow client). Don't
        // buffer unboundedly in Node — count strikes and drop after N.
        sub.failedWrites += 1;
        if (sub.failedWrites >= PortalPushService.MAX_FAILED_WRITES) {
          this.logger.warn(
            `Dropping slow SSE subscriber ${sub.id} (${sub.failedWrites} un-drained writes)`,
          );
          this.dropSubscriber(sub);
        }
      }
    } catch (err) {
      this.logger.warn(`SSE write failed for sub ${sub.id}: ${(err as Error).message}`);
      this.dropSubscriber(sub);
    }
  }

  private dropSubscriber(sub: Subscriber): void {
    this.unregister(sub.id);
    try {
      sub.res.end();
    } catch {
      // already closed
    }
  }

  private broadcastHeartbeat(): void {
    const ts = Date.now();
    const maxAgeMs = this.env.getNumber('PORTAL_SSE_MAX_CONN_AGE_MIN', 15) * 60_000;
    for (const sub of this.subscribers.values()) {
      // Bound the auth-revocation window: force-close aged connections so
      // the client's EventSource reconnects and re-runs the auth guard
      // (DB session + account-active check). A suspended/logged-out actor
      // stops streaming within one max-age window.
      if (ts - sub.connectedAt.getTime() >= maxAgeMs) {
        this.dropSubscriber(sub);
        continue;
      }
      // A real `heartbeat` event (not just a comment) so the client can
      // surface a "last update Xs ago" / stale-stream indicator.
      this.writeFrame(sub, 'HEARTBEAT', { ts }, undefined);
    }
  }

  // ── Replay (Last-Event-Id) ────────────────────────────────────────

  private async replayMissed(sub: Subscriber, lastEventId: string): Promise<void> {
    try {
      const cursor = await this.prisma.outboxEvent.findUnique({
        where: { id: lastEventId },
        select: { createdAt: true },
      });
      if (!cursor) return;
      const rows = await this.prisma.outboxEvent.findMany({
        where: {
          createdAt: { gt: cursor.createdAt },
          OR: [
            { eventName: { startsWith: 'returns.return.' } },
            { eventName: { startsWith: 'disputes.' } },
            { eventName: { startsWith: 'tickets.' } },
            { eventName: { startsWith: 'sla.' } },
            { eventName: { startsWith: 'affiliate.commission.' } },
            { eventName: { startsWith: 'affiliate.payout.' } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: PortalPushService.REPLAY_LIMIT,
        select: { id: true, eventName: true, aggregateId: true, payload: true, occurredAt: true },
      });
      for (const row of rows) {
        if (!this.subscribers.has(sub.id)) return; // client left mid-replay
        const evt: BroadcastableEvent = {
          eventName: row.eventName,
          aggregateId: row.aggregateId,
          payload: (row.payload as Record<string, unknown>) ?? {},
          occurredAt: row.occurredAt,
        };
        const family = familyOf(evt.eventName);
        if (!family) continue;
        const audience = await this.resolveAudience(evt);
        const evtResourceId = resourceIdOf(evt.payload, evt.aggregateId);
        if (!this.matchesScope(sub, evt.eventName, family, audience, evtResourceId)) continue;
        const data = buildPayloadFor(sub.scope.kind, evt.eventName, evt.payload, evt.aggregateId);
        this.writeFrame(sub, normalizeType(evt.eventName), data, row.id);
      }
    } catch (e) {
      this.logger.warn(`Portal SSE replay failed for ${sub.id}: ${(e as Error).message}`);
    }
  }

  // ── Ownership (subscribe-time authorization) ──────────────────────

  /**
   * Verify a customer owns the resource they're narrowing to, at SUBSCRIBE
   * time — so `/my-cases/:resourceId` can't be used to watch someone
   * else's case (the live matcher's customerId check is defence in depth).
   * Tries return / dispute / ticket by id.
   */
  async customerOwnsResource(customerId: string, resourceId: string): Promise<boolean> {
    const [ret, dis, tkt] = await Promise.all([
      this.prisma.return
        .findUnique({ where: { id: resourceId }, select: { customerId: true } })
        .catch(() => null),
      this.prisma.dispute
        .findUnique({
          where: { id: resourceId },
          select: { filedById: true, filedByType: true },
        })
        .catch(() => null),
      this.prisma.ticket
        .findUnique({
          where: { id: resourceId },
          select: { creatorId: true, creatorType: true },
        })
        .catch(() => null),
    ]);
    if (ret && ret.customerId === customerId) return true;
    if (dis && dis.filedByType === 'CUSTOMER' && dis.filedById === customerId) return true;
    if (tkt && tkt.creatorType === 'CUSTOMER' && tkt.creatorId === customerId) return true;
    return false;
  }

  // ── Introspection / lifecycle ─────────────────────────────────────

  subscriberCount(): number {
    return this.subscribers.size;
  }

  connectionsForActor(actorKey: string): number {
    return this.byActor.get(actorKey)?.size ?? 0;
  }

  onModuleDestroy(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    try {
      void this.subClient?.unsubscribe(REDIS_CHANNEL);
      this.subClient?.disconnect();
    } catch {
      // ignore
    }
    for (const sub of this.subscribers.values()) {
      try {
        sub.res.end();
      } catch {
        // ignore
      }
    }
    this.subscribers.clear();
    this.byActor.clear();
  }
}
