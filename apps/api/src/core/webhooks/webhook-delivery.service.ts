import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { signPayload } from './webhook-signer';

/**
 * Phase 10 (PR 10.2) — Webhook delivery queue + retries.
 *
 * `enqueue(eventName, payload)` finds matching active endpoints and
 * inserts one PENDING webhook_deliveries row per (endpoint, event,
 * dedupeKey). The unique constraint `(endpointId, eventName,
 * dedupeKey)` makes re-enqueues idempotent.
 *
 * `attemptOne(deliveryId)` executes a single attempt (HTTP POST,
 * record outcome, schedule next retry on failure). The cron walks
 * deliveries with `nextRetryAt <= now()` and calls this.
 *
 * Retry schedule: per-endpoint when set, else
 *   30s → 2m → 10m → 1h → 6h → 24h → DEAD
 */

export const DEFAULT_RETRY_SCHEDULE_SECONDS = [
  30, 120, 600, 3600, 21600, 86400,
];

@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  /** Truncation to keep response/error bodies bounded. */
  private static readonly RESPONSE_MAX_BYTES = 4 * 1024;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enqueue deliveries for every active endpoint subscribed to
   * `eventName`. Subscription matches via wildcard (`returns.*`)
   * or exact equality. Empty `eventTypes` array = subscribe to all.
   */
  async enqueue(input: {
    eventName: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
    environment?: 'LIVE' | 'TEST';
  }): Promise<{ enqueued: number }> {
    const env = input.environment ?? 'LIVE';
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        status: 'ACTIVE',
        environment: env,
      },
    });

    let enqueued = 0;
    for (const ep of endpoints) {
      if (!matchesSubscription(ep.eventTypes, input.eventName)) continue;
      const rawBody = JSON.stringify({
        event: input.eventName,
        data: input.payload,
        dedupeKey: input.dedupeKey,
      });
      const signed = signPayload(rawBody, ep.signingSecret);
      try {
        await this.prisma.webhookDelivery.create({
          data: {
            endpointId: ep.id,
            eventName: input.eventName,
            dedupeKey: input.dedupeKey,
            payload: input.payload as Prisma.InputJsonValue,
            signature: signed.value,
            status: 'PENDING',
            nextRetryAt: new Date(),
          },
        });
        enqueued += 1;
      } catch (err) {
        // P2002 = unique violation = already enqueued. That's the
        // idempotent path; ignore.
        const code = (err as { code?: string }).code;
        if (code !== 'P2002') {
          this.logger.warn(
            `enqueue webhook delivery failed: ${(err as Error).message}`,
          );
        }
      }
    }
    return { enqueued };
  }

  /**
   * Run one attempt. Caller (cron) is responsible for picking which
   * delivery to attempt. The function takes a delivery id, performs
   * the HTTP POST, and persists the outcome.
   *
   * `httpPost` is injected so tests can drive the outcome
   * deterministically without standing up an HTTP server.
   */
  async attemptOne(
    deliveryId: string,
    httpPost: (
      url: string,
      body: string,
      signature: string,
    ) => Promise<{ status: number; body: string }>,
  ): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!delivery || delivery.status === 'SUCCEEDED' || delivery.status === 'FAILED_DEAD') {
      return;
    }

    // Mark in-progress so a parallel cron tick doesn't double-attempt.
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'IN_PROGRESS' },
    });

    const rawBody = JSON.stringify({
      event: delivery.eventName,
      data: delivery.payload,
      dedupeKey: delivery.dedupeKey,
    });

    let resStatus = 0;
    let resBody = '';
    let transportError: string | null = null;
    try {
      const out = await httpPost(
        delivery.endpoint.url,
        rawBody,
        delivery.signature,
      );
      resStatus = out.status;
      resBody = truncate(out.body, WebhookDeliveryService.RESPONSE_MAX_BYTES);
    } catch (err) {
      transportError = truncate(
        (err as Error).message ?? 'transport error',
        WebhookDeliveryService.RESPONSE_MAX_BYTES,
      );
    }

    const succeeded = resStatus >= 200 && resStatus < 300;
    const attempts = delivery.attempts + 1;

    if (succeeded) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'SUCCEEDED',
          attempts,
          lastStatusCode: resStatus,
          lastResponse: resBody,
          finalizedAt: new Date(),
          nextRetryAt: null,
        },
      });
      return;
    }

    // Failure path — schedule next retry or mark dead.
    const schedule =
      delivery.endpoint.retrySchedule.length > 0
        ? delivery.endpoint.retrySchedule
        : DEFAULT_RETRY_SCHEDULE_SECONDS;
    const dead = attempts > schedule.length;
    if (dead) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'FAILED_DEAD',
          attempts,
          lastStatusCode: resStatus,
          lastResponse: resBody,
          lastError: transportError,
          finalizedAt: new Date(),
          nextRetryAt: null,
        },
      });
      return;
    }

    const delaySeconds = schedule[attempts - 1]!;

    const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'FAILED_RETRY',
        attempts,
        lastStatusCode: resStatus,
        lastResponse: resBody,
        lastError: transportError,
        nextRetryAt,
      },
    });
  }
}

/**
 * Returns true when the endpoint subscribes to this event name.
 * Empty subscription list = subscribe to all events.
 */
export function matchesSubscription(
  eventTypes: readonly string[],
  eventName: string,
): boolean {
  if (eventTypes.length === 0) return true;
  for (const t of eventTypes) {
    if (t === eventName) return true;
    if (t.endsWith('.*') && eventName.startsWith(t.slice(0, -1))) return true;
    if (t === '*') return true;
  }
  return false;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
