import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';

import {
  COURIER_GATEWAY_RESOLVER,
  type CourierGatewayResolver,
  type TrackingSnapshot,
} from '../ports/outbound/courier-gateway.port';
import { SHIPPING_EVENTS } from '../../domain/events/shipping.events';
// Phase 86 (2026-05-23) — FSM-enforced shipment lifecycle. Pre-Phase-86
// `applySnapshot` blindly wrote whatever fulfillmentStatus the mapper
// returned; a late IN_TRANSIT after DELIVERED could regress state.
import {
  ShipmentStateService,
  type ShipmentInternalStatus,
} from '../services/shipment-state.service';
// Phase 88 (2026-05-23) — Shipment Evidence Gap #3. Persist POD /
// RTO_PROOF rows from carrier webhook payloads.
import { ShipmentEvidenceService } from '../services/shipment-evidence.service';

/**
 * Phase 86 (2026-05-23) — sentinel error for FSM-rejected scans.
 * Caught inside `applySnapshot` and translated to the
 * `FSM_REJECTED` reason on the return value. Surfaced separately
 * from Prisma P2002 (duplicate) so the webhook controller can pick
 * the matching `WebhookEvent.outcome`.
 */
class FsmRejectedTransitionError extends Error {
  constructor(
    public readonly from: ShipmentInternalStatus | null,
    public readonly to: ShipmentInternalStatus,
  ) {
    super(`FSM rejected transition ${from ?? '(none)'} → ${to}`);
    this.name = 'FsmRejectedTransitionError';
  }
}

/**
 * Carrier-agnostic ingest: take a tracking snapshot the resolver
 * produced, write the latest courier state into our SubOrder row,
 * and emit any state-machine effects (delivered_at, return_window
 * start, exception-queue routing).
 *
 * Called by the carrier tracking webhooks (Shiprocket today) and the
 * admin "refresh tracking" button (on-demand).
 *
 * The use case is deliberately small — domain effects beyond field
 * writes (commission scheduling, customer notification) ride on
 * `SUB_ORDER_DELIVERED` / `SUB_ORDER_EXCEPTION` events the orders
 * module emits when the fulfillmentStatus actually changes.
 */
@Injectable()
export class IngestTrackingUpdateUseCase {
  private readonly logger = new Logger(IngestTrackingUpdateUseCase.name);

  constructor(
    @Inject(COURIER_GATEWAY_RESOLVER)
    private readonly resolver: CourierGatewayResolver,
    private readonly prisma: PrismaService,
    // Phase 3 / C5 — broadcast every accepted snapshot so
    // notifications + audit + the future tracking-history table can
    // subscribe. Without this the customer's order page is silent
    // between PACKED and DELIVERED — IN_TRANSIT / OUT_FOR_DELIVERY
    // / NDR / RTO transitions never fire.
    private readonly eventBus: EventBusService,
    // Phase 86 (2026-05-23) — FSM gate (Gap #3/#18). Validates every
    // carrier-status transition against the internal state machine
    // before the row commits.
    private readonly stateMachine: ShipmentStateService,
    // Phase 88 — POD persistence. @Optional so the legacy test
    // harness doesn't need the new wiring; the persistence path
    // no-ops when undefined.
    @Optional()
    private readonly shipmentEvidence?: ShipmentEvidenceService,
  ) {}

  /**
   * Phase 5 follow-up (2026-05-16) — webhook entry point.
   *
   * Resolve an AWB to its SubOrder and apply the supplied snapshot.
   * Returns the SubOrder id touched, or null when the AWB is orphan
   * (no matching SubOrder — likely a re-shipment AWB the platform
   * never minted, or a cross-tenant misdelivery).
   */
  async ingestSingleSnapshot(
    awb: string,
    snapshot: TrackingSnapshot,
    opts?: {
      source?:
        | 'WEBHOOK_SHIPROCKET'
        | 'WEBHOOK_DELHIVERY'
        | 'POLL_CRON'
        | 'MANUAL_ADMIN';
      rawPayload?: unknown;
    },
  ): Promise<{
    subOrderId: string | null;
    applied: boolean;
    reason?:
      | 'OUT_OF_ORDER'
      | 'FSM_REJECTED'
      | 'DUPLICATE_SCAN'
      | 'ORPHAN'
      | 'REVERSE_LEG_SKIPPED';
  }> {
    // Match the carrier AWB against the sub-order's tracking number.
    const subOrder = await this.prisma.subOrder.findFirst({
      where: { trackingNumber: awb },
      select: { id: true, fulfillmentStatus: true, lastTrackingEventAt: true },
    });
    if (!subOrder) {
      // The AWB may belong to a customer-return REVERSE pickup (RVP), whose AWB
      // is stored on the Return (pickupTrackingNumber), not a sub-order. If so,
      // drive the return's lifecycle from the reverse scan (Step 3).
      if (await this.tryAdvanceReturnByReverseAwb(awb, snapshot)) {
        return { subOrderId: null, applied: true };
      }
      this.logger.warn(`Tracking update for unknown AWB ${awb} — orphan?`);
      return { subOrderId: null, applied: false, reason: 'ORPHAN' };
    }
    // Phase 83 — Gap #19. Ordering guard mirrors the Shiprocket
    // webhook's claimTrackingEvent: CAS-style updateMany only
    // succeeds when the incoming scan's timestamp is newer than
    // `lastTrackingEventAt`. Pre-Phase-83 the poll path had no
    // guard, so an out-of-order DELIVERED-then-IN_TRANSIT pair
    // could regress the FSM (the second event would 'undo' delivery
    // because `applySnapshot` writes fulfillmentStatus on any
    // mapped scan).
    const scanAt = snapshot.scans[0]?.scanAt ?? new Date();
    const claimed = await this.prisma.subOrder.updateMany({
      where: {
        id: subOrder.id,
        OR: [
          { lastTrackingEventAt: null },
          { lastTrackingEventAt: { lt: scanAt } },
        ],
      },
      data: { lastTrackingEventAt: scanAt },
    });
    if (claimed.count !== 1) {
      this.logger.warn(
        `Out-of-order tracking event for AWB ${awb} ` +
          `(scan_at=${scanAt.toISOString()}); dropped to prevent FSM regression.`,
      );
      return { subOrderId: subOrder.id, applied: false, reason: 'OUT_OF_ORDER' };
    }
    // Phase 86 — thread source + rawPayload so applySnapshot can
    // attribute the ShipmentTrackingEvent row to its origin, and
    // propagate the FSM_REJECTED / DUPLICATE_SCAN reason up so the
    // webhook controller can record the matching outcome.
    const result = await this.applySnapshot(subOrder.id, snapshot, opts);
    return {
      subOrderId: subOrder.id,
      applied: result.applied,
      reason: result.reason,
    };
  }

  /**
   * Reverse-pickup (RVP) tracking (Step 3). The AWB belongs to a customer
   * Return (Return.pickupTrackingNumber), not a sub-order. Map the courier scan
   * to a return transition and hand it to the returns module (which owns the
   * FSM) via an event — `reverse_in_transit` for any pickup/transit scan,
   * `reverse_received` once it's delivered back to the warehouse. Returns true
   * when the AWB matched a return and an event was dispatched.
   */
  private async tryAdvanceReturnByReverseAwb(
    awb: string,
    snapshot: TrackingSnapshot,
  ): Promise<boolean> {
    const ret = await this.prisma.return.findFirst({
      where: { pickupTrackingNumber: awb },
      select: { id: true },
    });
    if (!ret) return false;

    const status = (snapshot.currentStatus || '').toUpperCase();
    // "Delivered" on a reverse AWB = arrived back at the warehouse.
    const delivered = status.includes('DELIVERED');
    const inTransit =
      !delivered &&
      ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DISPATCHED', 'REV_'].some(
        (s) => status.includes(s),
      );
    const eventName = delivered
      ? 'shipping.return.reverse_received'
      : inTransit
        ? 'shipping.return.reverse_in_transit'
        : null;
    if (!eventName) return false;

    try {
      await this.eventBus.publish({
        eventName,
        aggregate: 'Return',
        aggregateId: ret.id,
        occurredAt: new Date(),
        payload: { returnId: ret.id, awb, status: snapshot.currentStatus },
      });
    } catch {
      /* best-effort — a dropped event just defers the manual mark */
    }
    this.logger.log(
      `Reverse-pickup scan for return ${ret.id} (awb=${awb}, status=${snapshot.currentStatus}) → ${eventName}`,
    );
    return true;
  }

  /**
   * Apply a snapshot to a SubOrder. Updates the courier-side fields
   * always; promotes `fulfillmentStatus` only on terminal transitions
   * so non-terminal scans don't churn the order state machine.
   *
   * Phase 5 follow-up (2026-05-16) — promoted to public so the
   * webhook controller can hand off pushed events using the same
   * apply path as the polling cron. Keeps the state-machine logic in
   * one place regardless of how the event arrived.
   */
  /**
   * Phase 86 (2026-05-23) — tracking webhook audit Gaps #1/#3/#11/#17/#22.
   *
   * Wholesale rewrite:
   *   • Wraps SubOrder update + ShipmentTrackingEvent insert +
   *     outbox event publish in a single `prisma.$transaction` so a
   *     partial commit can't leave state drifting from emitted
   *     events (Gap #11).
   *   • Reads the prior internal status from the latest
   *     `shipment_tracking_events` row and runs
   *     `stateMachine.assertTransition` before persisting (Gap #3/#18).
   *   • Inserts one `ShipmentTrackingEvent` history row per accepted
   *     snapshot (Gap #1/#17). DB-level UNIQUE on (subOrderId,
   *     externalStatus, scanAt) absorbs duplicate observations from
   *     the poll cron after a webhook delivery (P2002 → no-op).
   *   • Events publish via `{ tx }` so the outbox row commits
   *     atomically (Gap #22).
   *
   * Returns whether the snapshot resulted in a state advance (the
   * caller already knows the ordering CAS passed; this signal lets
   * the webhook controller pick the right WebhookEvent outcome).
   */
  async applySnapshot(
    subOrderId: string,
    snapshot: TrackingSnapshot,
    opts?: {
      source?:
        | 'WEBHOOK_SHIPROCKET'
        | 'WEBHOOK_DELHIVERY'
        | 'POLL_CRON'
        | 'MANUAL_ADMIN';
      rawPayload?: unknown;
    },
  ): Promise<{
    applied: boolean;
    reason?: 'FSM_REJECTED' | 'DUPLICATE_SCAN' | 'REVERSE_LEG_SKIPPED';
  }> {
    // Phase 87 (2026-05-23) — Gap #20. REV_* statuses are reverse-leg
    // (customer-initiated return) events. They belong to the Return
    // module's flow, not the forward-leg shipment FSM. Pre-Phase-87
    // the use-case crashed on REV_DELIVERED via the (now-removed)
    // → DELIVERED mapping; Phase 86 removed the dead branch but the
    // FSM would still reject REV_* as unknown → FSM_REJECTED, which
    // looked like a real failure to ops. Skip them explicitly with
    // a logged outcome.
    if (
      snapshot.currentStatus.startsWith('REV_') ||
      snapshot.currentStatus === 'PENDING'
    ) {
      // Phase 100 (2026-05-23) — Mark Received audit Gap #14 closure.
      // Pre-Phase-100 REV_DELIVERED scans were silently skipped, so
      // the Return parcel sat in IN_TRANSIT until an admin manually
      // clicked Mark Received. We now publish a domain event for
      // REV_DELIVERED so the Returns module can auto-flip the
      // matching Return to RECEIVED via its event handler.
      //
      // The shipment FSM stays out of the way (no REV_* states); we
      // only signal externally.
      if (snapshot.currentStatus === 'REV_DELIVERED') {
        try {
          await this.eventBus.publish({
            eventName: 'shipping.reverse_delivered',
            aggregate: 'SubOrder',
            aggregateId: subOrderId,
            occurredAt: new Date(),
            payload: {
              subOrderId,
              awb: snapshot.awb,
              source: opts?.source ?? 'POLL_CRON',
            },
          });
        } catch (err) {
          this.logger.warn(
            `[REV_DELIVERED] event publish failed for sub-order ${subOrderId}: ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          );
        }
      }
      this.logger.log(
        `Reverse-leg scan ignored for sub-order ${subOrderId} ` +
          `(status=${snapshot.currentStatus}, awb=${snapshot.awb})`,
      );
      return { applied: false, reason: 'REVERSE_LEG_SKIPPED' };
    }

    const deliveredAt =
      snapshot.currentStatus === 'DELIVERED' ? new Date() : undefined;
    const fulfillment = mapToFulfillmentStatus(snapshot.currentStatus);
    const scanAt = snapshot.scans[0]?.scanAt ?? new Date();
    const externalStatus =
      snapshot.rawCurrentStatus ?? snapshot.currentStatus;
    const source = opts?.source ?? 'POLL_CRON';

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. FSM gate (Gap #3/#18). Read the latest accepted scan's
        // internalStatus and verify the new scan is a legal
        // transition. First scan (no prior history) — service
        // defaults the rules per `ShipmentStateService.assertTransition`.
        const prior = await tx.shipmentTrackingEvent.findFirst({
          where: { subOrderId },
          orderBy: { scanAt: 'desc' },
          select: { internalStatus: true },
        });
        const priorStatus =
          (prior?.internalStatus ?? null) as ShipmentInternalStatus | null;
        const nextStatus = snapshot.currentStatus as ShipmentInternalStatus;
        if (!this.stateMachine.isTransitionAllowed(priorStatus, nextStatus)) {
          // Phase 86 — Gap #21. FSM-rejected scans throw a specific
          // error so the controller can tag WebhookEvent.outcome =
          // FSM_REJECTED rather than silently 200-ing.
          throw new FsmRejectedTransitionError(priorStatus, nextStatus);
        }

        // 2. Insert the per-scan history row (Gap #1/#17). DB-level
        // UNIQUE absorbs duplicate observations (P2002 caught by
        // outer catch).
        await tx.shipmentTrackingEvent.create({
          data: {
            subOrderId,
            internalStatus: snapshot.currentStatus,
            externalStatus,
            externalStatusCode:
              snapshot.scans[0]?.rawStatusCode ?? null,
            scanLocation: snapshot.scans[0]?.scanLocation ?? null,
            remarks: snapshot.scans[0]?.remark ?? null,
            scanAt,
            source,
            rawPayload: (opts?.rawPayload as any) ?? null,
          } as any,
        });

        // 3. Phase 87 — NDR/RTO milestone persistence (Gaps #4/#5/#6).
        // The mapping fans out into the dedicated history tables
        // (ndr_attempts / rto_events) + per-row counters. The
        // sub-order row's fulfillmentStatus update further below
        // is the business-level rollup; these tables capture the
        // granular forensic detail the customer page + admin tools
        // need.
        const ndrRtoSideEffects = await applyNdrRtoSideEffects(
          tx,
          subOrderId,
          snapshot,
          scanAt,
          opts?.rawPayload,
        );

        // Phase 88 (2026-05-23) — Gap #3 POD persistence. When the
        // carrier reports DELIVERED (or RTO_DELIVERED) and supplies
        // a pod_url / signature_url in the payload, write a typed
        // ShipmentEvidence row inside the same tx. Customer order
        // page + admin dispute panel render this directly.
        await this.persistPodEvidence(tx, subOrderId, snapshot);

        // 4. Update SubOrder. Promotion to fulfillmentStatus only on
        // mapped transitions; courier-side fields always mirror.
        // NDR/RTO timestamps (when this scan advanced one) merge in
        // here from `ndrRtoSideEffects` so a single SubOrder.update
        // captures the full snapshot shape.
        await tx.subOrder.update({
          where: { id: subOrderId },
          data: {
            trackingNumber: snapshot.awb,
            courierName: snapshot.carrier,
            lastCourierStatus: externalStatus,
            lastCourierReasonCode:
              snapshot.scans[0]?.rawStatusCode ?? null,
            ...(deliveredAt ? { deliveredAt } : {}),
            ...(fulfillment ? { fulfillmentStatus: fulfillment } : {}),
            ...ndrRtoSideEffects.subOrderPatch,
          },
        });

        // 5. Outbox-aware publish (Gap #22). All three potential
        // events go through the same tx — the rollback is the
        // safety net for downstream consumer consistency.
        await this.publishTrackingEvents(
          subOrderId,
          snapshot,
          tx,
          ndrRtoSideEffects,
        );
      });
      return { applied: true };
    } catch (err: any) {
      // Phase 86 — duplicate scan absorbed (P2002 from the UNIQUE
      // on shipment_tracking_events). Carrier retry after webhook
      // already wrote the row, OR poll cron observing the same scan
      // the webhook already pushed.
      if (err?.code === 'P2002') {
        this.logger.log(
          `Duplicate tracking scan ignored for sub-order ${subOrderId} ` +
            `(externalStatus=${externalStatus}, scanAt=${scanAt.toISOString()})`,
        );
        return { applied: false, reason: 'DUPLICATE_SCAN' };
      }
      if (err instanceof FsmRejectedTransitionError) {
        this.logger.warn(
          `FSM rejected ${err.from ?? '(none)'} → ${err.to} ` +
            `for sub-order ${subOrderId} (awb ${snapshot.awb})`,
        );
        return { applied: false, reason: 'FSM_REJECTED' };
      }
      throw err;
    }
  }

  /**
   * Phase 88 (2026-05-23) — Shipment Evidence Gap #3.
   *
   * Carriers include POD URLs in their delivery
   * webhook payloads. Pre-Phase-88 those URLs were discarded; admin
   * had no proof to push back on "I never got it" chargebacks. This
   * method captures the URL into a FileMetadata row (provider='carrier')
   * + a typed ShipmentEvidence(kind=POD) row inside the same tx as
   * the SubOrder.deliveredAt write.
   *
   * For RTO_DELIVERED we capture a RTO_PROOF row with the same shape.
   *
   * No-op when:
   *   - The status isn't DELIVERED / RTO_DELIVERED
   *   - The snapshot doesn't include podUrl/signatureUrl
   *   - The shipmentEvidence service isn't wired (test environment)
   */
  private async persistPodEvidence(
    tx: any,
    subOrderId: string,
    snapshot: TrackingSnapshot,
  ): Promise<void> {
    if (!this.shipmentEvidence) return;
    const isDelivery = snapshot.currentStatus === 'DELIVERED';
    const isRtoDelivery = snapshot.currentStatus === 'RTO_DELIVERED';
    if (!isDelivery && !isRtoDelivery) return;

    const url = snapshot.podUrl ?? snapshot.signatureUrl ?? null;
    if (!url) return; // Carrier didn't supply a POD URL.

    // Persist a FileMetadata row pointing at the carrier-hosted URL.
    // provider='carrier' signals "do not re-sign / do not GC". The
    // viewUrlFor helper falls back to providerUrl directly when present.
    let fileId: string;
    try {
      const file = await tx.fileMetadata.create({
        data: {
          fileName: `pod-${snapshot.awb}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: 0,
          classification: 'PUBLIC',
          purpose: 'SHIPMENT_EVIDENCE',
          status: 'READY',
          storageKey: `carrier:${snapshot.carrier}:${snapshot.awb}:${
            isRtoDelivery ? 'rto-pod' : 'pod'
          }`,
          provider: 'carrier',
          providerFileId: null,
          providerUrl: url,
          uploadedBy: 'carrier-webhook',
        },
      });
      fileId = file.id;
    } catch (err: any) {
      // P2002 on storageKey UNIQUE — POD already captured for this
      // (carrier, awb) pair. Re-resolve the existing file id so the
      // ShipmentEvidence row still gets written (idempotent).
      if (err?.code !== 'P2002') throw err;
      const existing = await tx.fileMetadata.findUnique({
        where: {
          storageKey: `carrier:${snapshot.carrier}:${snapshot.awb}:${
            isRtoDelivery ? 'rto-pod' : 'pod'
          }`,
        },
        select: { id: true },
      });
      if (!existing) return;
      fileId = existing.id;
    }

    await this.shipmentEvidence.create({
      subOrderId,
      kind: isRtoDelivery ? 'RTO_PROOF' : 'POD',
      fileId,
      uploadedBy: 'carrier-webhook',
      uploadedByRole: 'CARRIER_WEBHOOK',
      courierWaybill: snapshot.awb,
      signedByName: snapshot.signedByName ?? null,
      customerOtpHash: snapshot.customerOtpHash ?? null,
      tx,
    });

    await this.eventBus
      .publish({
        eventName: SHIPPING_EVENTS.EVIDENCE_POD_CAPTURED,
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt: new Date(),
        payload: {
          subOrderId,
          awb: snapshot.awb,
          carrier: snapshot.carrier,
          kind: isRtoDelivery ? 'RTO_PROOF' : 'POD',
        },
      })
      .catch(() => undefined);
  }

  private async publishTrackingEvents(
    subOrderId: string,
    snapshot: TrackingSnapshot,
    tx?: any,
    ndrRtoSideEffects?: NdrRtoSideEffectsOutcome,
  ): Promise<void> {
    const occurredAt = new Date();
    // Phase 86 (2026-05-23) — Gap #22. Pass the tx through to
    // EventBusService so the outbox row commits atomically with
    // the SubOrder + ShipmentTrackingEvent writes.
    const publishOpts = tx ? { tx } : undefined;

    // 1. Generic update — every snapshot.
    await this.eventBus.publish(
      {
        eventName: SHIPPING_EVENTS.TRACKING_UPDATED,
        aggregate: 'SubOrder',
        aggregateId: subOrderId,
        occurredAt,
        payload: {
          subOrderId,
          awb: snapshot.awb,
          carrier: snapshot.carrier,
          status: snapshot.currentStatus,
        },
      },
      publishOpts,
    );

    // 2. NDR — failed delivery attempt. Phase 87 (Gap #17): include
    // attemptNumber so a downstream subscriber can dedup at its own
    // layer (in addition to the DB-level UNIQUE on carrier_event_id
    // that already absorbed the duplicate at the persistence step).
    if (snapshot.currentStatus === 'UNDELIVERED') {
      await this.eventBus.publish(
        {
          eventName: SHIPPING_EVENTS.NDR_RAISED,
          aggregate: 'SubOrder',
          aggregateId: subOrderId,
          occurredAt,
          payload: {
            subOrderId,
            awb: snapshot.awb,
            carrier: snapshot.carrier,
            attemptNumber: ndrRtoSideEffects?.ndrAttemptNumber ?? null,
            reason: snapshot.scans[0]?.remark ?? null,
            reasonCode: snapshot.scans[0]?.rawStatusCode ?? null,
          },
        },
        publishOpts,
      );
    }

    // Phase 87 — Gap #13. RTO_INITIATED is declared in the events
    // catalog but pre-Phase-87 was never published — the customer
    // never got "Your order is being returned to the seller" notice
    // and the refund-prep subscriber couldn't wake.
    if (snapshot.currentStatus === 'RTO_INITIATED') {
      await this.eventBus.publish(
        {
          eventName: SHIPPING_EVENTS.RTO_INITIATED,
          aggregate: 'SubOrder',
          aggregateId: subOrderId,
          occurredAt,
          payload: {
            subOrderId,
            awb: snapshot.awb,
            carrier: snapshot.carrier,
            reason: snapshot.scans[0]?.remark ?? null,
            source: 'CARRIER_WEBHOOK',
          },
        },
        publishOpts,
      );
    }

    // 3. RTO terminal — return-to-origin completed.
    if (snapshot.currentStatus === 'RTO_DELIVERED') {
      await this.eventBus.publish(
        {
          eventName: SHIPPING_EVENTS.RTO_DELIVERED,
          aggregate: 'SubOrder',
          aggregateId: subOrderId,
          occurredAt,
          payload: {
            subOrderId,
            awb: snapshot.awb,
            carrier: snapshot.carrier,
          },
        },
        publishOpts,
      );
    }

    // 4. Phase 86 — Gap #13. SHIPMENT_DELIVERED is the canonical
    // shipping-module delivery event. Three handlers were
    // subscribed (shipment-notification, shipment-audit,
    // business-metrics) but the event was never emitted; this
    // closes that dangling subscription.
    if (snapshot.currentStatus === 'DELIVERED') {
      await this.eventBus.publish(
        {
          eventName: SHIPPING_EVENTS.SHIPMENT_DELIVERED,
          aggregate: 'SubOrder',
          aggregateId: subOrderId,
          occurredAt,
          payload: {
            subOrderId,
            awb: snapshot.awb,
            carrier: snapshot.carrier,
          },
        },
        publishOpts,
      );
    }

    // 5. Phase 86 — Gap #7/#27. LOST / DAMAGED scans fire the
    // shipment.lost event so a refund-saga subscriber can
    // initiate a refund. Pre-Phase-86 these statuses fell to the
    // `EXCEPTION` bucket and never triggered a refund.
    if (
      snapshot.currentStatus === 'LOST' ||
      snapshot.currentStatus === 'DAMAGED'
    ) {
      await this.eventBus.publish(
        {
          eventName: SHIPPING_EVENTS.SHIPMENT_LOST,
          aggregate: 'SubOrder',
          aggregateId: subOrderId,
          occurredAt,
          payload: {
            subOrderId,
            awb: snapshot.awb,
            carrier: snapshot.carrier,
            cause: snapshot.currentStatus,
          },
        },
        publishOpts,
      );
    }
  }
}

/**
 * Translate the carrier-neutral `ShipmentStatusInternal` onto our
 * SubOrder.fulfillmentStatus enum. Returns undefined when the new
 * snapshot doesn't justify a transition (avoids over-writing
 * upstream state with intermediate scans).
 */
function mapToFulfillmentStatus(
  current: string,
): 'UNFULFILLED' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | undefined {
  switch (current) {
    case 'MANIFESTED':
    case 'PICKED_UP':
      return 'PACKED';
    case 'IN_TRANSIT':
    case 'OUT_FOR_DELIVERY':
    case 'UNDELIVERED':
    // Phase 86 — Gap #27. RTO-in-flight states keep SHIPPED at the
    // business level until the carrier confirms RTO_DELIVERED. The
    // ShipmentTrackingEvent row carries the granular RTO_INITIATED /
    // RTO_IN_TRANSIT for the customer page.
    case 'RTO_INITIATED':
    case 'RTO_IN_TRANSIT':
    case 'FAILED_DELIVERY':
    // Phase 87 (2026-05-23) — Gap #10. EXCEPTION (out-of-area /
    // delayed / misrouted / shortage) holds the parcel in carrier
    // limbo; SHIPPED at the business level still reflects "in the
    // carrier's hands, not yet final". Customer page renders the
    // EXCEPTION badge from the granular history row.
    case 'EXCEPTION':
      return 'SHIPPED';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'RTO_DELIVERED':
    // Phase 86 — Gap #7/#27. LOST and DAMAGED carrier states are
    // terminal-cancel for the order; the SHIPMENT_LOST event the
    // publisher fires drives the refund saga separately.
    case 'LOST':
    case 'DAMAGED':
      return 'CANCELLED';
    default:
      return undefined;
  }
}

/**
 * Phase 87 (2026-05-23) — NDR/RTO Gaps #4/#5/#6/#11/#13/#19.
 *
 * Per-scan persistence for NDR + RTO milestones. Called inside the
 * `applySnapshot` $transaction so the history rows + counter bumps +
 * SubOrder patch all commit atomically (or roll back together on
 * failure).
 *
 * Returns a `subOrderPatch` the caller merges into its single
 * SubOrder.update so we don't issue two writes per scan, and an
 * `ndrAttemptNumber` for the publisher to include in the NDR_RAISED
 * event payload (Gap #17 — downstream subscribers dedup on this).
 *
 * Idempotency: each NdrAttempt / RtoEvent is unique on
 * `(subOrder, attemptNumber)` or `carrier_event_id`. A duplicate
 * webhook delivery that beats the ShipmentTrackingEvent UNIQUE
 * still risks a collision here, so we catch P2002 and skip the
 * counter bump — the outer use-case catches the parent
 * ShipmentTrackingEvent P2002 and surfaces DUPLICATE_SCAN.
 */
type NdrRtoSideEffectsOutcome = {
  subOrderPatch: Record<string, unknown>;
  ndrAttemptNumber: number | null;
  rtoMilestone: 'INITIATED' | 'IN_TRANSIT' | 'DELIVERED' | null;
};

async function applyNdrRtoSideEffects(
  tx: any,
  subOrderId: string,
  snapshot: TrackingSnapshot,
  scanAt: Date,
  rawPayload: unknown,
): Promise<NdrRtoSideEffectsOutcome> {
  const result: NdrRtoSideEffectsOutcome = {
    subOrderPatch: {},
    ndrAttemptNumber: null,
    rtoMilestone: null,
  };
  const status = snapshot.currentStatus;
  const scanReason = snapshot.scans[0]?.remark ?? null;
  const scanReasonCode = snapshot.scans[0]?.rawStatusCode ?? null;
  const scanLocation = snapshot.scans[0]?.scanLocation ?? null;

  if (status === 'UNDELIVERED' || status === 'FAILED_DELIVERY') {
    // Phase 87 — Gap #5. Increment counter atomically. The
    // (subOrderId, attemptNumber) UNIQUE on ndr_attempts catches
    // racing inserts; the outer $transaction's read-modify-write on
    // SubOrder also serialises with FOR UPDATE-style behavior
    // because Prisma's `update` takes a row lock on PK.
    const sub = await tx.subOrder.findUnique({
      where: { id: subOrderId },
      select: { ndrAttemptCount: true },
    });
    const nextAttempt = (sub?.ndrAttemptCount ?? 0) + 1;
    try {
      await tx.ndrAttempt.create({
        data: {
          subOrderId,
          attemptNumber: nextAttempt,
          attemptedAt: scanAt,
          reason: scanReason,
          reasonCode: scanReasonCode,
          scanLocation,
          rawPayload: (rawPayload as any) ?? null,
        },
      });
      result.ndrAttemptNumber = nextAttempt;
      result.subOrderPatch.ndrAttemptCount = nextAttempt;
      result.subOrderPatch.ndrLastAttemptAt = scanAt;
      result.subOrderPatch.ndrLastReason = scanReason;
      result.subOrderPatch.ndrLastReasonCode = scanReasonCode;
      result.subOrderPatch.ndrStatus = 'PENDING_REATTEMPT';
    } catch (err: any) {
      // P2002 on the attempt UNIQUE — duplicate NDR scan absorbed.
      // The outer tx's ShipmentTrackingEvent UNIQUE catches the
      // parent dup; if we got here in isolation it means the parent
      // raced past somehow. Skip the bump and continue.
      if (err?.code !== 'P2002') throw err;
    }
  }

  if (status === 'RTO_INITIATED') {
    result.rtoMilestone = 'INITIATED';
    result.subOrderPatch.rtoInitiatedAt = scanAt;
    result.subOrderPatch.rtoReason = scanReason;
    result.subOrderPatch.ndrStatus = 'EXHAUSTED';
    await tx.rtoEvent.create({
      data: {
        subOrderId,
        status: 'RTO_INITIATED',
        occurredAt: scanAt,
        reason: scanReason,
        scanLocation,
        rawPayload: (rawPayload as any) ?? null,
      },
    });
  }

  if (status === 'RTO_IN_TRANSIT') {
    result.rtoMilestone = 'IN_TRANSIT';
    result.subOrderPatch.rtoInTransitAt = scanAt;
    await tx.rtoEvent.create({
      data: {
        subOrderId,
        status: 'RTO_IN_TRANSIT',
        occurredAt: scanAt,
        reason: scanReason,
        scanLocation,
        rawPayload: (rawPayload as any) ?? null,
      },
    });
  }

  if (status === 'RTO_DELIVERED') {
    result.rtoMilestone = 'DELIVERED';
    result.subOrderPatch.rtoDeliveredAt = scanAt;
    await tx.rtoEvent.create({
      data: {
        subOrderId,
        status: 'RTO_DELIVERED',
        occurredAt: scanAt,
        reason: scanReason,
        scanLocation,
        rawPayload: (rawPayload as any) ?? null,
      },
    });

    // Phase 87 — Gap #19. Queue a credit-note obligation for finance
    // so GSTR-1 doesn't overstate outward supply. Read the existing
    // tax snapshot to populate the eligibility numbers; the cron
    // that owns rto_credit_note_pending will issue the actual
    // credit note via the existing tax module.
    const summary = await tx.subOrderTaxSummary.findFirst({
      where: { subOrderId },
      select: {
        taxableValueInPaise: true,
        totalTaxInPaise: true,
      },
    });
    const sub = await tx.subOrder.findUnique({
      where: { id: subOrderId },
      select: { masterOrderId: true },
    });
    if (sub) {
      await tx.rtoCreditNotePending
        .create({
          data: {
            subOrderId,
            masterOrderId: sub.masterOrderId,
            taxableAmountInPaise: summary?.taxableValueInPaise ?? 0n,
            totalTaxInPaise: summary?.totalTaxInPaise ?? 0n,
            status: 'PENDING',
          },
        })
        .catch((err: any) => {
          // P2002 — credit-note already queued for this sub-order
          // (idempotent: another RTO_DELIVERED webhook hit). Safe to ignore.
          if (err?.code !== 'P2002') throw err;
        });
    }
  }

  return result;
}
