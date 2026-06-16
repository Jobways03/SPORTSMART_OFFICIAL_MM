// Phase 252 — franchise-admin form field validators. Each returns an error
// message string, or null when valid. Mirrors the seller/franchise apps'
// `lib/validators.ts` convention. Shared by the KYC edit, pricing, penalty/
// adjustment, delivery-methods and password forms in this app.

const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
// IFSC — 4 letters + '0' + 6 alphanumerics (RBI format). Matches the
// edit-bank modal's inline ACCOUNT/IFSC checks.
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// UPI VPA — handle@psp (e.g. name.surname@okhdfcbank). Local part allows
// word chars, dot and hyphen; the bank/PSP suffix is letters only.
const UPI_REGEX = /^[\w.\-]+@[A-Za-z]+$/;
const NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9 .,'&()\-/]*$/;
// Person name — must start with a letter; letters, spaces, period,
// apostrophe and hyphen only. NO digits, NO other special characters.
const PERSON_NAME_REGEX = /^[A-Za-z][A-Za-z .'-]*$/;

/** GSTIN — 15 chars: 2-digit state + 10-char PAN + entity + Z + checksum. */
export function validateGSTIN(value: string): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  if (!trimmed) return 'GSTIN is required';
  if (trimmed.length !== 15) return 'GSTIN must be 15 characters';
  if (!GSTIN_REGEX.test(trimmed)) return 'Enter a valid GSTIN';
  return null;
}

/** PAN — 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F). */
export function validatePAN(value: string): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  if (!trimmed) return 'PAN is required';
  if (!PAN_REGEX.test(trimmed)) return 'Enter a valid PAN (e.g. ABCDE1234F)';
  return null;
}

/** Indian mobile — 10 digits, starts 6-9. */
export function validateIndianMobile(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Phone number is required';
  if (!INDIAN_MOBILE_REGEX.test(trimmed))
    return 'Enter a valid 10-digit mobile number (starts 6-9)';
  return null;
}

/** Pincode — strict 6-digit Indian PIN (no leading zero). */
export function validatePincode(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Pincode is required';
  if (!PINCODE_REGEX.test(trimmed)) return 'Enter a valid 6-digit pincode';
  return null;
}

/** IFSC — 4 letters + 0 + 6 alphanumerics (e.g. HDFC0001234). */
export function validateIFSC(value: string): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  if (!trimmed) return 'IFSC code is required';
  if (!IFSC_REGEX.test(trimmed))
    return 'Invalid IFSC — 4 letters + 0 + 6 alphanumerics';
  return null;
}

/** UPI VPA — handle@psp (e.g. name@okhdfcbank). */
export function validateUPI(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'UPI ID is required';
  if (!UPI_REGEX.test(trimmed)) return 'Enter a valid UPI ID (e.g. name@bank)';
  return null;
}

/**
 * Person name (owner / account holder / consignee / contact, etc.) —
 * ALPHABETS ONLY. Must start with a letter; allows letters, spaces,
 * period, apostrophe and hyphen. Rejects digits and every other special
 * character. Length 2-50. Use this for human names; use
 * `validateRequiredName` for business / shop / brand labels where digits
 * and `&` are legitimate.
 */
export function validatePersonName(
  value: string,
  label = 'Name',
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return `${label} is required`;
  if (trimmed.length < 2) return `${label} is too short`;
  if (trimmed.length > 50) return `${label} is too long`;
  if (!PERSON_NAME_REGEX.test(trimmed)) return `${label} must contain only letters`;
  return null;
}

/** Required free-text name/label (owner / business / etc.). */
export function validateRequiredName(
  value: string,
  label = 'This field',
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return `${label} is required`;
  if (trimmed.length < 2) return `${label} is too short`;
  if (trimmed.length > 120) return `${label} is too long`;
  if (!NAME_REGEX.test(trimmed)) return `${label} contains invalid characters`;
  return null;
}

/**
 * Money amount — finite number within (min, max], up to `decimals` dp. Used by
 * the penalty / adjustment / pricing modals so an unbounded or negative value
 * can't reach the franchise finance ledger.
 */
export function validateAmount(
  value: string | number,
  opts: { min?: number; max?: number; decimals?: number; label?: string } = {},
): string | null {
  const { min = 0, max = 10_000_000, decimals = 2, label = 'Amount' } = opts;
  const raw = String(value ?? '').trim();
  if (!raw) return `${label} is required`;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < min) return `${label} must be at least ${min}`;
  if (n > max) return `${label} must not exceed ${max.toLocaleString()}`;
  const dp = (raw.split('.')[1] ?? '').length;
  if (dp > decimals) return `${label} can have at most ${decimals} decimal places`;
  return null;
}

/**
 * Strong password — 8-128 chars with at least one uppercase, one lowercase,
 * one digit and one special character. Used by the change-franchise-password
 * modal so a weak credential can't be set on a franchise login. (Sign-in
 * forms deliberately do NOT use this — they only require a non-empty value so
 * legacy passwords still authenticate.)
 */
export function validateStrongPassword(value: string): string | null {
  const v = value ?? '';
  if (!v) return 'Password is required';
  if (v.length < 8) return 'Password must be at least 8 characters';
  if (v.length > 128) return 'Password must be at most 128 characters';
  if (!/[A-Z]/.test(v)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(v)) return 'Password must include a lowercase letter';
  if (!/[0-9]/.test(v)) return 'Password must include a digit';
  if (!/[^A-Za-z0-9]/.test(v)) return 'Password must include a special character';
  return null;
}

/**
 * Date range — both dates present + parseable, and start on/before end
 * (or strictly before when allowEqual is false). Used by the finance reports
 * and settlement-cycle forms so an inverted range can't reach the API and
 * silently return an empty result.
 */
export function validateDateRange(
  start: string,
  end: string,
  opts: { allowEqual?: boolean } = {},
): string | null {
  const { allowEqual = true } = opts;
  if (!start || !end) return 'Select both a start and end date';
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 'Enter valid dates';
  if (allowEqual ? s > e : s >= e) return 'End date must be after the start date';
  return null;
}
