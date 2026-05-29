// Phase 89 (2026-05-23) — Shipment Evidence audit Gap #10 / #23.
//
// EWB expiry sweep. Rows in status=GENERATED with valid_until in the
// past + the sub-order not yet DELIVERED get marked EXPIRED + raise
// an AdminTask so ops can extend the EWB (NIC supports `extEwb` for
// in-transit shipments) or regenerate after cancellation.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { EWAY_BILL_EVENTS } from '../../domain/eway-bill-events';

@Injectable()
export class EWayBillExpiryCron {
  private readonly logger = new Logger(EWayBillExpiryCron.name);
  private static readonly BATCH = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly leader: LeaderElectedCron,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    await this.leader.run('eway-bill-expiry', 3600, async () => {
      const now = new Date();
      const expired = await this.prisma.eWayBill.findMany({
        where: {
          status: 'GENERATED',
          validUntil: { lt: now },
        },
        select: {
          id: true,
          subOrderId: true,
          ewbNumber: true,
          validUntil: true,
        },
        take: EWayBillExpiryCron.BATCH,
      });
      if (expired.length === 0) return;

      let expiredCount = 0;
      for (const row of expired) {
        try {
          // Phase 89 — only flip if the sub-order is still in-flight.
          // A delivered sub-order's EWB is correctly past its validity
          // because the goods reached the consignee; raising an
          // AdminTask would be noise.
          const sub = await this.prisma.subOrder.findUnique({
            where: { id: row.subOrderId },
            select: { fulfillmentStatus: true },
          });
          if (sub?.fulfillmentStatus === 'DELIVERED') continue;

          await this.prisma.$transaction(async (tx) => {
            await tx.eWayBill.update({
              where: { id: row.id },
              data: { status: 'EXPIRED' },
            });
            await (tx as any).eWayBillAuditLog.create({
              data: {
                ewayBillId: row.id,
                action: 'EXPIRE',
                fromStatus: 'GENERATED',
                toStatus: 'EXPIRED',
                actorId: 'expiry-cron',
                actorRole: 'SYSTEM',
                reason: `valid_until ${row.validUntil?.toISOString()} passed without delivery`,
              },
            });
            await (tx as any).adminTask.upsert({
              where: { uniqueKey: `eway-bill-expired:${row.id}` },
              update: {},
              create: {
                kind: 'EWAY_BILL_EXPIRED',
                uniqueKey: `eway-bill-expired:${row.id}`,
                severity: 'HIGH',
                status: 'OPEN',
                title: `EWB ${row.ewbNumber} expired (sub-order ${row.subOrderId})`,
                details: `valid_until ${row.validUntil?.toISOString()}; goods not yet delivered. Extend EWB at NIC or regenerate.`,
                relatedResource: 'eway_bill',
                relatedResourceId: row.id,
              },
            });
          });
          await this.eventBus
            .publish({
              eventName: EWAY_BILL_EVENTS.EXPIRED,
              aggregate: 'EWayBill',
              aggregateId: row.id,
              occurredAt: new Date(),
              payload: {
                ewayBillId: row.id,
                subOrderId: row.subOrderId,
                ewbNumber: row.ewbNumber,
              },
            })
            .catch(() => undefined);
          expiredCount += 1;
        } catch (err) {
          this.logger.error(
            `Failed to expire EWB ${row.id}: ${(err as Error).message}`,
          );
        }
      }
      if (expiredCount > 0) {
        this.logger.log(
          `EWB expiry sweep: ${expiredCount} row(s) marked EXPIRED + AdminTask raised`,
        );
      }
    });
  }
}
