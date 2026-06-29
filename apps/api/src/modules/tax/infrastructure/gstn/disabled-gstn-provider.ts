// Phase (MVP-launch defer) — Disabled GSTN verification provider.
//
// Selected via `GSTN_PROVIDER=disabled`. Used when a deployment goes to
// production WITHOUT GSTN portal API access (e.g. an MVP launch where seller
// GSTINs are reviewed manually by an admin).
//
// Unlike the stub — which is REFUSED in production because it marks GSTINs
// "verified" from a local Mod-36 checksum, a FALSE compliance signal — this
// provider claims NOTHING. verify() always returns found=false / UNKNOWN
// (the same shape the stub returns for a malformed GSTIN), so the
// verification service records the GSTIN as NOT verified rather than minting
// a fake "verified" stamp. It never throws, so it is safe on the
// fire-and-forget verification path (customer/seller tax-profile updates) and
// admin-triggered verification (which simply reports "could not verify").
//
// To go live with real GSTN verification, wire a real provider and set
// GSTN_PROVIDER accordingly.

import {
  GstnProvider,
  GstnTaxpayerStatus,
  GstnVerifyInput,
  GstnVerifyResult,
} from './gstn-provider';

export class DisabledGstnProvider implements GstnProvider {
  readonly name = 'disabled';

  async verify(input: GstnVerifyInput): Promise<GstnVerifyResult> {
    return {
      found: false,
      legalName: null,
      stateCode: null,
      registrationType: null,
      status: 'UNKNOWN' as GstnTaxpayerStatus,
      rawResponse: {
        provider: 'disabled',
        gstin: input.gstin,
        note: 'GSTN verification is disabled for this deployment (GSTN_PROVIDER=disabled). GSTIN left unverified for manual review.',
      },
    };
  }
}
