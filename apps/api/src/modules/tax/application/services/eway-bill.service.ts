// Phase 15 GST — EWayBillService.
//
// Owns the lifecycle of `e_way_bills` rows:
//
//   classifyForSubOrder(subOrderId)
//     Decides REQUIRED vs NOT_REQUIRED based on the consignment value
//     (post-discount, including GST + shipping) against the
//     `eway_bill_threshold_paise` tax-config knob. Creates the row in
//     the right starting status; idempotent on re-call.
//
//   generate(subOrderId, transportDetails, actorId)
//     Calls the stub (or NIC) provider, persists EWB number + validity.
//     If the row is currently NOT_REQUIRED, throws — caller must
//     classifyForSubOrder first. On provider failure, increments
//     retryCount + sets status=FAILED. AdminTask creation is left to
//     a future retry cron.
//
//   cancel(ewbId, adminId, reason)
//     CBIC permits cancellation within 24h of issuance. Past 24h →
//     throws EWayBillCancellationWindowClosedError; caller routes to
//     "generate replacement EWB" flow instead.
//
//   adminOverride(subOrderId, adminId, reason)
//     Sets override_admin_id + reason on the row so the seller-side
//     ship guard can let the shipment through. Audited; tied to the
//     `tax.ewayBill.override` permission upstream.
//
// Idempotency: the partial unique index on `(sub_order_id) WHERE
// status != 'CANCELLED'` collapses retries to one active row per
// sub-order. Calling `classifyForSubOrder` twice returns the existing
// row with the same status; calling `generate` twice when status is
// already GENERATED returns the existing EWB number (no second
// provider call). Cancelled rows accumulate so the audit trail
// preserves the history.
//
// See:
//   - docs/tax/EWAY_BILL_POLICY.md
//   - apps/api/src/modules/tax/domain/eway-bill-validity.ts

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  EWayBill,
  EWayBillStatus,
  EWayBillTransportMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { TaxConfigService } from './tax-config.service';
import {
  EWAY_BILL_PROVIDER,
  type EWayBillProvider,
} from '../../infrastructure/eway-bill/eway-bill-provider';
import {
  haversineKm,
  isIntraStateUnderThreshold,
} from '../../domain/intra-state-distance';
// Phase 89 (2026-05-23) — Gap #16 pincode → GST state code mapper.
import { deriveStateCodeFromPincode } from '../../domain/pincode-state';
// Phase 89 — Gap #5 inter-state-at-any-value HSN rule book.
import { anyLineRequiresInterStateEwb } from '../../domain/eway-bill-hsn-policy';
// Phase 89 — Gap #15 event names + Gap #26 override category enum.
import {
  EWAY_BILL_EVENTS,
  type EWayBillOverrideReasonCategory,
} from '../../domain/eway-bill-events';

export class EWayBillNotFoundError extends Error {
  constructor(public readonly ewbId: string) {
    super(`EWayBill ${ewbId} not found`);
    this.name = 'EWayBillNotFoundError';
  }
}

export class EWayBillCancellationWindowClosedError extends Error {
  constructor(
    public readonly ewbId: string,
    public readonly ewbDate: Date,
  ) {
    super(
      `EWayBill ${ewbId} (issued ${ewbDate.toISOString()}) is past the ` +
        `24-hour cancellation window. Generate a new EWB instead.`,
    );
    this.name = 'EWayBillCancellationWindowClosedError';
  }
}

/**
 * Phase 160 (e-way-bill audit B4) — thrown when EWB generation is globally
 * disabled via the `eway_bill_enabled` tax-config kill switch. The retry
 * cron treats it as a skip; the controller maps it to 409. A REQUIRED row
 * that can't be generated then blocks `canShip` — forcing an explicit,
 * audited `adminOverride` to dispatch, which is the safe behaviour (we do
 * NOT silently allow shipping without an EWB when generation is off).
 */
export class EWayBillDisabledError extends Error {
  constructor(public readonly subOrderId: string) {
    super(
      `E-way-bill generation is disabled (tax_config.eway_bill_enabled = false). ` +
        `Re-enable it, or use an audited admin override to dispatch.`,
    );
    this.name = 'EWayBillDisabledError';
  }
}

export class EWayBillNotEligibleError extends Error {
  constructor(
    public readonly ewbId: string,
    public readonly currentStatus: EWayBillStatus,
    public readonly operation: 'generate' | 'cancel',
  ) {
    const verb =
      operation === 'generate' ? 'generated' : 'cancelled';
    super(
      `EWayBill ${ewbId} cannot be ${verb} from status ${currentStatus}`,
    );
    this.name = 'EWayBillNotEligibleError';
  }
}

export interface ClassifyResult {
  row: EWayBill;
  required: boolean;
  thresholdPaise: number;
  consignmentValueInPaise: bigint;
}

export interface GenerateTransportDetails {
  transportMode?: EWayBillTransportMode;
  vehicleNumber?: string | null;
  transporterId?: string | null;
  transporterName?: string | null;
  distanceKm?: number | null;
  /** Defaults to "now" — overridable for testing. */
  now?: Date;
}

@Injectable()
export class EWayBillService {
  private readonly logger = new Logger(EWayBillService.name);
  private static readonly CANCELLATION_WINDOW_MS = 24 * 60 * 60 * 1000;
  // Phase 160 (cancel/override audit #9/#10) — absorb clock skew between
  // our clock and NIC's. We reject at `effective window = 24h − margin`
  // (and at the boundary, `>=`) so a cancel we accept can't be one NIC's
  // portal then rejects for being just past its own 24h mark.
  private static readonly CANCELLATION_SAFETY_MARGIN_MS = 10 * 60 * 1000;
  // Phase 89 — Gap #24 policy versioning. Bumped when CBIC notifies
  // new HSN rules or the per-state threshold table changes.
  private static readonly POLICY_VERSION = 'cbic-2024-q3';
  // Phase 89 — Gap #9 / Phase 160 cancel-override audit #17 dual-control
  // threshold. Above this consignment value, override requires the senior
  // `tax.ewayBill.override.superAdmin` permission (controller enforces) AND
  // the override actor must differ from the original classify / generate
  // actor (service enforces). PUBLIC so the controller gates on the exact
  // same boundary the separation-of-duty check uses (no magic-number drift).
  static readonly OVERRIDE_HIGH_VALUE_PAISE = 2_00_00_00; // ₹2,00,000

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxConfig: TaxConfigService,
    @Inject(EWAY_BILL_PROVIDER) private readonly provider: EWayBillProvider,
    // Phase 89 — Gap #15 fire-and-forget events. @Optional so unit
    // tests instantiating the service without the bus still load.
    @Optional()
    private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Phase 160 (e-way-bill audit B4) — the `eway_bill_enabled` kill switch.
   * Defaults to TRUE when the flag is absent (the seed ships it true; EWB
   * enforcement is on by default) — only an explicit `false` disables
   * generation. `!== false` also tolerates a config-read returning
   * undefined (unit-test mocks), keeping the default-on behaviour.
   */
  async isEnabled(): Promise<boolean> {
    // getBoolean returns the `true` fallback for a missing config row, so the
    // only way this throws is a hard config-store failure — which we let
    // PROPAGATE (fail-loud) rather than swallow. Swallowing to `true` would
    // bypass an operator's explicit `false`; swallowing to `false` would halt
    // all EWB generation on a transient blip. Propagating fails just this
    // attempt transparently, so neither the flag's intent nor availability is
    // silently compromised.
    const v = await this.taxConfig.getBoolean('eway_bill_enabled' as any, true);
    return v !== false;
  }

  /**
   * Phase 89 (2026-05-23) — Gap #5 chain of custody helper.
   * Append-only audit log row for every EWB lifecycle action.
   */
  private async writeAuditLog(args: {
    ewayBillId: string;
    action: string;
    fromStatus?: EWayBillStatus | null;
    toStatus?: EWayBillStatus | null;
    actorId?: string | null;
    actorRole?: string | null;
    reason?: string | null;
    payloadBefore?: unknown;
    payloadAfter?: unknown;
    ipAddress?: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = (args.tx ?? this.prisma) as any;
    await client.eWayBillAuditLog.create({
      data: {
        ewayBillId: args.ewayBillId,
        action: args.action,
        fromStatus: args.fromStatus ?? null,
        toStatus: args.toStatus ?? null,
        actorId: args.actorId ?? null,
        actorRole: args.actorRole ?? null,
        reason: args.reason ?? null,
        payloadBefore: (args.payloadBefore as any) ?? null,
        payloadAfter: (args.payloadAfter as any) ?? null,
        ipAddress: args.ipAddress ?? null,
      },
    });
  }

  /**
   * Phase 89 (2026-05-23) — Gap #15 event emission helper. Fire-and-
   * forget; never blocks the service path on the bus.
   */
  private emit(eventName: string, payload: Record<string, unknown>): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'EWayBill',
        aggregateId: String(payload.ewayBillId ?? payload.subOrderId ?? ''),
        occurredAt: new Date(),
        payload,
      })
      .catch(() => undefined);
  }

  /**
   * Compute the consignment value for a sub-order. Prefers the linked
   * tax_document's totalDocumentInPaise (post-discount, includes GST +
   * shipping). Falls back to summing OrderItem.totalPriceInPaise when
   * no invoice exists yet (early classification before invoice).
   */
  private async computeConsignmentValue(
    subOrderId: string,
  ): Promise<{
    value: bigint;
    taxDocumentId: string | null;
    supplierGstin: string | null;
    invoiceDocumentNumber: string | null;
    invoiceDate: Date | null;
  }> {
    const invoice = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId,
        documentType: {
          in: [
            'TAX_INVOICE',
            'BILL_OF_SUPPLY',
            'INVOICE_CUM_BILL_OF_SUPPLY',
          ],
        },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        documentNumber: true,
        documentTotalInPaise: true,
        supplierGstin: true,
        generatedAt: true,
      },
    });
    if (invoice) {
      return {
        value: invoice.documentTotalInPaise,
        taxDocumentId: invoice.id,
        supplierGstin: invoice.supplierGstin,
        invoiceDocumentNumber: invoice.documentNumber,
        invoiceDate: invoice.generatedAt,
      };
    }
    // Pre-invoice path: sum line items.
    const items = await this.prisma.orderItem.findMany({
      where: { subOrderId },
      select: { totalPriceInPaise: true },
    });
    const sum = items.reduce((acc, it) => acc + it.totalPriceInPaise, 0n);
    return {
      value: sum,
      taxDocumentId: null,
      supplierGstin: null,
      invoiceDocumentNumber: null,
      invoiceDate: null,
    };
  }

  /**
   * Classify the sub-order: create the EWayBill row in the appropriate
   * starting status. Idempotent.
   */
  async classifyForSubOrder(subOrderId: string): Promise<ClassifyResult> {
    const existing = await this.prisma.eWayBill.findFirst({
      where: { subOrderId, status: { not: 'CANCELLED' } },
    });

    // Phase 89 (2026-05-23) — Gap #3 / #18. Resolve addresses FIRST
    // so the per-state threshold + HSN inter-state rule can short-
    // circuit before the row commits.
    const addresses = await this.resolveAddresses(subOrderId);
    const threshold = await this.resolvePolicyThreshold({
      fromStateCode: addresses.fromStateCode,
      toStateCode: addresses.toStateCode,
    });
    // Phase 29 — intra-state distance exemption. CBIC + Sportsmart's
    // HSN spec carve out intra-state movements at or below this
    // distance from the EWB requirement, even when the consignment
    // value clears the headline threshold.
    const intraStateThresholdKm = await this.taxConfig.getNumber(
      'eway_bill_intra_state_distance_threshold_km',
      10,
    );
    const { value, taxDocumentId, supplierGstin } =
      await this.computeConsignmentValue(subOrderId);
    let required = value > BigInt(threshold);
    // Phase 89 — Gap #5. Inter-state EWB at any value for notified
    // HSN classes. The check only kicks in when from/to state codes
    // are both resolved AND differ; same-state movement remains
    // governed by the headline threshold.
    let interStateHsnRuleApplied = false;
    if (
      !required &&
      addresses.fromStateCode &&
      addresses.toStateCode &&
      addresses.fromStateCode !== addresses.toStateCode
    ) {
      const hsnForces = await this.hsnForcesInterStateEwb(
        taxDocumentId,
        subOrderId,
      );
      if (hsnForces) {
        required = true;
        interStateHsnRuleApplied = true;
      }
    }

    if (existing) {
      // Idempotent — return current row but allow status flips on
      // re-classify when the invoice value or addresses change. The
      // forward path (NOT_REQUIRED → REQUIRED) is unchanged; the
      // reverse path (REQUIRED → NOT_REQUIRED) closes Gap #14 by
      // letting a downward value revision / late state-code resolution
      // downgrade the row when the new decision says no EWB is needed.
      if (existing.status === 'NOT_REQUIRED' && required) {
        const updated = await this.prisma.eWayBill.update({
          where: { id: existing.id },
          data: {
            status: 'REQUIRED',
            consignmentValueInPaise: value,
            taxDocumentId,
            supplierGstin,
            thresholdAppliedInPaise: BigInt(threshold),
            policyVersion: EWayBillService.POLICY_VERSION,
          },
        });
        await this.writeAuditLog({
          ewayBillId: existing.id,
          action: 'RECLASSIFY_UPGRADE',
          fromStatus: 'NOT_REQUIRED',
          toStatus: 'REQUIRED',
          actorId: 'system',
          actorRole: 'SYSTEM',
          reason: `value ${value} > threshold ${threshold}`,
        });
        this.emit(EWAY_BILL_EVENTS.CLASSIFIED, {
          ewayBillId: existing.id,
          subOrderId,
          status: 'REQUIRED',
          consignmentValueInPaise: value.toString(),
        });
        return {
          row: updated,
          required: true,
          thresholdPaise: threshold,
          consignmentValueInPaise: value,
        };
      }
      // Phase 89 — Gap #14 reverse re-classification. A REQUIRED row
      // can downgrade to NOT_REQUIRED if (a) the value dropped below
      // threshold, OR (b) addresses resolved and the intra-state ≤
      // exemption applies. Only flips from REQUIRED — once the
      // provider was called (PENDING / GENERATED / FAILED / EXPIRED)
      // the row is locked.
      if (
        existing.status === 'REQUIRED' &&
        !required &&
        // No override should be lost on downgrade — admins overriding
        // a REQUIRED row are owning the ship, not asking for a
        // re-classification. Skip the flip if an override is active.
        !existing.overrideAdminId
      ) {
        const updated = await this.prisma.eWayBill.update({
          where: { id: existing.id },
          data: {
            status: 'NOT_REQUIRED',
            consignmentValueInPaise: value,
            taxDocumentId,
            supplierGstin,
            thresholdAppliedInPaise: BigInt(threshold),
            policyVersion: EWayBillService.POLICY_VERSION,
          },
        });
        await this.writeAuditLog({
          ewayBillId: existing.id,
          action: 'RECLASSIFY_DOWNGRADE',
          fromStatus: 'REQUIRED',
          toStatus: 'NOT_REQUIRED',
          actorId: 'system',
          actorRole: 'SYSTEM',
          reason: `value ${value} <= threshold ${threshold} (re-classify)`,
        });
        this.emit(EWAY_BILL_EVENTS.CLASSIFIED, {
          ewayBillId: existing.id,
          subOrderId,
          status: 'NOT_REQUIRED',
          consignmentValueInPaise: value.toString(),
        });
        return {
          row: updated,
          required: false,
          thresholdPaise: threshold,
          consignmentValueInPaise: value,
        };
      }
      return {
        row: existing,
        required: existing.status !== 'NOT_REQUIRED',
        thresholdPaise: threshold,
        consignmentValueInPaise: existing.consignmentValueInPaise,
      };
    }

    // Phase 29 — intra-state sub-threshold-distance check. Only fires
    // when (a) value already cleared the headline EWB threshold and
    // (b) both state codes resolved. When the addresses stub still
    // returns nulls (current state — Phase 25 admin retry fills them),
    // the helper short-circuits with `exempt=false` so we stay
    // conservative. When data IS available, an intra-state ≤ threshold
    // consignment gets flipped to NOT_REQUIRED with the distance
    // persisted on the row for the audit trail.
    let computedDistanceKm: number | null = null;
    let intraStateExemptApplied = false;
    if (
      required &&
      addresses.fromStateCode &&
      addresses.toStateCode &&
      addresses.fromStateCode === addresses.toStateCode
    ) {
      computedDistanceKm = await this.computeGeodesicDistanceKm(
        addresses.fromPincode,
        addresses.toPincode,
      );
      const decision = isIntraStateUnderThreshold({
        fromStateCode: addresses.fromStateCode,
        toStateCode: addresses.toStateCode,
        distanceKm: computedDistanceKm,
        thresholdKm: intraStateThresholdKm,
      });
      if (decision.exempt) {
        required = false;
        intraStateExemptApplied = true;
      } else if (decision.distanceMissing) {
        // Intra-state but we couldn't pin down the distance — stay
        // pessimistic. The PostOffice coords backfill (or the
        // generate-time distance input from the seller's transporter)
        // will let a subsequent classifyForSubOrder call flip this.
        this.logger.warn(
          `Intra-state EWB classification for sub-order ${subOrderId} could ` +
            `not determine distance (missing pincode geo); staying REQUIRED.`,
        );
      }
    }

    const created = await this.prisma.eWayBill.create({
      data: {
        subOrderId,
        taxDocumentId,
        supplierGstin,
        provider: this.provider.name,
        consignmentValueInPaise: value,
        status: required ? 'REQUIRED' : 'NOT_REQUIRED',
        fromPincode: addresses.fromPincode,
        fromStateCode: addresses.fromStateCode,
        toPincode: addresses.toPincode,
        toStateCode: addresses.toStateCode,
        // Persist the geodesic distance so the audit log captures
        // *why* the row landed as NOT_REQUIRED (and so admins
        // reviewing the row can sanity-check the math).
        distanceKm:
          computedDistanceKm != null
            ? Math.round(computedDistanceKm)
            : undefined,
        // Phase 89 — Gap #24. Threshold + policy snapshot for
        // reproducibility.
        thresholdAppliedInPaise: BigInt(threshold),
        policyVersion: EWayBillService.POLICY_VERSION,
      },
    });
    await this.writeAuditLog({
      ewayBillId: created.id,
      action: 'CLASSIFY',
      toStatus: created.status,
      actorId: 'system',
      actorRole: 'SYSTEM',
      reason: required
        ? interStateHsnRuleApplied
          ? 'inter-state HSN-at-any-value rule applied'
          : `value ${value} > threshold ${threshold}`
        : intraStateExemptApplied
          ? `intra-state ≤ ${intraStateThresholdKm}km exemption`
          : `value ${value} <= threshold ${threshold}`,
      payloadAfter: {
        consignmentValueInPaise: value.toString(),
        thresholdAppliedInPaise: threshold,
        fromStateCode: addresses.fromStateCode,
        toStateCode: addresses.toStateCode,
        interStateHsnRuleApplied,
        intraStateExemptApplied,
      },
    });
    this.emit(EWAY_BILL_EVENTS.CLASSIFIED, {
      ewayBillId: created.id,
      subOrderId,
      status: created.status,
      consignmentValueInPaise: value.toString(),
      interStateHsnRuleApplied,
    });
    this.logger.log(
      `EWB classified for sub-order ${subOrderId}: status=${created.status} ` +
        `(consignment ${value.toString()} paise, threshold ${threshold}` +
        (intraStateExemptApplied
          ? `, intra-state ≤ ${intraStateThresholdKm}km exemption applied`
          : '') +
        (interStateHsnRuleApplied
          ? ', inter-state HSN-at-any-value rule applied'
          : '') +
        ')',
    );
    return {
      row: created,
      required,
      thresholdPaise: threshold,
      consignmentValueInPaise: value,
    };
  }

  /**
   * Look up pincode coordinates from `PostOffice` and compute the
   * great-circle distance between the consignor and consignee. Returns
   * null when either pincode is missing OR the post-office row doesn't
   * carry lat/lon (legacy seed data without geo enrichment).
   *
   * Geodesic distance is an approximation — real road distance is
   * typically up to ~30% longer — but for the 10km gate the
   * conservative reading is what we want.
   */
  private async computeGeodesicDistanceKm(
    fromPincode: string | null,
    toPincode: string | null,
  ): Promise<number | null> {
    if (!fromPincode || !toPincode) return null;
    // Same pincode short-circuit — no DB read needed, distance is
    // effectively zero so the exemption clearly applies.
    if (fromPincode === toPincode) return 0;
    const rows = await this.prisma.postOffice.findMany({
      where: { pincode: { in: [fromPincode, toPincode] } },
      select: { pincode: true, latitude: true, longitude: true },
    });
    const from = rows.find((r) => r.pincode === fromPincode);
    const to = rows.find((r) => r.pincode === toPincode);
    if (
      !from ||
      !to ||
      from.latitude == null ||
      from.longitude == null ||
      to.latitude == null ||
      to.longitude == null
    ) {
      return null;
    }
    const dist = haversineKm(
      Number(from.latitude),
      Number(from.longitude),
      Number(to.latitude),
      Number(to.longitude),
    );
    return Number.isFinite(dist) ? dist : null;
  }

  /**
   * Call the provider to generate the EWB number. Persists number +
   * validity + raw payloads. Idempotent on GENERATED rows.
   */
  async generate(
    subOrderId: string,
    details: GenerateTransportDetails = {},
  ): Promise<EWayBill> {
    // Phase 160 (audit B4) — the kill switch gates the provider call. A
    // disabled platform never mints; the REQUIRED row stays REQUIRED and
    // canShip blocks it (forcing an audited override to dispatch).
    if (!(await this.isEnabled())) {
      throw new EWayBillDisabledError(subOrderId);
    }
    // Ensure classification has run.
    const { row, required } = await this.classifyForSubOrder(subOrderId);
    if (!required) {
      throw new Error(
        `Sub-order ${subOrderId} is below the EWB threshold; no EWB needed.`,
      );
    }
    if (row.status === 'GENERATED') {
      // Idempotent — already issued.
      return row;
    }
    if (row.status === 'CANCELLED') {
      throw new EWayBillNotEligibleError(row.id, row.status, 'generate');
    }

    // Phase 160 (audit #16) — re-resolve addresses at generate time if the
    // classify-time row is missing any leg (e.g. the shipping snapshot or
    // warehouse pincode landed AFTER classification ran). Without this the
    // row inherits the classify-time nulls and the NIC payload would be
    // rejected for a missing consignor/consignee address.
    const addressPatch: {
      fromPincode?: string;
      fromStateCode?: string;
      toPincode?: string;
      toStateCode?: string;
    } = {};
    if (!row.fromStateCode || !row.toStateCode || !row.fromPincode || !row.toPincode) {
      const addr = await this.resolveAddresses(subOrderId);
      // Only FILL a currently-null leg with a freshly-resolved non-null
      // value. Never include a field that's already set (no overwrite) or
      // one that resolves to null again (no null→null churn) — so the
      // spread can only ever ADD missing addresses, never clear good ones.
      if (!row.fromPincode && addr.fromPincode) addressPatch.fromPincode = addr.fromPincode;
      if (!row.fromStateCode && addr.fromStateCode) addressPatch.fromStateCode = addr.fromStateCode;
      if (!row.toPincode && addr.toPincode) addressPatch.toPincode = addr.toPincode;
      if (!row.toStateCode && addr.toStateCode) addressPatch.toStateCode = addr.toStateCode;
    }

    // Phase 89 — Gap #21 TOCTOU lock. Row lock keeps a concurrent
    // cancel / re-classify from racing the provider call. Gap #20 —
    // lock the provider name at generate time (not classify time)
    // so a stub→nic env flip doesn't mis-tag the row's provenance.
    const pending = await this.prisma.$transaction(async (tx) => {
      // SELECT ... FOR UPDATE on the row id.
      await tx.$queryRaw`SELECT id FROM e_way_bills WHERE id = ${row.id} FOR UPDATE`;
      // Re-read under the lock — defends against a race where another
      // tx cancelled the row between the classify check and here.
      const fresh = await tx.eWayBill.findUnique({ where: { id: row.id } });
      if (!fresh) {
        throw new EWayBillNotFoundError(row.id);
      }
      if (fresh.status === 'CANCELLED') {
        throw new EWayBillNotEligibleError(fresh.id, fresh.status, 'generate');
      }
      if (fresh.status === 'GENERATED') {
        // Lost a race — another tx generated under the lock. Return
        // the already-issued row as the idempotent outcome.
        return fresh;
      }
      return tx.eWayBill.update({
        where: { id: row.id },
        data: {
          status: 'PENDING',
          // Phase 89 — lock provider name at generate time.
          provider: this.provider.name,
          transportMode: details.transportMode ?? fresh.transportMode,
          vehicleNumber: details.vehicleNumber ?? fresh.vehicleNumber,
          transporterId: details.transporterId ?? fresh.transporterId,
          transporterName: details.transporterName ?? fresh.transporterName,
          distanceKm: details.distanceKm ?? fresh.distanceKm,
          // Phase 160 (audit #16) — apply any re-resolved addresses.
          ...addressPatch,
        },
      });
    });

    if (pending.status === 'GENERATED') {
      // Already-issued idempotent return from the lock branch above.
      return pending;
    }

    // Fetch invoice context (best-effort) for the provider payload.
    let invoiceDocumentNumber: string | null = null;
    let invoiceDate: Date | null = null;
    let lineItems:
      | Array<{
          productName: string;
          hsnOrSacCode: string | null;
          quantity: number;
          uqcCode: string | null;
          taxableAmountInPaise: bigint;
          gstRateBps: number;
        }>
      | undefined;
    if (pending.taxDocumentId) {
      const doc = await this.prisma.taxDocument.findUnique({
        where: { id: pending.taxDocumentId },
        select: { documentNumber: true, generatedAt: true, lines: true },
      });
      if (doc) {
        invoiceDocumentNumber = doc.documentNumber;
        invoiceDate = doc.generatedAt;
        lineItems = doc.lines.map((l) => ({
          productName: l.productName,
          hsnOrSacCode: l.hsnOrSacCode,
          quantity: Number(l.quantity),
          uqcCode: l.uqcCode,
          taxableAmountInPaise: l.taxableAmountInPaise,
          gstRateBps: l.gstRateBps,
        }));
      }
    }

    // Phase 89 (2026-05-23) — Gap #12 NIC requirement check.
    // NIC's e-Waybill API rejects payloads with missing HSN/UQC/qty.
    // Pre-Phase-89 the stub silently accepted; switching to nic would
    // crash at runtime. Validate the line items shape BEFORE the
    // provider call so the error surfaces with a useful message.
    if (this.provider.name === 'nic') {
      if (!lineItems || lineItems.length === 0) {
        throw new Error(
          `EWB generate requires line items (HSN + UQC + qty) for NIC provider; sub-order ${subOrderId} has none on file.`,
        );
      }
      for (const li of lineItems) {
        if (!li.hsnOrSacCode || li.hsnOrSacCode.trim().length < 4) {
          throw new Error(
            `EWB generate requires HSN ≥ 4 digits on every line for NIC provider (got "${li.hsnOrSacCode}")`,
          );
        }
        if (!li.uqcCode || li.uqcCode.trim().length === 0) {
          throw new Error(
            `EWB generate requires UQC on every line for NIC provider (line "${li.productName}")`,
          );
        }
        if (!Number.isFinite(li.quantity) || li.quantity <= 0) {
          throw new Error(
            `EWB generate requires positive quantity on every line for NIC provider (line "${li.productName}" qty=${li.quantity})`,
          );
        }
      }
    }

    try {
      const result = await this.provider.generate({
        supplierGstin: pending.supplierGstin,
        invoiceDocumentNumber,
        invoiceDate,
        fromPincode: pending.fromPincode,
        fromStateCode: pending.fromStateCode,
        toPincode: pending.toPincode,
        toStateCode: pending.toStateCode,
        distanceKm: pending.distanceKm,
        consignmentValueInPaise: pending.consignmentValueInPaise,
        transportMode: pending.transportMode,
        vehicleNumber: pending.vehicleNumber,
        transporterId: pending.transporterId,
        transporterName: pending.transporterName,
        items: lineItems,
      });

      // Phase 89 — Gap #19 retention. CBIC requires 3 years
      // post-issuance; persist the deletion deadline on the row.
      const retentionDays = await this.taxConfig.getNumber(
        'eway_bill_raw_payload_retention_days',
        3 * 365,
      );
      const retentionExpiresAt = new Date(
        Date.now() + retentionDays * 24 * 60 * 60 * 1000,
      );
      const updated = await this.prisma.eWayBill.update({
        where: { id: pending.id },
        data: {
          status: 'GENERATED',
          ewbNumber: result.ewbNumber,
          ewbDate: result.ewbDate,
          validUntil: result.validUntil,
          rawRequestJson: result.rawRequestJson as Prisma.InputJsonValue,
          rawResponseJson: result.rawResponseJson as Prisma.InputJsonValue,
          failureReason: null,
          retentionExpiresAt,
          nicAckNo: (result as any).nicAckNo ?? null,
          nicAckDate: (result as any).nicAckDate ?? null,
        },
      });
      await this.writeAuditLog({
        ewayBillId: updated.id,
        action: 'GENERATE',
        fromStatus: 'PENDING',
        toStatus: 'GENERATED',
        actorId: 'system',
        actorRole: 'SYSTEM',
        payloadAfter: {
          ewbNumber: result.ewbNumber,
          validUntil: result.validUntil.toISOString(),
          provider: this.provider.name,
        },
      });
      this.emit(EWAY_BILL_EVENTS.GENERATED, {
        ewayBillId: updated.id,
        subOrderId,
        ewbNumber: result.ewbNumber,
        validUntil: result.validUntil.toISOString(),
      });
      this.logger.log(
        `EWB ${result.ewbNumber} issued for sub-order ${subOrderId} via ` +
          `${this.provider.name} provider (valid until ${result.validUntil.toISOString()})`,
      );
      return updated;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const failed = await this.prisma.eWayBill.update({
        where: { id: pending.id },
        data: {
          status: 'FAILED',
          failureReason: message,
          retryCount: { increment: 1 },
        },
      });
      await this.writeAuditLog({
        ewayBillId: failed.id,
        action: 'GENERATE_FAILED',
        fromStatus: 'PENDING',
        toStatus: 'FAILED',
        actorId: 'system',
        actorRole: 'SYSTEM',
        reason: message,
        payloadAfter: { retryCount: failed.retryCount },
      });
      this.emit(EWAY_BILL_EVENTS.FAILED, {
        ewayBillId: failed.id,
        subOrderId,
        retryCount: failed.retryCount,
        reason: message,
      });
      this.logger.warn(
        `EWB generation FAILED for sub-order ${subOrderId} (attempt ${failed.retryCount}): ${message}`,
      );
      throw err;
    }
  }

  /**
   * Cancel an issued EWB. Enforces the 24-hour CBIC window.
   */
  async cancel(args: {
    ewbId: string;
    cancelledBy: string;
    reason: string;
    now?: Date;
  }): Promise<EWayBill> {
    const ewb = await this.prisma.eWayBill.findUnique({
      where: { id: args.ewbId },
    });
    if (!ewb) throw new EWayBillNotFoundError(args.ewbId);
    if (ewb.status === 'CANCELLED') return ewb; // idempotent
    // Phase 160 (audit B1) — re-drive a cancel that got stuck (the
    // CANCELLATION_PENDING marker was written but the provider call or the
    // settle write didn't complete) or failed. The NIC cancel is idempotent
    // so retrying is safe; this is also how the reconcile cron heals drift.
    if (ewb.status === 'CANCELLATION_PENDING' || ewb.status === 'CANCELLATION_FAILED') {
      if (!ewb.ewbNumber) {
        throw new Error(`EWayBill ${ewb.id} is ${ewb.status} but missing ewbNumber.`);
      }
      return this.driveCancelToCompletion(
        ewb,
        args.cancelledBy,
        ewb.cancellationReason ?? args.reason,
      );
    }
    if (ewb.status !== 'GENERATED') {
      throw new EWayBillNotEligibleError(ewb.id, ewb.status, 'cancel');
    }
    if (!ewb.ewbDate || !ewb.ewbNumber) {
      throw new Error(
        `EWayBill ${ewb.id} is GENERATED but missing ewbDate/ewbNumber.`,
      );
    }

    const now = args.now ?? new Date();
    const ageMs = now.getTime() - ewb.ewbDate.getTime();
    // Phase 160 (#9/#10) — reject at the (skew-adjusted) boundary with `>=`.
    if (
      ageMs >=
      EWayBillService.CANCELLATION_WINDOW_MS -
        EWayBillService.CANCELLATION_SAFETY_MARGIN_MS
    ) {
      throw new EWayBillCancellationWindowClosedError(ewb.id, ewb.ewbDate);
    }

    // Phase 89 (2026-05-23) — Cancel post-delivery block. CBIC FAQ
    // explicitly disallows cancellation of an EWB after the consignor
    // confirms delivery.
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: ewb.subOrderId },
      select: { fulfillmentStatus: true },
    });
    if (sub?.fulfillmentStatus === 'DELIVERED') {
      throw new EWayBillNotEligibleError(ewb.id, ewb.status, 'cancel');
    }

    // Phase 160 (audit B1) — PHASE 1: mark CANCELLATION_PENDING BEFORE the
    // provider call. If the process dies between here and the settle write,
    // the row carries a recoverable marker (the reconcile cron re-drives
    // it) instead of silently staying GENERATED while NIC says cancelled.
    const pendingRow = await this.prisma.eWayBill.update({
      where: { id: ewb.id },
      data: {
        status: 'CANCELLATION_PENDING',
        cancelInitiatedAt: now,
        cancelInitiatedBy: args.cancelledBy,
        cancellationReason: args.reason,
      },
    });
    await this.writeAuditLog({
      ewayBillId: ewb.id,
      action: 'CANCEL_INITIATED',
      fromStatus: 'GENERATED',
      toStatus: 'CANCELLATION_PENDING',
      actorId: args.cancelledBy,
      actorRole: 'ADMIN',
      reason: args.reason,
    });

    // PHASE 2: provider call + settle.
    return this.driveCancelToCompletion(pendingRow, args.cancelledBy, args.reason);
  }

  /**
   * Phase 160 (audit B1) — PHASE 2 of the two-phase cancel. Calls the
   * provider (idempotent at NIC) and settles the row to CANCELLED on
   * success, or CANCELLATION_FAILED on provider error (the reconcile cron
   * retries failed rows). Shared by the direct cancel path and the cron.
   */
  private async driveCancelToCompletion(
    ewb: EWayBill,
    cancelledBy: string,
    reason: string,
  ): Promise<EWayBill> {
    let result;
    try {
      result = await this.provider.cancel({
        ewbNumber: ewb.ewbNumber!,
        reason,
      });
    } catch (err) {
      const failed = await this.prisma.eWayBill.update({
        where: { id: ewb.id },
        data: {
          status: 'CANCELLATION_FAILED',
          failureReason: (err as Error).message ?? String(err),
        },
      });
      await this.writeAuditLog({
        ewayBillId: ewb.id,
        action: 'CANCEL_FAILED',
        fromStatus: ewb.status,
        toStatus: 'CANCELLATION_FAILED',
        actorId: cancelledBy,
        actorRole: 'ADMIN',
        reason: (err as Error).message ?? String(err),
      });
      void failed;
      throw err;
    }

    const cancelled = await this.prisma.eWayBill.update({
      where: { id: ewb.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: result.cancelledAt,
        cancelledBy,
        cancellationReason: reason,
        // Phase 160 (#7) — queryable cancel reference.
        providerCancelReference: result.providerCancelReference ?? null,
        // Phase 160 (#8) — keep the cancel response SEPARATE; never clobber
        // the original generate response in rawResponseJson.
        rawCancelResponseJson: result.rawResponseJson as Prisma.InputJsonValue,
      },
    });
    await this.writeAuditLog({
      ewayBillId: ewb.id,
      action: 'CANCEL',
      fromStatus: ewb.status,
      toStatus: 'CANCELLED',
      actorId: cancelledBy,
      actorRole: 'ADMIN',
      reason,
    });
    this.emit(EWAY_BILL_EVENTS.CANCELLED, {
      ewayBillId: ewb.id,
      subOrderId: ewb.subOrderId,
      ewbNumber: ewb.ewbNumber,
      cancelledBy,
      reason,
    });
    return cancelled;
  }

  /**
   * Phase 160 (e-way-bill audit #18) — update Part-B (transport details) on
   * an ISSUED EWB without cancelling it. NIC's Part-B update covers a
   * vehicle change / trans-shipment and RE-ISSUES the validity. Only
   * GENERATED rows are eligible. Audited + emits PART_B_UPDATED.
   */
  async updateTransportDetails(args: {
    ewbId: string;
    actorId: string;
    reason: string;
    transportMode?: EWayBillTransportMode;
    vehicleNumber?: string | null;
    transporterId?: string | null;
    transporterName?: string | null;
    distanceKm?: number | null;
  }): Promise<EWayBill> {
    const reason = (args.reason ?? '').trim();
    if (reason.length < 3) {
      throw new Error('A Part-B update reason (min 3 characters) is required.');
    }
    const ewb = await this.prisma.eWayBill.findUnique({
      where: { id: args.ewbId },
    });
    if (!ewb) throw new EWayBillNotFoundError(args.ewbId);
    if (ewb.status !== 'GENERATED' || !ewb.ewbNumber) {
      // Part-B updates only apply to a live, issued EWB.
      throw new EWayBillNotEligibleError(ewb.id, ewb.status, 'generate');
    }
    const transportMode = args.transportMode ?? ewb.transportMode;
    // ROAD requires a vehicle number per CBIC.
    const vehicleNumber =
      args.vehicleNumber !== undefined ? args.vehicleNumber : ewb.vehicleNumber;
    if (transportMode === 'ROAD' && !vehicleNumber) {
      throw new Error('vehicleNumber is required for ROAD transport.');
    }

    const result = await this.provider.updatePartB({
      ewbNumber: ewb.ewbNumber,
      transportMode,
      vehicleNumber: vehicleNumber ?? null,
      transporterId:
        args.transporterId !== undefined ? args.transporterId : ewb.transporterId,
      transporterName:
        args.transporterName !== undefined
          ? args.transporterName
          : ewb.transporterName,
      distanceKm: args.distanceKm !== undefined ? args.distanceKm : ewb.distanceKm,
      reason,
    });

    const updated = await this.prisma.eWayBill.update({
      where: { id: ewb.id },
      data: {
        transportMode,
        vehicleNumber: vehicleNumber ?? null,
        transporterId:
          args.transporterId !== undefined ? args.transporterId : ewb.transporterId,
        transporterName:
          args.transporterName !== undefined
            ? args.transporterName
            : ewb.transporterName,
        distanceKm: args.distanceKm !== undefined ? args.distanceKm : ewb.distanceKm,
        // NIC re-issues validity on a Part-B update.
        validUntil: result.validUntil,
        rawResponseJson: result.rawResponseJson as Prisma.InputJsonValue,
      },
    });
    await this.writeAuditLog({
      ewayBillId: ewb.id,
      action: 'UPDATE_PART_B',
      fromStatus: 'GENERATED',
      toStatus: 'GENERATED',
      actorId: args.actorId,
      actorRole: 'ADMIN',
      reason,
    });
    this.emit(EWAY_BILL_EVENTS.PART_B_UPDATED, {
      ewayBillId: ewb.id,
      subOrderId: ewb.subOrderId,
      ewbNumber: ewb.ewbNumber,
      vehicleNumber: vehicleNumber ?? null,
      updatedBy: args.actorId,
      reason,
    });
    return updated;
  }

  /**
   * Phase 89 (2026-05-23) — Gap #7/#8/#9/#26 hardened override.
   *
   * Admin override — allow ship despite EWB being REQUIRED / FAILED.
   * Mutations:
   *   • status → OVERRIDDEN (Gap #8). Pre-Phase-89 the status field
   *     was left at REQUIRED/FAILED; the admin queue showed a misleading
   *     "still needs work" row even though canShip allowed it.
   *   • reasonCategory required (Gap #26). Enum closes the "ok" free-
   *     text loophole; the controller enforces a 20+ char free-text
   *     justification when category=OTHER.
   *   • High-value separation-of-duty (Gap #9). For consignments above
   *     ₹2L the override actor must differ from any prior generate /
   *     classify actor on the row. The controller layer enforces the
   *     `tax.ewayBill.override.superAdmin` permission for the same
   *     value bucket.
   *   • Audit log row + event emission (Gap #5/#15).
   */
  async adminOverride(args: {
    ewbId: string;
    adminId: string;
    reason: string;
    reasonCategory: EWayBillOverrideReasonCategory;
  }): Promise<EWayBill> {
    const ewb = await this.prisma.eWayBill.findUnique({
      where: { id: args.ewbId },
    });
    if (!ewb) throw new EWayBillNotFoundError(args.ewbId);
    if (ewb.status === 'NOT_REQUIRED') {
      // Phase 160 (audit #13) — overriding a NOT_REQUIRED EWB is meaningless
      // (there's no ship-permission to bypass). Make it an EXPLICIT error
      // (consistent with the GENERATED/CANCELLED rejection below) instead of
      // a silent no-op the UI might read as success.
      throw new EWayBillNotEligibleError(ewb.id, ewb.status, 'generate');
    }
    if (ewb.status === 'GENERATED' || ewb.status === 'CANCELLED') {
      // Override only makes sense for REQUIRED / FAILED / EXPIRED /
      // OVERRIDDEN rows. Generated rows don't need ship-permission
      // bypass; cancelled rows shouldn't be overridable at all.
      throw new EWayBillNotEligibleError(ewb.id, ewb.status, 'generate');
    }
    // Phase 89 — Gap #9. Separation of duty for high-value overrides.
    // Block the override when the requester also generated the row
    // (or any prior audit entry on the row) — dual-actor requirement.
    if (
      ewb.consignmentValueInPaise > BigInt(EWayBillService.OVERRIDE_HIGH_VALUE_PAISE)
    ) {
      const priorActor = await (this.prisma as any).eWayBillAuditLog.findFirst({
        where: {
          ewayBillId: ewb.id,
          actorId: args.adminId,
          action: { in: ['CLASSIFY', 'GENERATE', 'GENERATE_FAILED'] },
        },
        select: { id: true },
      });
      if (priorActor) {
        throw new Error(
          'High-value override requires a different admin than the one who classified/generated the EWB (separation of duty).',
        );
      }
    }

    const updated = await this.prisma.eWayBill.update({
      where: { id: ewb.id },
      data: {
        status: 'OVERRIDDEN',
        // Phase 160 (audit #2) — remember the status we overrode FROM so
        // reports show what was bypassed + a revoke restores it accurately.
        // Re-overriding an already-OVERRIDDEN row keeps the ORIGINAL.
        preOverrideStatus:
          ewb.status === 'OVERRIDDEN' ? ewb.preOverrideStatus : ewb.status,
        overrideAdminId: args.adminId,
        overrideAt: new Date(),
        overrideReason: args.reason,
        overrideReasonCategory: args.reasonCategory,
        // Clear any prior revoke trail — re-applying an override after
        // a revoke is a legitimate flow (e.g., admin investigated the
        // root cause + decided to ship anyway). Audit log preserves
        // the full history.
        overrideRevokedAt: null,
        overrideRevokedBy: null,
        overrideRevokeReason: null,
      },
    });
    await this.writeAuditLog({
      ewayBillId: ewb.id,
      action: 'OVERRIDE',
      fromStatus: ewb.status,
      toStatus: 'OVERRIDDEN',
      actorId: args.adminId,
      actorRole: 'ADMIN',
      reason: args.reason,
      payloadAfter: { reasonCategory: args.reasonCategory },
    });
    this.emit(EWAY_BILL_EVENTS.OVERRIDDEN, {
      ewayBillId: ewb.id,
      subOrderId: ewb.subOrderId,
      adminId: args.adminId,
      reasonCategory: args.reasonCategory,
      consignmentValueInPaise: ewb.consignmentValueInPaise.toString(),
    });
    return updated;
  }

  /**
   * Phase 89 (2026-05-23) — Gap #7 revoke. Returns an OVERRIDDEN row
   * back to REQUIRED so the seller cannot ship without either a real
   * EWB or a fresh override. Audit log preserves the revoke trail.
   */
  async revokeOverride(args: {
    ewbId: string;
    adminId: string;
    reason: string;
  }): Promise<EWayBill> {
    const ewb = await this.prisma.eWayBill.findUnique({
      where: { id: args.ewbId },
    });
    if (!ewb) throw new EWayBillNotFoundError(args.ewbId);
    if (ewb.status !== 'OVERRIDDEN') {
      throw new EWayBillNotEligibleError(ewb.id, ewb.status, 'generate');
    }
    // Phase 160 (audit #2) — restore the EXACT status the override masked
    // (REQUIRED / FAILED / EXPIRED), not a hardcoded REQUIRED.
    const restoredStatus = ewb.preOverrideStatus ?? 'REQUIRED';
    const updated = await this.prisma.eWayBill.update({
      where: { id: ewb.id },
      data: {
        status: restoredStatus,
        preOverrideStatus: null,
        overrideRevokedAt: new Date(),
        overrideRevokedBy: args.adminId,
        overrideRevokeReason: args.reason,
      },
    });
    await this.writeAuditLog({
      ewayBillId: ewb.id,
      action: 'REVOKE_OVERRIDE',
      fromStatus: 'OVERRIDDEN',
      toStatus: restoredStatus,
      actorId: args.adminId,
      actorRole: 'ADMIN',
      reason: args.reason,
    });
    this.emit(EWAY_BILL_EVENTS.OVERRIDE_REVOKED, {
      ewayBillId: ewb.id,
      subOrderId: ewb.subOrderId,
      adminId: args.adminId,
      reason: args.reason,
    });
    return updated;
  }

  /**
   * Seller-side ship guard. Returns true when the sub-order is clear
   * to dispatch (no EWB needed, EWB issued, or admin override in place).
   *
   * Phase 89 (2026-05-23) — Gap #4. Now invoked from the SHIPPED
   * transition in orders.service.ts so the gate is actually enforced.
   */
  async canShip(subOrderId: string): Promise<{ allowed: boolean; reason: string }> {
    const ewb = await this.prisma.eWayBill.findFirst({
      where: { subOrderId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!ewb) {
      return {
        allowed: false,
        reason: 'EWB classification has not run for this sub-order yet.',
      };
    }
    if (
      ewb.status === 'NOT_REQUIRED' ||
      ewb.status === 'GENERATED' ||
      ewb.status === 'OVERRIDDEN'
    ) {
      // Phase 89 — Gap #7 revoke guard. A revoked override (status
      // would be REQUIRED again) falls through to the block branch.
      if (ewb.status === 'OVERRIDDEN' && ewb.overrideRevokedAt) {
        return {
          allowed: false,
          reason: `EWB override was revoked at ${ewb.overrideRevokedAt.toISOString()} — generate or re-override`,
        };
      }
      // Phase 160 (audit #14) — optional override TTL. An override is a
      // time-bounded compliance exception; once `eway_bill_override_ttl_hours`
      // (default 0 = no expiry) has elapsed since it was stamped, it stops
      // permitting dispatch so a stale bypass can't ride forever.
      if (ewb.status === 'OVERRIDDEN' && ewb.overrideAt) {
        const ttlHours = await this.taxConfig.getNumber(
          'eway_bill_override_ttl_hours' as any,
          0,
        );
        if (
          ttlHours > 0 &&
          Date.now() - ewb.overrideAt.getTime() > ttlHours * 60 * 60 * 1000
        ) {
          return {
            allowed: false,
            reason: `EWB override expired (older than ${ttlHours}h) — re-override or generate a real EWB before ship.`,
          };
        }
      }
      // Phase 160 (audit B5) — a GENERATED EWB past its validity is legally
      // dead even before the hourly expiry cron flips it to EXPIRED. Block
      // dispatch synchronously so a roadside-invalid EWB can never ship in
      // the window between expiry and the cron run.
      if (ewb.status === 'GENERATED' && ewb.validUntil && ewb.validUntil.getTime() < Date.now()) {
        return {
          allowed: false,
          reason: `EWB ${ewb.ewbNumber ?? ewb.id} expired at ${ewb.validUntil.toISOString()} — extend validity or regenerate before ship.`,
        };
      }
      return { allowed: true, reason: ewb.status };
    }
    return {
      allowed: false,
      reason: `EWB status ${ewb.status} — generation required before ship.`,
    };
  }

  /**
   * Phase 160 (cancel/override audit #11) — replace an EWB: cancel the
   * existing one then generate a fresh EWB for the same sub-order, linking
   * the new row's `replacedEwayBillId` back to the cancelled one. Used when
   * a wrong vehicle/transporter needs correcting beyond a Part-B update.
   *
   * Not a single DB transaction (each leg is an external provider call),
   * but ordered so a failed cancel aborts BEFORE any new EWB is minted; a
   * cancel-success-then-generate-failure leaves the old CANCELLED + a fresh
   * REQUIRED row the admin can re-generate (recoverable, not orphaned).
   */
  async replaceEwayBill(args: {
    ewbId: string;
    actorId: string;
    cancelReason: string;
    transport?: GenerateTransportDetails;
  }): Promise<EWayBill> {
    const old = await this.prisma.eWayBill.findUnique({
      where: { id: args.ewbId },
    });
    if (!old) throw new EWayBillNotFoundError(args.ewbId);
    // Cancel first (enforces the 24h window + provider call). Throws on
    // ineligibility / window-closed / provider failure → replace aborts.
    await this.cancel({
      ewbId: args.ewbId,
      cancelledBy: args.actorId,
      reason: args.cancelReason,
    });
    // Generate a fresh EWB for the same sub-order (classify creates a new
    // row now that the old one is CANCELLED).
    const fresh = await this.generate(old.subOrderId, args.transport ?? {});
    if (fresh.id === old.id) {
      // Defensive — should never happen (old is CANCELLED, classify makes
      // a new row), but never self-link.
      return fresh;
    }
    await this.prisma.eWayBill.update({
      where: { id: fresh.id },
      data: { replacedEwayBillId: old.id },
    });
    await this.writeAuditLog({
      ewayBillId: fresh.id,
      action: 'REPLACE',
      fromStatus: fresh.status,
      toStatus: fresh.status,
      actorId: args.actorId,
      actorRole: 'ADMIN',
      reason: `Replaces cancelled EWB ${old.id}: ${args.cancelReason}`,
      payloadAfter: { replacedEwayBillId: old.id },
    });
    return this.prisma.eWayBill.findUniqueOrThrow({ where: { id: fresh.id } });
  }

  /**
   * Phase 89 (2026-05-23) — Gap #3 closure.
   *
   * Resolve dispatch + delivery addresses for the sub-order. Reads
   * the destination from MasterOrder.shippingAddressSnapshot (JSON
   * blob frozen at checkout) + the origin from the seller's first
   * warehouse pincode (via the first SellerProductMapping → warehouse).
   * Both pincodes flow through `deriveStateCodeFromPincode` so the
   * intra-vs-inter-state decision lands without a separate geo lookup.
   *
   * Returns nulls when a piece is missing; the classifier stays
   * conservative (treats unknown state as inter-state).
   */
  private async resolveAddresses(
    subOrderId: string,
  ): Promise<{
    fromPincode: string | null;
    fromStateCode: string | null;
    toPincode: string | null;
    toStateCode: string | null;
  }> {
    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        sellerId: true,
        franchiseId: true,
        fulfillmentNodeType: true,
        masterOrder: { select: { shippingAddressSnapshot: true } },
      },
    });
    if (!sub) {
      return {
        fromPincode: null,
        fromStateCode: null,
        toPincode: null,
        toStateCode: null,
      };
    }

    // Destination — shipping address from the master order snapshot.
    let toPincode: string | null = null;
    const snap = (sub.masterOrder?.shippingAddressSnapshot as any) ?? null;
    if (snap) {
      const candidate =
        snap.pincode ??
        snap.postalCode ??
        snap.pinCode ??
        snap.zip ??
        null;
      if (typeof candidate === 'string' && /^\d{6}$/.test(candidate)) {
        toPincode = candidate;
      }
    }

    // Origin — for SELLER, fetch the seller's first registered
    // warehouse pincode. For FRANCHISE, use the franchise partner's
    // pickup pincode. Best-effort: missing data → null.
    let fromPincode: string | null = null;
    if (sub.fulfillmentNodeType === 'SELLER' && sub.sellerId) {
      const wh = await (this.prisma as any).sellerWarehouse?.findFirst?.({
        where: { sellerId: sub.sellerId, isActive: true },
        select: { pincode: true },
        orderBy: { createdAt: 'asc' },
      });
      if (wh?.pincode && /^\d{6}$/.test(wh.pincode)) fromPincode = wh.pincode;
    } else if (sub.fulfillmentNodeType === 'FRANCHISE' && sub.franchiseId) {
      const fr = await (this.prisma as any).franchisePartner?.findUnique?.({
        where: { id: sub.franchiseId },
        select: { pickupPincode: true },
      });
      if (fr?.pickupPincode && /^\d{6}$/.test(fr.pickupPincode)) {
        fromPincode = fr.pickupPincode;
      }
    }

    const fromState = deriveStateCodeFromPincode(fromPincode);
    const toState = deriveStateCodeFromPincode(toPincode);

    return {
      fromPincode,
      fromStateCode: fromState?.stateCode ?? null,
      toPincode,
      toStateCode: toState?.stateCode ?? null,
    };
  }

  /**
   * Phase 89 (2026-05-23) — Gap #18. Per-state intra-state threshold.
   * Several states (e.g., Maharashtra ₹1L, Tamil Nadu ₹1L, WB ₹1L,
   * Delhi ₹1L) carry higher intra-state thresholds than the national
   * ₹50k default. Reads `eway_bill_threshold_paise_by_state` JSON
   * config; resolves on the FROM state code; falls back to the
   * national `eway_bill_threshold_paise`.
   */
  private async resolvePolicyThreshold(args: {
    fromStateCode: string | null;
    toStateCode: string | null;
  }): Promise<number> {
    const nationalThreshold = await this.taxConfig.getNumber(
      'eway_bill_threshold_paise',
      50_00_00, // Phase 160 (audit #6): 5,000,000 paise = ₹50,000 (CBIC default)
    );
    // Per-state override applies only for intra-state movements
    // (otherwise inter-state always uses the national default).
    if (
      !args.fromStateCode ||
      args.fromStateCode !== args.toStateCode
    ) {
      return nationalThreshold;
    }
    const perStateRaw = await this.taxConfig.getString(
      'eway_bill_threshold_paise_by_state',
      '{}',
    );
    try {
      const map = JSON.parse(perStateRaw) as Record<string, number>;
      const override = map[args.fromStateCode];
      if (typeof override === 'number' && Number.isFinite(override)) {
        return override;
      }
    } catch {
      // Malformed config falls back to the national default rather
      // than throwing — operator misconfiguration shouldn't crash the
      // classify path.
    }
    return nationalThreshold;
  }

  /**
   * Phase 89 — Gap #5 HSN check. Reads invoice / order item HSN
   * codes and decides whether any line triggers the inter-state-at-
   * any-value rule. Returns false when no HSN information is on
   * file (conservative — the value-threshold gate is the fallback).
   */
  private async hsnForcesInterStateEwb(
    taxDocumentId: string | null,
    subOrderId: string,
  ): Promise<boolean> {
    if (taxDocumentId) {
      const doc = await (this.prisma as any).taxDocument.findUnique({
        where: { id: taxDocumentId },
        select: { lines: { select: { hsnOrSacCode: true } } },
      });
      if (doc?.lines?.length) {
        return anyLineRequiresInterStateEwb(
          doc.lines.map((l: any) => l.hsnOrSacCode),
        );
      }
    }
    // Pre-invoice fallback — read HSN from OrderItem (denormalised
    // at checkout time).
    const items = await (this.prisma as any).orderItem.findMany({
      where: { subOrderId },
      select: { hsnCode: true },
    });
    return anyLineRequiresInterStateEwb(items.map((i: any) => i.hsnCode));
  }
}
