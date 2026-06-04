import { Injectable, NotImplementedException } from '@nestjs/common';
import { DelhiveryClient } from '../clients/delhivery.client';
import type { NdrActionResult } from '../../../modules/shipments/application/ports/outbound/courier-gateway.port';
import {
  DELHIVERY_NDR_PICKUP_RESCHEDULE_NSLS,
  DELHIVERY_NDR_REATTEMPT_NSLS,
  type DelhiveryNdrAction,
  type DelhiveryNdrActionRequest,
  type DelhiveryNdrActionResponse,
  type DelhiveryNdrStatusResponse,
} from '../dtos/delhivery-ndr.dto';
import { DELHIVERY_PATHS } from '../delhivery.constants';
import { CarrierError } from './delhivery-order.service';
import { mapDelhiveryError } from '../mappers/delhivery-error.mapper';

/**
 * NDR (Non-Delivery Reattempt) action surface.
 *
 * Delhivery's NDR API:
 *   • Apply action:  `POST /api/p/update`
 *       Body `{ data: [{ waybill, act: "RE-ATTEMPT" | "PICKUP_RESCHEDULE" }] }`.
 *       Returns a UPL ID; the action is processed asynchronously.
 *   • Get status:    `GET /api/cmu/get_bulk_upl/{UPL_ID}?verbose=true`.
 *
 * Action eligibility per NSL code is defined in the developer
 * portal — the service validates pre-flight when callers pass an
 * `expectedNsl`, but Delhivery is the ultimate authority and surfaces
 * INVALID_STATE on mismatch.
 *
 * Restrictions baked into Delhivery's side (not enforced here):
 *   • Actions must be applied after 9 PM IST.
 *   • Attempt count must be 1 or 2.
 */
@Injectable()
export class DelhiveryNdrService {
  constructor(private readonly client: DelhiveryClient) {}

  /**
   * Apply an NDR action to one (or many) waybills.
   *
   * Returns the UPL ID for status polling — actual completion is
   * asynchronous and must be checked via `getStatus(uplId)`.
   */
  async applyAction(
    awb: string,
    action: DelhiveryNdrAction,
    opts: { expectedNsl?: string } = {},
  ): Promise<{
    awb: string;
    action: DelhiveryNdrAction;
    uplId: string;
    success: boolean;
  }> {
    return this.applyActionBulk([{ waybill: awb, act: action }], opts).then(
      (r) => ({
        awb,
        action,
        uplId: r.uplId,
        success: r.success,
      }),
    );
  }

  /**
   * Bulk variant. Use when issuing the same action across many AWBs
   * in one call — Delhivery's `/api/p/update` accepts an array.
   */
  async applyActionBulk(
    entries: Array<{ waybill: string; act: DelhiveryNdrAction }>,
    opts: { expectedNsl?: string } = {},
  ): Promise<{ uplId: string; success: boolean }> {
    if (!entries.length) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'applyActionBulk requires at least one waybill entry.',
        retryable: false,
      });
    }
    // Pre-flight NSL eligibility check when caller knows the NSL.
    if (opts.expectedNsl) {
      for (const entry of entries) {
        const eligible =
          entry.act === 'RE-ATTEMPT'
            ? (DELHIVERY_NDR_REATTEMPT_NSLS as readonly string[]).includes(
                opts.expectedNsl,
              )
            : (
                DELHIVERY_NDR_PICKUP_RESCHEDULE_NSLS as readonly string[]
              ).includes(opts.expectedNsl);
        if (!eligible) {
          throw new CarrierError({
            code: 'INVALID_STATE',
            detail:
              `NDR action "${entry.act}" is not eligible for NSL ` +
              `"${opts.expectedNsl}". Valid NSLs: ${
                entry.act === 'RE-ATTEMPT'
                  ? DELHIVERY_NDR_REATTEMPT_NSLS.join(', ')
                  : DELHIVERY_NDR_PICKUP_RESCHEDULE_NSLS.join(', ')
              }.`,
            retryable: false,
          });
        }
      }
    }

    const body: DelhiveryNdrActionRequest = { data: entries };
    const response = await this.client.post<
      DelhiveryNdrActionRequest,
      DelhiveryNdrActionResponse | unknown
    >(DELHIVERY_PATHS.NDR_ACTION, body, {
      contentType: 'json',
      idempotencyKey: `ndr-${entries.map((e) => e.waybill).join(',')}`,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    const envelope = response.body as DelhiveryNdrActionResponse;
    const uplId = envelope?.upl_id ?? envelope?.upl;
    if (!uplId) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    return { uplId: String(uplId), success: true };
  }

  /**
   * Poll the async status of an applied NDR action by UPL ID.
   *
   * `GET /api/cmu/get_bulk_upl/{UPL_ID}?verbose=true`
   */
  async getStatus(uplId: string): Promise<DelhiveryNdrStatusResponse> {
    if (!uplId) {
      throw new CarrierError({
        code: 'VALIDATION_FAILED',
        detail: 'getStatus requires a UPL ID.',
        retryable: false,
      });
    }
    const path = `${DELHIVERY_PATHS.NDR_STATUS}${encodeURIComponent(uplId)}`;
    const response = await this.client.get<DelhiveryNdrStatusResponse>(path, {
      verbose: 'true',
    });
    if (response.status < 200 || response.status >= 300) {
      throw new CarrierError(mapDelhiveryError(response.status, response.body));
    }
    return response.body;
  }

  /**
   * Legacy port methods kept for `CourierGatewayPort` compatibility.
   *
   * The port pre-dates Delhivery's NDR API redesign — `reattempt` and
   * `initiateRto` here delegate to `applyAction("RE-ATTEMPT", ...)` and
   * are intentionally narrow (the input shape is dictated by the
   * port). When the port grows a richer NDR signature these can fan
   * out into `applyAction`.
   */
  async reattempt(input: {
    awb: string;
    date: string;
    time: string;
    address: string;
    mobile: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<NdrActionResult> {
    void input.date;
    void input.time;
    void input.address;
    void input.mobile;
    void input.addressType;
    const { uplId } = await this.applyAction(input.awb, 'RE-ATTEMPT');
    return {
      awb: input.awb,
      success: true,
      message: `Delhivery RE-ATTEMPT queued (UPL ${uplId}).`,
    };
  }

  async initiateRto(_input: { awb: string; remark: string }): Promise<NdrActionResult> {
    // Delhivery's modern NDR API does not expose an explicit RTO action;
    // RTO falls out of the "no further attempts" decision tree once
    // the consignee fails the configured retry budget. Surface a clear
    // not-implemented so callers know to use cancellation instead.
    void this.client;
    throw new NotImplementedException(
      `Delhivery's NDR API redesign removed the explicit RTO action — ` +
        `the partner now drives RTO automatically once retries exhaust. ` +
        `Use cancelShipment(awb) instead, or wait for the automatic RTO.`,
    );
  }
}
