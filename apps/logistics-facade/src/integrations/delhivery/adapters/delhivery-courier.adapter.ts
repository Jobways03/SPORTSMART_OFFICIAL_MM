import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import type {
  CancelShipmentResult,
  CourierAdapterMeta,
  CourierGatewayPort,
  CreateShipmentPayload,
  CreateShipmentResult,
  NdrActionResult,
  PrintLabelResult,
  RegisterPickupRequest,
  RegisterPickupResult,
  ServiceabilityCheckResult,
  TrackingSnapshotResult,
} from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import {
  DelhiveryOrderService,
  CarrierError,
  type UpdateDelhiveryShipmentChanges,
} from '../services/delhivery-order.service';
import { DelhiveryTrackingService } from '../services/delhivery-tracking.service';
import { DelhiveryNdrService } from '../services/delhivery-ndr.service';
import { DelhiveryRatesService } from '../services/delhivery-rates.service';
import { DelhiveryLabelService } from '../services/delhivery-label.service';
import { DelhiveryPickupService } from '../services/delhivery-pickup.service';
import { DelhiveryWarehouseService } from '../services/delhivery-warehouse.service';
import type {
  DelhiveryCanonicalLabelResult,
  DelhiveryLabelPdfSize,
} from '../dtos/delhivery-label.dto';
import type {
  DelhiveryNdrAction,
  DelhiveryNdrStatusResponse,
} from '../dtos/delhivery-ndr.dto';
import type { DelhiveryRvpCreateRequest } from '../dtos/delhivery-rvp-qc.dto';
import {
  DELHIVERY_CONFIG,
  DELHIVERY_DISPLAY_NAME,
  DELHIVERY_PARTNER_CODE,
} from '../delhivery.constants';
import type { DelhiveryConfig } from '../config/delhivery.config';

/**
 * Delhivery's implementation of `CourierGatewayPort`. Pure
 * composition root — each port method delegates to a focused service.
 * Where Delhivery exposes APIs the port doesn't yet model (warehouse
 * create / update, pickup-request, e-way bill, RVP QC 3.0, NDR
 * status), those surfaces are exposed as direct adapter methods —
 * the port can grow into them later.
 *
 * Pattern mirrors apps/api/src/integrations/ithink/adapters/ithink-courier.adapter.ts.
 */
@Injectable()
export class DelhiveryCourierAdapter implements CourierGatewayPort {
  readonly meta: CourierAdapterMeta = {
    partner: DELHIVERY_PARTNER_CODE,
    displayName: DELHIVERY_DISPLAY_NAME,
    region: 'IN',
  };

  constructor(
    private readonly orderService: DelhiveryOrderService,
    private readonly trackingService: DelhiveryTrackingService,
    private readonly ndrService: DelhiveryNdrService,
    private readonly ratesService: DelhiveryRatesService,
    private readonly labelService: DelhiveryLabelService,
    private readonly pickupService: DelhiveryPickupService,
    private readonly warehouseService: DelhiveryWarehouseService,
    @Inject(DELHIVERY_CONFIG) private readonly config: DelhiveryConfig,
  ) {}

  /* ── Port: read-only ─────────────────────────────────────────── */

  checkServiceability(pincode: string): Promise<ServiceabilityCheckResult> {
    return this.ratesService.checkServiceability(pincode);
  }

  track(awbs: string[]): Promise<Map<string, TrackingSnapshotResult>> {
    return this.trackingService.trackShipments(awbs);
  }

  /* ── Port: pickup-address registration ───────────────────────── */

  /**
   * Delhivery exposes Client Warehouse Create — wire to the new
   * `DelhiveryWarehouseService.createWarehouse`. The port's
   * `RegisterPickupRequest` carries only a subset of Delhivery's
   * fields, so we map what we have and pass placeholders for the
   * rest (caller is expected to follow up with `updateWarehouse`
   * for return-address details if not provided up-front).
   */
  async registerPickup(req: RegisterPickupRequest): Promise<RegisterPickupResult> {
    const result = await this.warehouseService.createWarehouse({
      name: req.companyName,
      phone: req.mobile,
      address: [req.address1, req.address2].filter(Boolean).join(', '),
      city: req.city,
      pin: req.pincode,
      country: req.country ?? 'India',
      // Return address defaults to pickup address — caller can edit later.
      returnAddress: [req.address1, req.address2].filter(Boolean).join(', '),
      returnPin: req.pincode,
      returnCity: req.city,
      returnState: req.state,
      returnCountry: req.country ?? 'India',
    });
    return {
      pickupAddressId: result.id ?? result.name,
      approvalStatus: 'APPROVED',
      remark: 'Delhivery client warehouse registered.',
    };
  }

  /* ── Port: create / cancel / update ──────────────────────────── */

  createShipment(payload: CreateShipmentPayload): Promise<CreateShipmentResult> {
    // Prefer the caller's OWN registered warehouse (per-seller / per-franchise)
    // so the parcel ships from where their stock physically is; fall back to the
    // facade's configured default warehouse only when the caller didn't supply one.
    const pickupWarehouseName =
      payload.pickupWarehouseName?.trim() ||
      this.config.defaultPickupWarehouseName ||
      '';
    if (!pickupWarehouseName.trim()) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail:
          'No pickup warehouse: neither a per-shipment pickupWarehouseName nor ' +
          'DELHIVERY_PICKUP_WAREHOUSE_NAME is set. It must exactly match a ' +
          'warehouse registered in the Delhivery One panel (case + space ' +
          'sensitive).',
        retryable: false,
      });
    }
    return this.orderService.createShipment(payload, {
      pickupWarehouseName,
    });
  }

  cancelShipment(awb: string): Promise<CancelShipmentResult> {
    return this.orderService.cancelShipment(awb);
  }

  /**
   * Extension: patch consignee / shipment-detail fields on an
   * existing AWB. NOT on `CourierGatewayPort` yet — exposed as a
   * direct method so callers using `DelhiveryCourierAdapter`
   * concretely can reach it. Promote to the port when a second
   * partner needs the same surface.
   */
  updateShipment(
    awb: string,
    changes: UpdateDelhiveryShipmentChanges,
  ): Promise<{ awb: string; success: boolean; errorMessage?: string }> {
    return this.orderService.updateShipment(awb, changes);
  }

  /* ── Port: labels ────────────────────────────────────────────── */

  printLabel(awbs: string[]): Promise<PrintLabelResult> {
    return this.labelService.printLabel(awbs);
  }

  /**
   * Extension: typed label generator with control over PDF size /
   * JSON output. Not on the port — direct call only.
   */
  generateLabel(
    awbs: string[],
    opts: { format?: 'pdf' | 'json'; pdfSize?: DelhiveryLabelPdfSize } = {},
  ): Promise<DelhiveryCanonicalLabelResult> {
    return this.labelService.generateLabel(awbs, opts);
  }

  /* ── Port: NDR (legacy reattempt / RTO) ──────────────────────── */

  reattempt(input: {
    awb: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult> {
    return this.ndrService.reattempt(input);
  }

  initiateRto(input: { awb: string; remark: string }): Promise<NdrActionResult> {
    return this.ndrService.initiateRto(input);
  }

  /**
   * Extension: apply a modern Delhivery NDR action (RE-ATTEMPT |
   * PICKUP_RESCHEDULE) and return the UPL ID. The port's
   * `reattempt` predates this API; use this method for the full
   * surface.
   */
  applyNdrAction(
    awb: string,
    action: DelhiveryNdrAction,
    opts: { expectedNsl?: string } = {},
  ): Promise<{ awb: string; action: DelhiveryNdrAction; uplId: string; success: boolean }> {
    return this.ndrService.applyAction(awb, action, opts);
  }

  /** Extension: poll async NDR action status by UPL ID. */
  getNdrStatus(uplId: string): Promise<DelhiveryNdrStatusResponse> {
    return this.ndrService.getStatus(uplId);
  }

  /* ── Extensions: surfaces the port doesn't model yet ─────────── */

  /**
   * Pickup request creation (`POST /fm/request/new/`). The port
   * doesn't expose this — TODO: when a second partner exposes a
   * comparable surface, lift `createPickupRequest` onto the port.
   *
   * Note: callers can also invoke `DelhiveryPickupService` directly
   * via the smoke script — it doesn't go through the adapter.
   */
  createPickupRequest(input: {
    warehouseName: string;
    date: string;
    time: string;
    expectedPackageCount: number;
  }) {
    return this.pickupService.createPickupRequest(input);
  }

  /**
   * Warehouse create/update. Not on the port (would conflict with the
   * narrower `RegisterPickupRequest`); exposed as direct methods.
   */
  createWarehouse(input: Parameters<DelhiveryWarehouseService['createWarehouse']>[0]) {
    return this.warehouseService.createWarehouse(input);
  }

  updateWarehouse(input: Parameters<DelhiveryWarehouseService['updateWarehouse']>[0]) {
    return this.warehouseService.updateWarehouse(input);
  }

  /**
   * E-way bill update — required for shipments where declared value
   * > ₹50,000. Not on the port yet; direct call.
   */
  updateEwaybill(awb: string, dcn: string, ewbn: string) {
    return this.orderService.updateEwaybill(awb, dcn, ewbn);
  }

  /**
   * Expected TAT and live cost are exposed as direct methods —
   * the port has `getRate` but not a richer `getExpectedTat`.
   */
  getExpectedTat(input: Parameters<DelhiveryRatesService['getExpectedTat']>[0]) {
    return this.ratesService.getExpectedTat(input);
  }

  calculateCost(input: Parameters<DelhiveryRatesService['calculateCost']>[0]) {
    return this.ratesService.calculateCost(input);
  }

  checkHeavyServiceability(pincode: string) {
    return this.ratesService.checkHeavyServiceability(pincode);
  }

  /**
   * RVP QC 3.0 — reverse-pickup create with parametric QC. Wired for
   * completeness; SportsMart currently does not run reverse pickups,
   * so this method logs a clear "currently unused" notice on call.
   *
   * Not on `CourierGatewayPort` — the port's `createShipment` is
   * forward-only; reverse uses a richer payload.
   */
  createReverseShipment(req: DelhiveryRvpCreateRequest): Promise<CreateShipmentResult> {
    return this.orderService.createRvpQc(req);
  }

  /**
   * Reserved for forward-fit: when the port grows a serviceability
   * variant for B2B, route through here. Until then this throws
   * NotImplementedException so accidental wiring fails loudly.
   */
  notImplemented(): never {
    throw new NotImplementedException(
      'Delhivery adapter — surface not yet implemented. Add the matching ' +
        'service method or extend `CourierGatewayPort` first.',
    );
  }
}
