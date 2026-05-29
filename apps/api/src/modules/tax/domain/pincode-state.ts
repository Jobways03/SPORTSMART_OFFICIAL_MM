// Phase 89 (2026-05-23) — Gap #16. Pincode → GST state code derivation.
//
// India Post pincodes encode the postal circle in the first 1-2 digits.
// CBIC's GSTIN format also uses a 2-digit state code identical to the
// postal circle (32 codes for 28 states + 8 UTs). This module maps
// pincode prefixes to those 2-digit state codes so the EWB classifier
// can decide intra-state vs inter-state without needing a separate
// PostOffice geo lookup.
//
// Reference:
//   https://www.gst.gov.in/help/registration/statecodes
//   https://www.indiapost.gov.in/VAS/Pages/IndiaPostHome.aspx
//
// Edge cases:
//   • Pincode 110xxx — Delhi (07)
//   • Pincode 56xxxx / 57xxxx — Karnataka (29)
//   • Pincode 16xxxx — Punjab (03) (vs Haryana 12xxxx-13xxxx = 06)
//   • Army postal (APO) pincodes start with '9' — treated as unknown
//     so the conservative "not intra-state" path is taken.
//
// Returns null for unrecognised pincodes (lets the caller decide
// whether to fall back to the PostOffice table or fail conservative).

const PIN_PREFIX_TO_STATE_CODE: Array<{
  prefixes: RegExp;
  stateCode: string;
  stateName: string;
}> = [
  // Two-digit prefixes (more specific patterns first).
  { prefixes: /^11/, stateCode: '07', stateName: 'Delhi' },
  { prefixes: /^12/, stateCode: '06', stateName: 'Haryana' },
  { prefixes: /^13/, stateCode: '06', stateName: 'Haryana' },
  { prefixes: /^14/, stateCode: '03', stateName: 'Punjab' },
  { prefixes: /^15/, stateCode: '03', stateName: 'Punjab' },
  { prefixes: /^16/, stateCode: '03', stateName: 'Punjab' },
  { prefixes: /^17/, stateCode: '02', stateName: 'Himachal Pradesh' },
  { prefixes: /^18/, stateCode: '01', stateName: 'Jammu & Kashmir' },
  { prefixes: /^19/, stateCode: '01', stateName: 'Jammu & Kashmir' },
  { prefixes: /^20/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^21/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^22/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^23/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^24/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^25/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^26/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^27/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^28/, stateCode: '09', stateName: 'Uttar Pradesh' },
  { prefixes: /^30/, stateCode: '08', stateName: 'Rajasthan' },
  { prefixes: /^31/, stateCode: '08', stateName: 'Rajasthan' },
  { prefixes: /^32/, stateCode: '08', stateName: 'Rajasthan' },
  { prefixes: /^33/, stateCode: '08', stateName: 'Rajasthan' },
  { prefixes: /^34/, stateCode: '08', stateName: 'Rajasthan' },
  { prefixes: /^36/, stateCode: '24', stateName: 'Gujarat' },
  { prefixes: /^37/, stateCode: '24', stateName: 'Gujarat' },
  { prefixes: /^38/, stateCode: '24', stateName: 'Gujarat' },
  { prefixes: /^39/, stateCode: '24', stateName: 'Gujarat' },
  { prefixes: /^40/, stateCode: '27', stateName: 'Maharashtra' },
  { prefixes: /^41/, stateCode: '27', stateName: 'Maharashtra' },
  { prefixes: /^42/, stateCode: '27', stateName: 'Maharashtra' },
  { prefixes: /^43/, stateCode: '27', stateName: 'Maharashtra' },
  { prefixes: /^44/, stateCode: '27', stateName: 'Maharashtra' },
  { prefixes: /^45/, stateCode: '23', stateName: 'Madhya Pradesh' },
  { prefixes: /^46/, stateCode: '23', stateName: 'Madhya Pradesh' },
  { prefixes: /^47/, stateCode: '23', stateName: 'Madhya Pradesh' },
  { prefixes: /^48/, stateCode: '23', stateName: 'Madhya Pradesh' },
  { prefixes: /^49/, stateCode: '22', stateName: 'Chhattisgarh' },
  { prefixes: /^50/, stateCode: '36', stateName: 'Telangana' },
  { prefixes: /^51/, stateCode: '37', stateName: 'Andhra Pradesh' },
  { prefixes: /^52/, stateCode: '37', stateName: 'Andhra Pradesh' },
  { prefixes: /^53/, stateCode: '37', stateName: 'Andhra Pradesh' },
  { prefixes: /^56/, stateCode: '29', stateName: 'Karnataka' },
  { prefixes: /^57/, stateCode: '29', stateName: 'Karnataka' },
  { prefixes: /^58/, stateCode: '29', stateName: 'Karnataka' },
  { prefixes: /^59/, stateCode: '29', stateName: 'Karnataka' },
  { prefixes: /^60/, stateCode: '33', stateName: 'Tamil Nadu' },
  { prefixes: /^61/, stateCode: '33', stateName: 'Tamil Nadu' },
  { prefixes: /^62/, stateCode: '33', stateName: 'Tamil Nadu' },
  { prefixes: /^63/, stateCode: '33', stateName: 'Tamil Nadu' },
  { prefixes: /^64/, stateCode: '33', stateName: 'Tamil Nadu' },
  { prefixes: /^67/, stateCode: '32', stateName: 'Kerala' },
  { prefixes: /^68/, stateCode: '32', stateName: 'Kerala' },
  { prefixes: /^69/, stateCode: '32', stateName: 'Kerala' },
  { prefixes: /^70/, stateCode: '19', stateName: 'West Bengal' },
  { prefixes: /^71/, stateCode: '19', stateName: 'West Bengal' },
  { prefixes: /^72/, stateCode: '19', stateName: 'West Bengal' },
  { prefixes: /^73/, stateCode: '19', stateName: 'West Bengal' },
  { prefixes: /^74/, stateCode: '19', stateName: 'West Bengal' },
  { prefixes: /^75/, stateCode: '21', stateName: 'Odisha' },
  { prefixes: /^76/, stateCode: '21', stateName: 'Odisha' },
  { prefixes: /^77/, stateCode: '21', stateName: 'Odisha' },
  { prefixes: /^78/, stateCode: '18', stateName: 'Assam' },
  { prefixes: /^79/, stateCode: '16', stateName: 'Tripura' },
  { prefixes: /^80/, stateCode: '10', stateName: 'Bihar' },
  { prefixes: /^81/, stateCode: '10', stateName: 'Bihar' },
  { prefixes: /^82/, stateCode: '10', stateName: 'Bihar' },
  { prefixes: /^83/, stateCode: '10', stateName: 'Bihar' },
  { prefixes: /^84/, stateCode: '10', stateName: 'Bihar' },
  { prefixes: /^85/, stateCode: '20', stateName: 'Jharkhand' },
  { prefixes: /^86/, stateCode: '20', stateName: 'Jharkhand' },
  { prefixes: /^87/, stateCode: '20', stateName: 'Jharkhand' },
  { prefixes: /^88/, stateCode: '17', stateName: 'Meghalaya' },
];

export function deriveStateCodeFromPincode(
  pincode: string | null | undefined,
): { stateCode: string; stateName: string } | null {
  if (!pincode) return null;
  const trimmed = pincode.trim();
  if (!/^\d{6}$/.test(trimmed)) return null;
  for (const entry of PIN_PREFIX_TO_STATE_CODE) {
    if (entry.prefixes.test(trimmed)) {
      return { stateCode: entry.stateCode, stateName: entry.stateName };
    }
  }
  return null;
}
