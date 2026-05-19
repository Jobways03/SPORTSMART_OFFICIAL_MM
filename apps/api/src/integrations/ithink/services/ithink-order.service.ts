import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { IThinkClient } from '../clients/ithink.client';
import { IThinkConfig } from '../config/ithink.config';
import {
  ITHINK_BATCH_LIMITS,
  ITHINK_FORWARD_LOGISTICS,
  ITHINK_REVERSE_LOGISTICS,
  type IThinkForwardLogistics,
  type IThinkReverseLogistics,
} from '../ithink.constants';
import type {
  IThinkAddOrderRequest,
  IThinkAddOrderResponseData,
} from '../dtos/add-order.dto';
import type {
  IThinkSyncOrderRequest,
  IThinkSyncOrderResponseData,
} from '../dtos/sync-order.dto';
import type {
  IThinkCancelOrderRequest,
  IThinkCancelOrderResponseData,
} from '../dtos/cancel-order.dto';
import type {
  IThinkOrderDetailsRequest,
  IThinkOrderDetailsResponseData,
} from '../dtos/order-details.dto';
import type {
  IThinkUpdatePaymentRequest,
  IThinkUpdatePaymentResponse,
} from '../dtos/update-payment.dto';
import {
  mapDomainShipmentToIThink,
  type DomainShipment,
} from '../mappers/ithink-shipment.mapper';

/**
 * Orchestrates the order-lifecycle endpoints: Add, Sync, Cancel,
 * Order Details, Update Payment. Other concerns (tracking, rates,
 * warehouses, remittance, NDR) live in sibling services so each
 * file stays focused on one business phase.
 */
@Injectable()
export class IThinkOrderService {
  private readonly logger = new Logger(IThinkOrderService.name);

  constructor(
    private readonly client: IThinkClient,
    private readonly config: IThinkConfig,
  ) {}

  /**
   * Book one or more shipments with iThink. Enforces batch caps and
   * carrier/direction cross-field rules before the network call so
   * obvious mistakes don't burn a sandbox call.
   *
   * Caller supplies pickup + return warehouse ids (resolved from the
   * seller/franchise record) and the per-shipment domain payloads.
   */
  async addOrder(input: {
    shipments: DomainShipment[];
    pickupAddressId: string;
    logistics?: IThinkForwardLogistics | IThinkReverseLogistics;
    direction?: 'forward' | 'reverse';
  }): Promise<IThinkAddOrderResponseData> {
    // Safety guard — when the env claims "sandbox mode" but the iThink
    // base URL points at production (as is the case until real sandbox
    // creds arrive), refuse Add Order so we never accidentally book a
    // real courier shipment during testing. All other endpoints
    // (warehouse, geo, tracking, label) are safe; only Add Order
    // physically commits.
    if (this.config.isSandbox) {
      throw new BadRequestException(
        'Add Order is blocked while ITHINK_USE_SANDBOX=true to prevent real shipments. ' +
          'Set ITHINK_USE_SANDBOX=false in apps/api/.env once you have proper sandbox credentials or are ready to ship for real.',
      );
    }

    if (input.shipments.length === 0) {
      throw new BadRequestException('Add Order requires at least one shipment');
    }
    if (input.shipments.length > ITHINK_BATCH_LIMITS.ADD_ORDER_SHIPMENTS) {
      throw new BadRequestException(
        `Add Order accepts max ${ITHINK_BATCH_LIMITS.ADD_ORDER_SHIPMENTS} shipments per call`,
      );
    }

    const direction = input.direction ?? 'forward';
    const logistics = input.logistics ?? this.config.defaultLogistics;
    this.assertLogisticsValid(direction, logistics);

    // Enforce per-shipment product cap.
    for (const s of input.shipments) {
      if (s.products.length > ITHINK_BATCH_LIMITS.ADD_ORDER_PRODUCTS_PER_SHIPMENT) {
        throw new BadRequestException(
          `Shipment ${s.orderNumber} has ${s.products.length} products; iThink caps at ${ITHINK_BATCH_LIMITS.ADD_ORDER_PRODUCTS_PER_SHIPMENT}`,
        );
      }
      // Reverse must be Prepaid per iThink.
      if (direction === 'reverse' && s.paymentMode !== 'Prepaid') {
        throw new BadRequestException(
          `Reverse shipment ${s.orderNumber} must have payment_mode='Prepaid' (got ${s.paymentMode})`,
        );
      }
    }

    const body: IThinkAddOrderRequest = {
      shipments: input.shipments.map(mapDomainShipmentToIThink),
      pickup_address_id: input.pickupAddressId,
      logistics,
      order_type: direction,
      // Service type is carrier-conditional; resolve from first shipment.
      s_type: input.shipments[0]?.serviceType ?? '',
    };

    // Phase 2 / C11 — stable idempotency key per batch. The
    // shipment order numbers are the caller's stable identifier;
    // joining them gives one key per Add Order call across retries.
    // A duplicate Add Order with the same key correlates in the
    // outbound HTTP log to the original even if iThink doesn't
    // honor the header semantically.
    const idempotencyKey =
      'ithink:add-order:' +
      input.shipments.map((s) => s.orderNumber).join(',');

    const response = await this.client.post<IThinkAddOrderResponseData>(
      'ADD_ORDER',
      body as unknown as Record<string, unknown>,
      { idempotencyKey },
    );

    const data = response.data ?? ({} as IThinkAddOrderResponseData);
    this.logger.log(
      `Add Order booked ${Object.keys(data).length} shipment(s) on ${logistics} (${direction})`,
    );
    return data;
  }

  /**
   * Pre-stage order data with iThink without booking a courier. Used
   * for orders awaiting verification — we keep them in iThink's system
   * for analytics but don't generate an AWB until the order is verified
   * and the seller accepts.
   */
  async syncOrder(shipments: DomainShipment[]): Promise<IThinkSyncOrderResponseData> {
    if (shipments.length === 0) {
      throw new BadRequestException('Sync Order requires at least one shipment');
    }
    if (shipments.length > ITHINK_BATCH_LIMITS.SYNC_ORDER_SHIPMENTS) {
      throw new BadRequestException(
        `Sync Order accepts max ${ITHINK_BATCH_LIMITS.SYNC_ORDER_SHIPMENTS} shipments per call`,
      );
    }

    const body: IThinkSyncOrderRequest = {
      shipments: shipments.map(mapDomainShipmentToIThink),
    };

    const response = await this.client.post<IThinkSyncOrderResponseData>(
      'SYNC_ORDER',
      body as unknown as Record<string, unknown>,
    );
    return response.data ?? ({} as IThinkSyncOrderResponseData);
  }

  /**
   * Cancel one or more AWBs. Only effective pre-pickup; after pickup,
   * the cancellation must flow through the NDR/RTO path.
   *
   * Caller passes AWBs as an array; we serialise to the comma-separated
   * string iThink expects and enforce the 100-cap.
   */
  async cancelOrder(awbs: string[]): Promise<IThinkCancelOrderResponseData> {
    if (awbs.length === 0) {
      throw new BadRequestException('Cancel Order requires at least one AWB');
    }
    if (awbs.length > ITHINK_BATCH_LIMITS.CANCEL_ORDER_AWBS) {
      throw new BadRequestException(
        `Cancel Order accepts max ${ITHINK_BATCH_LIMITS.CANCEL_ORDER_AWBS} AWBs per call`,
      );
    }
    const body: IThinkCancelOrderRequest = { awb_numbers: awbs.join(',') };
    // Phase 2 / C11 — Cancel is idempotent (cancelling an already-
    // cancelled AWB is a no-op from iThink's perspective), but the
    // header still helps correlate retried attempts in our logs.
    const idempotencyKey = 'ithink:cancel-order:' + awbs.join(',');
    const response = await this.client.post<IThinkCancelOrderResponseData>(
      'CANCEL_ORDER',
      body as unknown as Record<string, unknown>,
      { idempotencyKey },
    );
    return response.data ?? ({} as IThinkCancelOrderResponseData);
  }

  /**
   * Authoritative order detail — billed/unbilled charges, zone, weight,
   * dates. Used by reconciliation and commission services.
   *
   * Both `awbs` (list) and date range are required by iThink even if
   * you only want one AWB; the start/end window defaults to the last
   * 90 days when callers don't pin a tighter window.
   */
  async getDetails(input: {
    awbs?: string[];
    orderNumber?: string;
    startDate: string;
    endDate: string;
  }): Promise<IThinkOrderDetailsResponseData> {
    const body: IThinkOrderDetailsRequest = {
      awb_number_list: input.awbs?.join(',') ?? '',
      order_no: input.orderNumber ?? '',
      start_date: input.startDate,
      end_date: input.endDate,
    };
    const response = await this.client.post<IThinkOrderDetailsResponseData>(
      'ORDER_DETAILS',
      body as unknown as Record<string, unknown>,
    );
    return response.data ?? ({} as IThinkOrderDetailsResponseData);
  }

  /**
   * Flip a COD shipment to Prepaid at the courier (only valid with a
   * subset of carriers; iThink returns an html_message error if the
   * carrier doesn't support it). Use after a customer pre-pays the
   * COD amount online.
   */
  async updatePayment(awbs: string[]): Promise<IThinkUpdatePaymentResponse> {
    if (awbs.length === 0) {
      throw new BadRequestException('Update Payment requires at least one AWB');
    }
    const body: IThinkUpdatePaymentRequest = { awb_numbers: awbs.join(',') };
    const response = await this.client.post<unknown>(
      'UPDATE_PAYMENT',
      body as unknown as Record<string, unknown>,
    );
    // Update Payment returns a flat envelope, no `data` wrapping.
    return {
      status: response.status ?? 'success',
      status_code: response.status_code ?? 200,
      html_message: response.html_message ?? '',
    };
  }

  /** Cross-field rule iThink enforces server-side; we enforce locally too. */
  private assertLogisticsValid(
    direction: 'forward' | 'reverse',
    logistics: string,
  ): void {
    if (direction === 'reverse') {
      if (!(ITHINK_REVERSE_LOGISTICS as readonly string[]).includes(logistics)) {
        throw new BadRequestException(
          `Reverse shipments only support ${ITHINK_REVERSE_LOGISTICS.join('/')}; got '${logistics}'`,
        );
      }
      return;
    }
    if (!(ITHINK_FORWARD_LOGISTICS as readonly string[]).includes(logistics)) {
      throw new BadRequestException(
        `Forward shipments only support ${ITHINK_FORWARD_LOGISTICS.join('/')}; got '${logistics}'`,
      );
    }
  }
}
