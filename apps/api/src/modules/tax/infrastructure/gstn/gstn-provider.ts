// Phase 35 GST — GSTN verification provider interface.
//
// Abstracts the GST Network "Search Taxpayer by GSTIN" public API
// (gst.gov.in / sandbox) so the service layer can switch between:
//   - StubGstnProvider — derives the verification result entirely
//     from the local Mod-36 checksum + a deterministic in-memory
//     "legal name" fixture. Used in dev / test / staging without
//     hitting the real GSTN sandbox.
//   - SandboxGstnProvider (later phase) — the real CBIC/GSTN
//     sandbox API. Adapter not yet wired; refuses at boot to
//     prevent a silent fall-through to stub in production.
//
// Selection is via `GSTN_PROVIDER` env (`stub` | `sandbox`).
//
// The provider's job is purely network — it tells the caller whether
// a GSTIN exists on the GST roll AND returns whatever public taxpayer
// metadata GSTN provides (legal name, state code, registration type,
// active/cancelled status). The verification SERVICE then maps that
// onto the SellerGstin / CustomerTaxProfile rows (verifiedAt,
// verifiedBy, verificationNotes, plus the verified-name-mismatch
// audit signal).

import type { GstRegistrationType } from '@prisma/client';

/** GSTN portal taxpayer status. */
export type GstnTaxpayerStatus =
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'INACTIVE'
  | 'UNKNOWN';

export interface GstnVerifyInput {
  gstin: string;
}

export interface GstnVerifyResult {
  /** True when GSTN confirmed the GSTIN exists on the roll. False
   *  when GSTN returned "GSTIN not found" or equivalent. */
  found: boolean;
  /** Verbatim legal name returned by GSTN. Compared by the
   *  verification service against the locally-stored legalName to
   *  flag mismatches for admin review. */
  legalName: string | null;
  /** 2-digit GST state code from the GSTIN itself (positions 1-2)
   *  cross-checked against GSTN's response. The provider may
   *  return null if GSTN's response is missing the field; the
   *  service falls back to the GSTIN prefix. */
  stateCode: string | null;
  /** GSTN registration type (regular / composition / unregistered).
   *  Maps to the local `GstRegistrationType` enum. */
  registrationType: GstRegistrationType | null;
  /** Current portal status — ACTIVE rows can issue invoices;
   *  SUSPENDED/CANCELLED rows trigger an admin escalation. */
  status: GstnTaxpayerStatus;
  /** Raw provider response (for the audit trail; structure varies
   *  by sandbox vs production). */
  rawResponse: unknown;
}

export const GSTN_PROVIDER = Symbol.for('GstnProvider');

export interface GstnProvider {
  readonly name: string;
  verify(input: GstnVerifyInput): Promise<GstnVerifyResult>;
}
