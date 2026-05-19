// Phase 35 GST — Stub GSTN verification provider.
//
// Derives the verification outcome entirely from the local Mod-36
// checksum + the GSTIN's embedded state code (positions 1-2). No
// network calls. Lets dev / test / staging exercise the full
// verification lifecycle (admin clicks "Verify", row stamps verified,
// admin sees the timestamp) without GSTN credentials.
//
// Behaviour:
//   - Valid checksum → found=true, ACTIVE, legalName derived as
//     `Stub Taxpayer ${pan-last-4}` so the verification-name-mismatch
//     check in the service has something to compare to.
//   - Invalid checksum / malformed GSTIN → found=false, UNKNOWN.
//   - The "13th position entity code" maps deterministically to a
//     registration type:  1-5 → REGULAR, 6-9 → COMPOSITION, else
//     UNREGISTERED. Lets unit tests cover all three code paths
//     by choosing a GSTIN with the right 13th char.

import { validateGstin } from '../../domain/gstin-validator';
import {
  GstnProvider,
  GstnVerifyInput,
  GstnVerifyResult,
  GstnTaxpayerStatus,
} from './gstn-provider';
import type { GstRegistrationType } from '@prisma/client';

export class StubGstnProvider implements GstnProvider {
  readonly name = 'stub';

  async verify(input: GstnVerifyInput): Promise<GstnVerifyResult> {
    const v = validateGstin(input.gstin);
    if (!v.isValid || !v.normalized || !v.stateCode) {
      const result: GstnVerifyResult = {
        found: false,
        legalName: null,
        stateCode: null,
        registrationType: null,
        status: 'UNKNOWN' as GstnTaxpayerStatus,
        rawResponse: {
          provider: 'stub',
          gstin: input.gstin,
          errors: v.errors,
        },
      };
      return result;
    }

    const registrationType = pickRegistrationType(v.entityCode);
    const legalName = `Stub Taxpayer ${v.panLast4 ?? v.panNumber ?? 'UNKNOWN'}`;
    return {
      found: true,
      legalName,
      stateCode: v.stateCode,
      registrationType,
      status: 'ACTIVE',
      rawResponse: {
        provider: 'stub',
        gstin: v.normalized,
        legalName,
        stateCode: v.stateCode,
        registrationType,
        status: 'ACTIVE',
        derivedFrom: 'local Mod-36 checksum',
      },
    };
  }
}

function pickRegistrationType(
  entityCode: string | undefined,
): GstRegistrationType {
  // entityCode is one char from [1-9A-Z]. Deterministic mapping so
  // tests can pick a fixture for each branch without enumerating
  // every possibility:
  //   1-5    → REGULAR
  //   6-9    → COMPOSITION
  //   A-Z    → UNREGISTERED (defensive default; GSTN almost always
  //            returns one of REGULAR / COMPOSITION in real data).
  if (!entityCode) return 'UNREGISTERED' as GstRegistrationType;
  if (/^[1-5]$/.test(entityCode)) return 'REGULAR' as GstRegistrationType;
  if (/^[6-9]$/.test(entityCode)) {
    return 'COMPOSITION' as GstRegistrationType;
  }
  return 'UNREGISTERED' as GstRegistrationType;
}
