import { BadRequestException, Injectable } from '@nestjs/common';

import { IThinkClient } from '../clients/ithink.client';
import {
  ITHINK_NDR_ACTION,
  ITHINK_NDR_ADDRESS_TYPE,
} from '../ithink.constants';
import type {
  IThinkNdrReattemptRtoRequest,
  IThinkNdrReattemptRtoResponseData,
  IThinkNdrShipmentAction,
} from '../dtos/ndr-reattempt-rto.dto';

/**
 * NDR (Non-Delivery Report) actions — Reattempt or RTO. iThink doesn't
 * expose a "list NDRs" endpoint, so the NDR queue is derived from our
 * own Shipment table filtered on status = UNDELIVERED. This service
 * just performs the action.
 *
 * Per iThink: ndr_action=1 (reattempt) requires date/time/address;
 * ndr_action=2 (rto) requires rto_remark. Validation done here so
 * callers see a clear 400 instead of a vague iThink error.
 */
@Injectable()
export class IThinkNdrService {
  constructor(private readonly client: IThinkClient) {}

  async reattempt(input: {
    awb: string;
    reattemptDate: string;
    reattemptTime: string;
    mobileNumber: string;
    address: string;
    addressType: 'HOME' | 'OFFICE';
  }): Promise<IThinkNdrReattemptRtoResponseData> {
    if (!input.reattemptDate || !input.reattemptTime || !input.address) {
      throw new BadRequestException(
        'Reattempt requires reattemptDate, reattemptTime and address',
      );
    }
    const shipment: IThinkNdrShipmentAction = {
      awb_numbers: input.awb,
      ndr_action: ITHINK_NDR_ACTION.REATTEMPT,
      reattempt_date: input.reattemptDate,
      reattempt_time: input.reattemptTime,
      reattempt_mobile_number: input.mobileNumber,
      reattempt_address: input.address,
      reattempt_address_type:
        input.addressType === 'HOME'
          ? ITHINK_NDR_ADDRESS_TYPE.HOME
          : ITHINK_NDR_ADDRESS_TYPE.OFFICE,
    };
    return this.dispatch([shipment]);
  }

  async rto(input: {
    awb: string;
    remark: string;
  }): Promise<IThinkNdrReattemptRtoResponseData> {
    if (!input.remark) {
      throw new BadRequestException('RTO requires a non-empty remark');
    }
    const shipment: IThinkNdrShipmentAction = {
      awb_numbers: input.awb,
      ndr_action: ITHINK_NDR_ACTION.RTO,
      rto_remark: input.remark,
    };
    return this.dispatch([shipment]);
  }

  private async dispatch(
    shipments: IThinkNdrShipmentAction[],
  ): Promise<IThinkNdrReattemptRtoResponseData> {
    const body: IThinkNdrReattemptRtoRequest = { shipments };
    const response = await this.client.post<IThinkNdrReattemptRtoResponseData>(
      'NDR_REATTEMPT_RTO',
      body as unknown as Record<string, unknown>,
    );
    return response.data ?? ({} as IThinkNdrReattemptRtoResponseData);
  }
}
