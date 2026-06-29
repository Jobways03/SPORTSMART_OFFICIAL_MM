// Phase (MVP-launch defer) — Disabled e-way-bill provider.
//
// Selected via `EWAY_BILL_PROVIDER=disabled`. Used when a deployment goes to
// production WITHOUT NIC e-Waybill credentials (e.g. an MVP launch where the
// operator generates the occasional >₹50k EWB manually on the NIC portal).
//
// Unlike the stub — which is REFUSED in production because it forges
// `EWB-STUB-{uuid}` numbers (CGST Rule 138 + §122 fraud) — this provider
// mints NOTHING. It boots cleanly and, if its methods are ever reached,
// throws a typed PERMANENT (non-retryable) error.
//
// In practice the methods are never reached: EWayBillService.isEnabled()
// reports false (provider name === 'disabled'), so generation is skipped and
// canShip() does not block dispatch. This is defence-in-depth.
//
// To go live with real e-way-bills, switch EWAY_BILL_PROVIDER=nic and supply
// the NIC_* credentials.

import { Injectable, Logger } from '@nestjs/common';
import {
  EWayBillCancelInput,
  EWayBillCancelResult,
  EWayBillGenerateInput,
  EWayBillGenerateResult,
  EWayBillProvider,
  EWayBillProviderError,
  EWayBillUpdatePartBInput,
  EWayBillUpdatePartBResult,
} from './eway-bill-provider';

@Injectable()
export class DisabledEWayBillProvider implements EWayBillProvider {
  private readonly logger = new Logger(DisabledEWayBillProvider.name);
  readonly name = 'disabled';

  async generate(
    _input: EWayBillGenerateInput,
  ): Promise<EWayBillGenerateResult> {
    throw new EWayBillProviderError(
      'E-way-bill generation is disabled for this deployment ' +
        '(EWAY_BILL_PROVIDER=disabled). No EWB was generated. Set ' +
        'EWAY_BILL_PROVIDER=nic with NIC_* credentials to enable it.',
      'PERMANENT',
    );
  }

  async cancel(_input: EWayBillCancelInput): Promise<EWayBillCancelResult> {
    throw new EWayBillProviderError(
      'E-way-bill generation is disabled for this deployment ' +
        '(EWAY_BILL_PROVIDER=disabled). There are no EWBs to cancel.',
      'PERMANENT',
    );
  }

  async updatePartB(
    _input: EWayBillUpdatePartBInput,
  ): Promise<EWayBillUpdatePartBResult> {
    throw new EWayBillProviderError(
      'E-way-bill generation is disabled for this deployment ' +
        '(EWAY_BILL_PROVIDER=disabled). There are no EWBs to update.',
      'PERMANENT',
    );
  }
}
