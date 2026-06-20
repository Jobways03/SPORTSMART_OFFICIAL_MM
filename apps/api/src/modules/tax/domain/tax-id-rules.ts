/**
 * Single source of truth for PAN + GSTIN validation across the whole platform
 * — sellers (D2C + Retail), franchises, affiliates (PAN only), and B2B
 * customers. Every onboarding DTO and verification use-case imports the
 * regexes, lengths, and user-facing alert messages from here, so the rules and
 * the alerts a user sees stay identical on every portal.
 *
 * Before this, each module hard-coded its own (slightly divergent) regex +
 * message — e.g. one GSTIN regex allowed any letter at position 14 while
 * another (correctly) required the literal 'Z'. This model fixes that drift.
 *
 * Deeper checks (GSTIN Mod-36 checksum, government-portal status) live in
 * `gstin-validator.ts` and `gstn-verification.service.ts`; this file is the
 * format/shape + messaging layer those build on.
 */

// ── Canonical lengths ────────────────────────────────────────────────
export const PAN_LENGTH = 10;
export const GSTIN_LENGTH = 15;

// ── Canonical formats ────────────────────────────────────────────────
/**
 * PAN: 5 letters + 4 digits + 1 letter, where the 4th letter is the holder
 * type (one of A B C F G H J L P T). This rejects structurally-impossible
 * PANs like ABCDX1234F (D is not a valid holder type). e.g. ABCPK1234M.
 */
export const PAN_REGEX = /^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$/;
/** GSTIN: 2-digit state + 10-char PAN + 1 entity char + 'Z' + 1 checksum. */
export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** 2-digit CBIC GST state code. */
export const GST_STATE_CODE_REGEX = /^[0-9]{2}$/;

// ── Canonical alert messages (shown to users on every portal) ────────
export const TAX_ID_MESSAGES = {
  PAN_REQUIRED: 'PAN number is required',
  PAN_LENGTH: `PAN must be exactly ${PAN_LENGTH} characters`,
  PAN_FORMAT:
    'PAN format is invalid (expected: 5 letters + 4 digits + 1 letter, e.g. ABCPK1234M)',
  GSTIN_REQUIRED: 'GSTIN is required',
  GSTIN_LENGTH: `GSTIN must be exactly ${GSTIN_LENGTH} characters`,
  GSTIN_FORMAT:
    'GSTIN format is invalid (expected: 2-digit state + 10-char PAN + entity + Z + checksum, e.g. 27AAACR4849R1ZL)',
  GST_STATE_CODE_REQUIRED: 'GST state code is required',
  GST_STATE_CODE_FORMAT: 'GST state code must be 2 digits',
  GST_REG_TYPE: 'GST registration type must be REGULAR, COMPOSITION, or CASUAL',
  PAN_GSTIN_MISMATCH:
    'GSTIN does not embed the provided PAN. Check both fields — GSTIN positions 3-12 must equal the PAN.',
  GSTIN_STATE_MISMATCH:
    'GSTIN state code (its first 2 digits) must match the GST state code.',
} as const;

// ── Cross-field helpers ──────────────────────────────────────────────
/** A real GSTIN embeds the PAN at positions 3-12 (0-indexed 2..12). */
export function gstinEmbedsPan(
  gstin: string | null | undefined,
  pan: string | null | undefined,
): boolean {
  return !!gstin && !!pan && gstin.substring(2, 12) === pan;
}

/** A GSTIN's first 2 chars are the GST state code. */
export function gstinStateMatches(
  gstin: string | null | undefined,
  stateCode: string | null | undefined,
): boolean {
  return !!gstin && !!stateCode && gstin.substring(0, 2) === stateCode;
}
