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

import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  EWayBill,
  EWayBillStatus,
  EWayBillTransportMode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { TaxConfigService } from './tax-config.service';
import {
  EWAY_BILL_PROVIDER,
  type EWayBillProvider,
} from '../../infrastructure/eway-bill/eway-bill-provider';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxConfig: TaxConfigService,
    @Inject(EWAY_BILL_PROVIDER) private readonly provider: EWayBillProvider,
  ) {}

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

    const threshold = await this.taxConfig.getNumber(
      'eway_bill_threshold_paise',
      // Default ₹50,000 = 50_00_00 paise.
      50_00_00,
    );
    const { value, taxDocumentId, supplierGstin } =
      await this.computeConsignmentValue(subOrderId);
    const required = value > BigInt(threshold);

    if (existing) {
      // Idempotent — return current row but allow status to flip from
      // NOT_REQUIRED → REQUIRED if the invoice total changed (unusual).
      if (
        existing.status === 'NOT_REQUIRED' &&
        required &&
        // Don't overwrite a row already past the initial classification
        // (PENDING / GENERATED / FAILED / EXPIRED handled separately).
        true
      ) {
        const updated = await this.prisma.eWayBill.update({
          where: { id: existing.id },
          data: {
            status: 'REQUIRED',
            consignmentValueInPaise: value,
            taxDocumentId,
            supplierGstin,
          },
        });
        return { row: updated, required: true, thresholdPaise: threshold, consignmentValueInPaise: value };
      }
      return {
        row: existing,
        required: existing.status !== 'NOT_REQUIRED',
        thresholdPaise: threshold,
        consignmentValueInPaise: existing.consignmentValueInPaise,
      };
    }

    // Resolve from/to address snapshot. Best-effort; the generate-time
    // call will fill in any missing fields when transport details land.
    const addresses = await this.resolveAddresses(subOrderId);

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
      },
    });
    this.logger.log(
      `EWB classified for sub-order ${subOrderId}: status=${created.status} ` +
        `(consignment ${value.toString()} paise, threshold ${threshold})`,
    );
    return {
      row: created,
      required,
      thresholdPaise: threshold,
      consignmentValueInPaise: value,
    };
  }

  /**
   * Call the provider to generate the EWB number. Persists number +
   * validity + raw payloads. Idempotent on GENERATED rows.
   */
  async generate(
    subOrderId: string,
    details: GenerateTransportDetails = {},
  ): Promise<EWayBill> {
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

    // Move to PENDING so the UI sees in-flight + we can spot
    // crash-mid-call rows in the FAILED retry queue.
    const pending = await this.prisma.eWayBill.update({
      where: { id: row.id },
      data: {
        status: 'PENDING',
        transportMode: details.transportMode ?? row.transportMode,
        vehicleNumber: details.vehicleNumber ?? row.vehicleNumber,
        transporterId: details.transporterId ?? row.transporterId,
        transporterName: details.transporterName ?? row.transporterName,
        distanceKm: details.distanceKm ?? row.distanceKm,
      },
    });

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
        },
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
    if (ageMs > EWayBillService.CANCELLATION_WINDOW_MS) {
      throw new EWayBillCancellationWindowClosedError(ewb.id, ewb.ewbDate);
    }

    const result = await this.provider.cancel({
      ewbNumber: ewb.ewbNumber,
      reason: args.reason,
    });

    return this.prisma.eWayBill.update({
      where: { id: ewb.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: result.cancelledAt,
        cancelledBy: args.cancelledBy,
        cancellationReason: args.reason,
        rawResponseJson: result.rawResponseJson as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Admin override — allow ship despite EWB being REQUIRED / FAILED.
   * Audited; the seller-side ship guard checks `overrideAdminId` to
   * decide whether to let the dispatch through.
   */
  async adminOverride(args: {
    ewbId: string;
    adminId: string;
    reason: string;
  }): Promise<EWayBill> {
    const ewb = await this.prisma.eWayBill.findUnique({
      where: { id: args.ewbId },
    });
    if (!ewb) throw new EWayBillNotFoundError(args.ewbId);
    if (ewb.status === 'NOT_REQUIRED') {
      // Nothing to override — return as-is.
      return ewb;
    }
    return this.prisma.eWayBill.update({
      where: { id: ewb.id },
      data: {
        overrideAdminId: args.adminId,
        overrideAt: new Date(),
        overrideReason: args.reason,
      },
    });
  }

  /**
   * Seller-side ship guard. Returns true when the sub-order is clear
   * to dispatch (no EWB needed, EWB issued, or admin override in place).
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
    if (ewb.status === 'NOT_REQUIRED' || ewb.status === 'GENERATED') {
      return { allowed: true, reason: ewb.status };
    }
    if (ewb.overrideAdminId) {
      return {
        allowed: true,
        reason: `admin override by ${ewb.overrideAdminId}: ${ewb.overrideReason ?? ''}`,
      };
    }
    return {
      allowed: false,
      reason: `EWB status ${ewb.status} — generation required before ship.`,
    };
  }

  /**
   * Resolve dispatch + delivery addresses for the sub-order. Phase 15
   * ships the classification + persistence shape; address resolution
   * is best-effort and falls back to null pincodes when the upstream
   * snapshot isn't shaped as expected. The Phase 25 admin UI will let
   * an admin override these explicitly before retry; the eventual NIC
   * integration will require both ends populated.
   */
  private async resolveAddresses(
    _subOrderId: string,
  ): Promise<{
    fromPincode: string | null;
    fromStateCode: string | null;
    toPincode: string | null;
    toStateCode: string | null;
  }> {
    // The MasterOrder carries `shipping_address_snapshot` as a JSON
    // blob and the seller/franchise warehouse linkage lives on
    // SellerProductMapping. Both reads are tightly coupled to existing
    // services that aren't injected here. Phase 25's admin retry flow
    // will populate these via an explicit input rather than reaching
    // across module boundaries from this service.
    return {
      fromPincode: null,
      fromStateCode: null,
      toPincode: null,
      toStateCode: null,
    };
  }
}
