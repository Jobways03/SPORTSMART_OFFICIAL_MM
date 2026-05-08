import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { EventBusService } from '../../bootstrap/events/event-bus.service';

/**
 * Phase 8 (PR 8.3) — Heartbeat-of-crons.
 *
 * Walks `cron_heartbeat_targets`, finds the latest SUCCEEDED run per
 * job, and emits `cron.silent` for any job whose silence exceeds
 * `expectedIntervalSeconds * toleranceMultiplier`.
 *
 * The event lands in the outbox; alerting takes it from there.
 * We emit one event per stale target per run; the alerting layer
 * dedupes by (jobName) within its own window.
 */
@Injectable()
export class CronHeartbeatCron {
  private readonly logger = new Logger(CronHeartbeatCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly eventBus: EventBusService,
  ) {}

  enabled(): boolean {
    return this.env.getBoolean('CRON_HEARTBEAT_ENABLED', false);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    if (!this.enabled()) return;

    let targets: Array<{
      jobName: string;
      expectedIntervalSeconds: number;
      toleranceMultiplier: number;
    }> = [];
    try {
      targets = await this.prisma.cronHeartbeatTarget.findMany({
        where: { enabled: true },
        select: {
          jobName: true,
          expectedIntervalSeconds: true,
          toleranceMultiplier: true,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to load heartbeat targets: ${(err as Error).message}`,
      );
      return;
    }
    if (targets.length === 0) return;

    const now = Date.now();
    let alerted = 0;
    for (const t of targets) {
      try {
        const latest = await this.prisma.cronRun.findFirst({
          where: { jobName: t.jobName, status: 'SUCCEEDED' },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true },
        });
        const tolerance =
          t.expectedIntervalSeconds * 1000 * t.toleranceMultiplier;
        const lastSuccessAt = latest?.startedAt?.getTime() ?? null;
        const silenceMs =
          lastSuccessAt === null ? Number.POSITIVE_INFINITY : now - lastSuccessAt;
        if (silenceMs > tolerance) {
          await this.alert(t.jobName, silenceMs, tolerance);
          alerted += 1;
        }
      } catch (err) {
        this.logger.warn(
          `heartbeat check failed for ${t.jobName}: ${(err as Error).message}`,
        );
      }
    }

    if (alerted > 0) {
      this.logger.warn(
        `cron-heartbeat: ${alerted}/${targets.length} jobs are silent past tolerance`,
      );
    }
  }

  private async alert(
    jobName: string,
    silenceMs: number,
    toleranceMs: number,
  ): Promise<void> {
    try {
      await this.eventBus.publish({
        eventName: 'cron.silent',
        aggregate: 'CronJob',
        aggregateId: jobName,
        occurredAt: new Date(),
        payload: {
          jobName,
          silenceSeconds: Math.floor(silenceMs / 1000),
          toleranceSeconds: Math.floor(toleranceMs / 1000),
        },
      });
    } catch {
      // event-emit best-effort; a wedged outbox shouldn't kill the cron
    }
  }
}
