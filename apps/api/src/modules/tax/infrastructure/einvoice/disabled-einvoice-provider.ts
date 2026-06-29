// Phase (MVP-launch defer) — Disabled e-invoice provider.
//
// Selected via `EINVOICE_PROVIDER=disabled`. Used when a deployment goes
// to production WITHOUT NIC IRP credentials (e.g. an MVP launch below the
// ₹5cr e-invoicing turnover threshold, or before GSP onboarding completes).
//
// Unlike the stub — which is REFUSED in production because it forges
// SHA-256-derived IRNs that look like NIC's but are not valid CBIC IRNs —
// this provider mints NOTHING. It boots cleanly and, if its methods are
// ever reached, throws a typed PERMANENT (non-retryable) error so the
// caller surfaces "e-invoicing disabled" instead of a fake document.
//
// In practice the methods are never reached: EInvoiceService reports the
// feature disabled (provider name === 'disabled'), so generation is skipped
// at the call site. This is defence-in-depth.
//
// To go live with real e-invoicing, switch EINVOICE_PROVIDER=nic and supply
// the NIC_IRP_* credentials.

import { Injectable, Logger } from '@nestjs/common';
import {
  EInvoiceProvider,
  EInvoiceProviderError,
  IrnCancelInput,
  IrnCancelResult,
  IrnGenerateInput,
  IrnGenerateResult,
} from './einvoice-provider';

@Injectable()
export class DisabledEInvoiceProvider implements EInvoiceProvider {
  private readonly logger = new Logger(DisabledEInvoiceProvider.name);
  readonly name = 'disabled';

  async generate(_input: IrnGenerateInput): Promise<IrnGenerateResult> {
    throw new EInvoiceProviderError(
      'E-invoicing is disabled for this deployment (EINVOICE_PROVIDER=disabled). ' +
        'No IRN was generated. Set EINVOICE_PROVIDER=nic with NIC_IRP_* credentials to enable it.',
      'PERMANENT',
    );
  }

  async cancel(_input: IrnCancelInput): Promise<IrnCancelResult> {
    throw new EInvoiceProviderError(
      'E-invoicing is disabled for this deployment (EINVOICE_PROVIDER=disabled). ' +
        'There are no IRNs to cancel.',
      'PERMANENT',
    );
  }
}
