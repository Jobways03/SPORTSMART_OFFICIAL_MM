// Phase 2 of the GST/tax/invoice system — GSTIN validator.
//
// Pure function: format + structure + Mod-36 checksum validation per
// the standard GST Network specification.
//
// GSTIN structure (15 chars):
//   positions 1-2   : 2-digit GST state code (01..38, plus 96/97/99)
//   positions 3-12  : 10-char PAN format (5 letters + 4 digits + 1 letter)
//   position  13    : entity code (1-9 or A-Z) — sequence number for
//                     same PAN registered in same state
//   position  14    : alphabet "Z" by default (some special cases differ)
//   position  15    : checksum (computed from first 14)
//
// References:
//   - https://www.gst.gov.in/ (GSTN public docs)
//   - CBIC Notification 39/2018 (GSTIN format definition)
//
// CA review: see docs/tax/GST_ASSUMPTIONS.md §12.

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[A-Z]{1}[0-9A-Z]{1}$/;
const PAN_REGEX   = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const CHARSET     = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface GstinValidationResult {
  isValid: boolean;
  /** Cleaned GSTIN (trimmed + uppercased). */
  normalized?: string;
  /** First 2 chars — GST state code. */
  stateCode?: string;
  /** Positions 3-12 — embedded PAN. */
  panNumber?: string;
  /** Last 4 chars of PAN for masked display. */
  panLast4?: string;
  /** Position 13 — entity sequence code. */
  entityCode?: string;
  /** Position 15 — checksum char. */
  checkDigit?: string;
  /** Human-readable errors (empty if valid). */
  errors: string[];
}

/**
 * Validate a GSTIN string. Returns a structured result with extracted
 * components and a list of errors (empty if valid).
 *
 * Examples:
 *   validateGstin('27AAACR4849R1ZL')  → { isValid: true, stateCode: '27', panNumber: 'AAACR4849R', ... }
 *   validateGstin('27AAACR4849R1ZX')  → { isValid: false, errors: ['GSTIN checksum mismatch ...'] }
 *   validateGstin('XX')               → { isValid: false, errors: ['GSTIN must be 15 characters ...', ...] }
 */
export function validateGstin(gstin: string | null | undefined): GstinValidationResult {
  if (!gstin || typeof gstin !== 'string') {
    return { isValid: false, errors: ['GSTIN is required'] };
  }
  const normalized = gstin.trim().toUpperCase();
  const errors: string[] = [];

  if (normalized.length !== 15) {
    errors.push(`GSTIN must be 15 characters (got ${normalized.length})`);
    return { isValid: false, normalized, errors };
  }
  if (!GSTIN_REGEX.test(normalized)) {
    errors.push('GSTIN does not match required structure (XX-XXXXX-NNNN-X-X-Z-X)');
    return { isValid: false, normalized, errors };
  }

  const stateCode  = normalized.substring(0, 2);
  const panNumber  = normalized.substring(2, 12);
  const entityCode = normalized.substring(12, 13);
  const checkDigit = normalized.substring(14, 15);

  if (!PAN_REGEX.test(panNumber)) {
    errors.push('Embedded PAN (positions 3-12) is malformed');
  }

  const expectedChecksum = computeGstinChecksum(normalized.substring(0, 14));
  if (expectedChecksum !== checkDigit) {
    errors.push(
      `GSTIN checksum mismatch (expected "${expectedChecksum}", got "${checkDigit}")`,
    );
  }

  if (errors.length > 0) {
    return { isValid: false, normalized, stateCode, panNumber, entityCode, checkDigit, errors };
  }

  return {
    isValid: true,
    normalized,
    stateCode,
    panNumber,
    panLast4: panNumber.substring(6, 10),
    entityCode,
    checkDigit,
    errors: [],
  };
}

/**
 * Standard GSTIN Mod-36 checksum. Operates on first 14 characters and
 * returns the expected 15th character. Position-weighted: odd positions
 * (0-indexed even) weight 1; even positions weight 2. Products folded
 * back into base-36 if they exceed 35.
 */
export function computeGstinChecksum(first14: string): string {
  if (first14.length !== 14) {
    return '_';
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const c = first14.charAt(i);
    const v = CHARSET.indexOf(c);
    if (v === -1) return '_'; // invalid char
    const factor = (i % 2 === 0) ? 1 : 2;
    let product = v * factor;
    if (product >= 36) {
      product = Math.floor(product / 36) + (product % 36);
    }
    sum += product;
  }
  const check = (36 - (sum % 36)) % 36;
  return CHARSET.charAt(check);
}

/**
 * Quick boolean check — true if the GSTIN passes all validations.
 */
export function isGstinValid(gstin: string | null | undefined): boolean {
  return validateGstin(gstin).isValid;
}

/**
 * Cross-validate: a GSTIN's embedded PAN should match the seller's
 * declared PAN. Returns true if both are present and match.
 */
export function gstinMatchesPan(gstin: string, pan: string): boolean {
  const r = validateGstin(gstin);
  if (!r.isValid || !r.panNumber) return false;
  return r.panNumber.toUpperCase() === pan.trim().toUpperCase();
}
