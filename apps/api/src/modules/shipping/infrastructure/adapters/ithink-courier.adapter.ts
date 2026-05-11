import { Injectable, Logger } from '@nestjs/common';

import {
  IThinkApiError,
} from '../../../../integrations/ithink/clients/ithink.client';
import {
  IThinkNdrService,
  IThinkOrderService,
  IThinkRatesService,
  IThinkShippingDocsService,
  IThinkTrackingService,
  IThinkWarehouseService,
} from '../../../../integrations/ithink/services';
import type {
  IThinkForwardLogistics,
  IThinkReverseLogistics,
} from '../../../../integrations/ithink/ithink.constants';
import {
  CarrierCapabilityError,
  type CancelShipmentResult,
  type CourierAdapterMeta,
  type CourierGatewayPort,
  type CreateShipmentRequest,
  type CreateShipmentResult,
  type NdrActionResult,
  type PrintLabelResult,
  type RegisterPickupRequest,
  type RegisterPickupResult,
  type ServiceabilityResult,
  type TrackingSnapshot,
} from '../../application/ports/outbound/courier-gateway.port';

/**
 * `CourierGatewayPort` implementation backed by iThink Logistics.
 *
 * Translates between the port's small, carrier-neutral shapes and
 * iThink's verbose request/response payloads. Any wire-level quirks
 * (auth-in-body, 32-status taxonomy, batch caps) are handled inside
 * the iThink services this adapter composes — this file is pure
 * wiring + error translation.
 */
@Injectable()
export class IThinkCourierAdapter implements CourierGatewayPort {
  private readonly logger = new Logger(IThinkCourierAdapter.name);

  readonly meta: CourierAdapterMeta = {
    method: 'ITHINK_LOGISTICS',
    carrier: 'ithink',
  };

  constructor(
    private readonly orderSvc: IThinkOrderService,
    private readonly trackingSvc: IThinkTrackingService,
    private readonly docsSvc: IThinkShippingDocsService,
    private readonly ratesSvc: IThinkRatesService,
    private readonly warehouseSvc: IThinkWarehouseService,
    private readonly ndrSvc: IThinkNdrService,
  ) {}

  async checkServiceability(pincode: string): Promise<ServiceabilityResult> {
    const cap = await this.ratesSvc.checkPincode(pincode);
    return {
      pincode: cap.pincode,
      serviceable: cap.pickup || cap.prepaid || cap.cod,
      codAvailable: cap.cod,
      prepaidAvailable: cap.prepaid,
      carriers: cap.carriers.map((c) => ({
        carrier: c.carrier,
        prepaid: c.prepaid,
        cod: c.cod,
        pickup: c.pickup,
      })),
    };
  }

  async registerPickup(req: RegisterPickupRequest): Promise<RegisterPickupResult> {
    // Caller resolves state/city ids upstream — we only do the warehouse
    // registration here. State/city look-up is in IThinkWarehouseService.
    // For now adapter expects pincode-only and lets the warehouse
    // service handle the geo look-up via env-resolved defaults; admin
    // UIs that need a different state must call the warehouse service
    // directly.
    const states = await this.warehouseSvc.getStates();
    const matchingState = states.find(
      (s) => s.state_name.toLowerCase() === req.state.toLowerCase(),
    );
    if (!matchingState) {
      throw new Error(
        `iThink does not list state '${req.state}'. Run a geography sync or correct the name.`,
      );
    }
    const cities = await this.warehouseSvc.getCities(matchingState.id);
    const matchingCity = cities.find(
      (c) => c.city_name.toLowerCase() === req.city.toLowerCase(),
    );
    if (!matchingCity) {
      throw new Error(
        `iThink does not list city '${req.city}' in state '${req.state}'.`,
      );
    }

    const res = await this.warehouseSvc.addWarehouse({
      companyName: req.companyName,
      address1: req.address1,
      address2: req.address2,
      mobile: req.mobile,
      pincode: req.pincode,
      cityId: matchingCity.id,
      stateId: matchingState.id,
      countryId: '101',
      gps: req.gps,
    });

    // Add Warehouse always returns 'pending' per iThink — manual ops
    // approval flips it. Mirror that here.
    return {
      pickupAddressId: String(res.warehouse_id),
      approvalStatus: 'PENDING',
      remark: res.html_message,
    };
  }

  async createShipment(req: CreateShipmentRequest): Promise<CreateShipmentResult> {
    try {
      const result = await this.orderSvc.addOrder({
        shipments: [
          {
            ...req.shipment,
            pickupAddressId: req.pickupAddressId,
            returnAddressId: req.returnAddressId,
          },
        ],
        pickupAddressId: req.pickupAddressId,
        logistics: req.carrierPreference as
          | IThinkForwardLogistics
          | IThinkReverseLogistics
          | undefined,
        direction: req.direction ?? 'forward',
      });

      // Response is keyed by shipment index '1', '2', ... iThink always
      // returns at least one row, even on failure — so we read row '1'.
      const row = Object.values(result)[0];
      if (!row) {
        return {
          subOrderId: req.subOrderId,
          success: false,
          errorMessage: 'iThink returned no shipments in response',
        };
      }
      if (row.status !== 'Success') {
        return {
          subOrderId: req.subOrderId,
          success: false,
          errorMessage: row.remark || 'iThink rejected the shipment',
        };
      }
      return {
        subOrderId: req.subOrderId,
        success: true,
        awb: row.waybill,
        carrier: row.logistic_name,
        trackingUrl: row.tracking_url,
        orderRefnum: row.refnum,
      };
    } catch (error) {
      if (error instanceof IThinkApiError) {
        this.logger.warn(
          `Add Order failed for sub-order ${req.subOrderId}: ${error.message}`,
        );
        return {
          subOrderId: req.subOrderId,
          success: false,
          errorMessage: error.htmlMessage ?? error.message,
        };
      }
      throw error;
    }
  }

  async printLabel(awbs: string[]): Promise<PrintLabelResult> {
    const res = await this.docsSvc.printLabel({ awbs });
    return { fileUrl: res.file_name };
  }

  async track(awbs: string[]): Promise<Map<string, TrackingSnapshot>> {
    const normalised = await this.trackingSvc.trackBatched(awbs);
    const result = new Map<string, TrackingSnapshot>();
    for (const [awb, t] of normalised) {
      result.set(awb, {
        awb: t.awb,
        carrier: `ithink:${t.courier}`,
        direction: t.direction,
        currentStatus: t.currentStatus,
        rawCurrentStatus: t.rawCurrentStatus,
        expectedDelivery: t.expectedDelivery,
        promiseDelivery: t.promiseDelivery,
        scans: t.scans.map((s) => ({
          status: s.status,
          rawStatus: s.rawStatus,
          rawStatusCode: s.rawStatusCode,
          scanLocation: s.scanLocation,
          remark: s.remark,
          scanAt: s.scanAt,
          reason: s.reason,
        })),
      });
    }
    return result;
  }

  async cancelShipment(awb: string): Promise<CancelShipmentResult> {
    try {
      const res = await this.orderSvc.cancelOrder([awb]);
      const row = Object.values(res)[0];
      if (!row) return { awb, success: false, errorMessage: 'no response row' };
      return {
        awb,
        success: row.status === 'Success',
        errorMessage: row.status !== 'Success' ? row.remark : undefined,
      };
    } catch (error) {
      if (error instanceof IThinkApiError) {
        return { awb, success: false, errorMessage: error.htmlMessage ?? error.message };
      }
      throw error;
    }
  }

  async reattempt(input: {
    awb: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult> {
    const res = await this.ndrSvc.reattempt({
      awb: input.awb,
      reattemptDate: input.date,
      reattemptTime: input.time,
      address: input.address,
      mobileNumber: input.mobile,
      addressType: input.addressType,
    });
    const row = res[input.awb];
    return {
      awb: input.awb,
      success: row?.status === 'success',
      message: row?.remark ?? 'no response',
    };
  }

  async initiateRto(input: { awb: string; remark: string }): Promise<NdrActionResult> {
    const res = await this.ndrSvc.rto({ awb: input.awb, remark: input.remark });
    const row = res[input.awb];
    return {
      awb: input.awb,
      success: row?.status === 'success',
      message: row?.remark ?? 'no response',
    };
  }

  /**
   * Helper used by the strategy resolver — surfaces capabilities the
   * caller can't infer from the port alone (e.g., "iThink supports
   * label printing, SelfDelivery doesn't").
   */
  static throwUnsupported(capability: string): never {
    throw new CarrierCapabilityError('IThinkCourierAdapter', capability);
  }
}
