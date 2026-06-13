// Reverse-logistics auto-book (Step 2, returns side).
//
// The shipping module books the reverse Delhivery pickup when a return is
// APPROVED and publishes `shipping.return.reverse_booked` with the reverse AWB.
// This handler — which lives in the returns module so it owns the return FSM —
// consumes that event and attaches the AWB + transitions the return
// APPROVED → PICKUP_SCHEDULED via the normal schedulePickup path (audit +
// events included), replacing the manual "admin types the AWB" step.
//
// No explicit idempotency guard needed: schedulePickup runs an optimistic FSM
// transition (APPROVED → PICKUP_SCHEDULED), so a duplicate event finds the
// return no longer APPROVED and the transition throws — caught + logged here.

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { ReturnService } from '../services/return.service';

@Injectable()
export class ReturnReverseBookedHandler {
  private readonly logger = new Logger(ReturnReverseBookedHandler.name);

  constructor(private readonly returnService: ReturnService) {}

  @OnEvent('shipping.return.reverse_booked')
  async onReverseBooked(event: DomainEvent): Promise<void> {
    const payload = (event.payload as any) ?? {};
    const returnId = payload.returnId as string | undefined;
    const awb = payload.awb as string | undefined;
    if (!returnId || !awb) return;

    try {
      await this.returnService.schedulePickup(returnId, 'SYSTEM', {
        pickupScheduledAt: new Date(),
        pickupTrackingNumber: awb,
        pickupCourier: (payload.courierName as string) ?? 'Delhivery',
      });
      this.logger.log(
        `Return ${returnId}: auto-scheduled reverse pickup (AWB ${awb}).`,
      );
    } catch (err) {
      // Return is likely no longer APPROVED (duplicate event, or an admin acted
      // first). The FSM rejected the transition — safe to ignore.
      this.logger.warn(
        `Return ${returnId}: reverse-pickup auto-schedule skipped — ${
          (err as Error)?.message
        }`,
      );
    }
  }

  /**
   * Step 3 — the reverse courier picked up / is in transit. Move the return
   * PICKUP_SCHEDULED → IN_TRANSIT. FSM-guarded, so a duplicate or out-of-order
   * scan is rejected and ignored.
   */
  @OnEvent('shipping.return.reverse_in_transit')
  async onReverseInTransit(event: DomainEvent): Promise<void> {
    const payload = (event.payload as any) ?? {};
    const returnId = payload.returnId as string | undefined;
    if (!returnId) return;
    try {
      await this.returnService.markInTransit(
        returnId,
        'SYSTEM',
        'SYSTEM',
        payload.awb as string | undefined,
      );
      this.logger.log(`Return ${returnId}: reverse pickup in transit.`);
    } catch (err) {
      this.logger.warn(
        `Return ${returnId}: markInTransit skipped — ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Step 3 — the reverse parcel was delivered back to the warehouse. Move the
   * return to RECEIVED (which feeds the existing QC → refund path). A delivered
   * scan can arrive without a prior in-transit scan, so we best-effort advance
   * through IN_TRANSIT first; both calls are FSM-guarded.
   */
  @OnEvent('shipping.return.reverse_received')
  async onReverseReceived(event: DomainEvent): Promise<void> {
    const payload = (event.payload as any) ?? {};
    const returnId = payload.returnId as string | undefined;
    if (!returnId) return;
    // Best-effort: ensure it passed through IN_TRANSIT (ignored if already past).
    try {
      await this.returnService.markInTransit(
        returnId,
        'SYSTEM',
        'SYSTEM',
        payload.awb as string | undefined,
      );
    } catch {
      /* already in transit or beyond — fine */
    }
    try {
      await this.returnService.markReceived(
        returnId,
        'SYSTEM',
        'SYSTEM',
        'Auto-marked received from courier reverse-delivery scan.',
      );
      this.logger.log(`Return ${returnId}: reverse parcel received at warehouse.`);
    } catch (err) {
      this.logger.warn(
        `Return ${returnId}: markReceived skipped — ${(err as Error)?.message}`,
      );
    }
  }
}
