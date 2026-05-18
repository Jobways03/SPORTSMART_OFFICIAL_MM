import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { EventBusService } from '../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../bootstrap/scheduler/leader-elected-cron';
import { CronInstrumentationService } from '../cron-observability/cron-instrumentation.service';

/**
 * Phase 10 (2026-05-16) — Webhook DLQ sweeper.
 *
 * Outgoing webhook deliveries that exhaust their retry budget land
 * in `webhook_deliveries.status = FAILED_DEAD`. Pre-Phase-10 those
 * rows sat there forever — no one was watching, so a misconfigured
 * partner endpoint silently dropped every event sent to it.
 *
 * The sweeper runs hourly, counts newly-DEAD rows since the last
 * tick, and emits `webhook.dlq_growing` when count > threshold so
 * the OpsAlertHandler can email the platform team. We DON'T retry
 * DEAD rows automatically — exhausting the retry budget means the
 * delivery is permanently failed and a human should look at the
 * endpoint before more retries fire.
 *
 * Cohort sample: each event payload carries up to 10 sample ids so
 * ops can pull the rows directly without writing a query.
 */
@Injectable()
export class WebhookDlqSweeperCron {
  private readonly logger = new Logger(WebhookDlqSweeperCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
    private readonly instr: CronInstrumentationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (
      this.env.getString('WEBHOOK_DLQ_SWEEPER_ENABLED', 'true') !== 'true'
    ) {
      return;
    }
    await this.leader.run('webhook-dlq-sweep', 2 * 60 * 60, async () => {
      try {
        await this.instr.wrap('webhook-dlq-sweep', async () => {
          // Window = last tick interval. Anything that became DEAD
          // before the window is already captured by the previous
          // tick's alert — re-alerting would just be noise.
          const windowHours = this.env.getNumber(
            'WEBHOOK_DLQ_SWEEP_WINDOW_HOURS',
            2,
          );
          const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

          // Group by endpoint so an alert names which partner endpoint
          // is the source of the failures. A single bad endpoint
          // shouldn't trigger N alerts (one per event-name).
          const dead = await this.prisma.webhookDelivery.findMany({
            where: {
              status: 'FAILED_DEAD',
              finalizedAt: { gte: since },
            },
            select: {
              id: true,
              endpointId: true,
              eventName: true,
              attempts: true,
              lastStatusCode: true,
              finalizedAt: true,
            },
            orderBy: { finalizedAt: 'desc' },
            take: 500,
          });

          if (dead.length === 0) return { dead: 0 };

          // Aggregate by endpointId for the alert payload.
          const byEndpoint = new Map<
            string,
            {
              endpointId: string;
              count: number;
              sampleIds: string[];
              lastStatusCodes: Set<number>;
            }
          >();
          for (const row of dead) {
            const bucket =
              byEndpoint.get(row.endpointId) ??
              {
                endpointId: row.endpointId,
                count: 0,
                sampleIds: [],
                lastStatusCodes: new Set<number>(),
              };
            bucket.count++;
            if (bucket.sampleIds.length < 10) bucket.sampleIds.push(row.id);
            if (row.lastStatusCode != null) {
              bucket.lastStatusCodes.add(row.lastStatusCode);
            }
            byEndpoint.set(row.endpointId, bucket);
          }

          const threshold = this.env.getNumber(
            'WEBHOOK_DLQ_ALERT_THRESHOLD',
            5,
          );
          let alerted = 0;
          for (const bucket of byEndpoint.values()) {
            if (bucket.count < threshold) continue;
            await this.eventBus
              .publish({
                eventName: 'webhook.dlq_growing',
                aggregate: 'WebhookEndpoint',
                aggregateId: bucket.endpointId,
                occurredAt: new Date(),
                payload: {
                  endpointId: bucket.endpointId,
                  count: bucket.count,
                  threshold,
                  windowHours,
                  lastStatusCodes: Array.from(bucket.lastStatusCodes),
                  sampleIds: bucket.sampleIds,
                },
              })
              .catch((err: unknown) => {
                this.logger.warn(
                  `webhook-dlq-sweep emit failed for endpoint=${bucket.endpointId}: ${(err as Error).message}`,
                );
              });
            alerted++;
          }

          if (alerted > 0) {
            this.logger.warn(
              `[webhook-dlq-sweep] alerted on ${alerted} endpoint(s) (${dead.length} total DEAD rows in last ${windowHours}h)`,
            );
          }
          return { dead: dead.length, endpoints: byEndpoint.size, alerted };
        });
      } catch (err) {
        this.logger.error(
          `[webhook-dlq-sweep] crashed: ${(err as Error).message}`,
        );
      }
    });
  }
}
