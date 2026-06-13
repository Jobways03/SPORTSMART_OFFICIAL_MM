// Affiliate-admin form field validators. Each returns an error-message string,
// or null when the value is valid. Signatures + regexes are kept identical to
// the other SportsMart apps' `lib/validators.ts` so every panel validates the
// same way. Wire these into a form's existing submit handler: compute the first
// error, set the form's existing error state, and return before the API call.

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const OTP_REGEX = /^\d{6}$/;
const PASSWORD_SPECIAL_REGEX = /[^A-Za-z0-9]/;

/**
 * Money amount. Trims, requires a finite number, enforces min/max bounds and a
 * maximum number of decimal places. For money INTO a ledger pass a sane `max`
 * (default 10,000,000); for a signed adjustment pass `min: -10_000_000`.
 */
export function validateAmount(
  value: unknown,
  {
    min = 0,
    max = 10_000_000,
    decimals = 2,
    label = 'Amount',
  }: { min?: number; max?: number; decimals?: number; label?: string } = {},
): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return `${label} is required`;
  const num = Number(raw);
  if (!Number.isFinite(num)) return `${label} must be a number`;
  if (num < min) return `${label} must be at least ${min}`;
  if (num > max) return `${label} must be at most ${max}`;
  const dot = raw.indexOf('.');
  if (dot !== -1 && raw.length - dot - 1 > decimals) {
    return decimals === 0
      ? `${label} must be a whole number`
      : `${label} can have at most ${decimals} decimal place${decimals === 1 ? '' : 's'}`;
  }
  return null;
}

/** Indian pincode — 6 digits, first digit 1-9. */
export function validatePincode(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!PINCODE_REGEX.test(trimmed)) return 'Enter a valid 6-digit pincode';
  return null;
}

/** Indian mobile — 10 digits starting 6-9. */
export function validateIndianMobile(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!INDIAN_MOBILE_REGEX.test(trimmed))
    return 'Enter a valid 10-digit mobile number (starts 6-9)';
  return null;
}

/** GSTIN — 15 chars (uppercased before matching). */
export function validateGSTIN(value: string): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  if (trimmed.length !== 15 || !GSTIN_REGEX.test(trimmed))
    return 'Enter a valid 15-character GSTIN';
  return null;
}

/** PAN — 5 letters + 4 digits + 1 letter (uppercased before matching). */
export function validatePAN(value: string): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  if (!PAN_REGEX.test(trimmed)) return 'Enter a valid 10-character PAN';
  return null;
}

/** IFSC — 4 letters + 0 + 6 alphanumerics (uppercased before matching). */
export function validateIFSC(value: string): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  if (!IFSC_REGEX.test(trimmed))
    return 'Enter a valid 11-character IFSC (e.g. HDFC0001234)';
  return null;
}

/** One-time code — exactly 6 digits. */
export function validateOtp(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!OTP_REGEX.test(trimmed)) return 'Code must be exactly 6 digits';
  return null;
}

/** Strong password — length 8-128 with upper, lower, digit, and special. */
export function validateStrongPassword(value: string): string | null {
  const v = value ?? '';
  if (v.length < 8 || v.length > 128)
    return 'Password must be 8 to 128 characters';
  if (!/[A-Z]/.test(v)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(v)) return 'Password must include a lowercase letter';
  if (!/[0-9]/.test(v)) return 'Password must include a digit';
  if (!PASSWORD_SPECIAL_REGEX.test(v))
    return 'Password must include a special character';
  return null;
}

/** Date range — both present, parseable, start <= end (or < end). */
export function validateDateRange(
  start: string,
  end: string,
  { allowEqual = true }: { allowEqual?: boolean } = {},
): string | null {
  const s = (start ?? '').trim();
  const e = (end ?? '').trim();
  if (!s || !e) return 'Both start and end dates are required';
  const sd = new Date(s).getTime();
  const ed = new Date(e).getTime();
  if (!Number.isFinite(sd) || !Number.isFinite(ed))
    return 'Enter valid dates';
  if (allowEqual ? sd > ed : sd >= ed)
    return 'End date must be after the start date';
  return null;
}

/** Upload file — present, allowed type, within size limit. */
export function validateUploadFile(
  file: File | null | undefined,
  {
    maxBytes = 5 * 1024 * 1024,
    types = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  }: { maxBytes?: number; types?: string[] } = {},
): string | null {
  if (!file) return 'A file is required';
  if (!types.includes(file.type)) return 'Unsupported file type';
  if (file.size > maxBytes)
    return `File must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller`;
  return null;
}

/** Free text — required/empty + length bounds. */
export function validateText(
  value: string,
  {
    min = 1,
    max = 500,
    label = 'This field',
    required = true,
  }: { min?: number; max?: number; label?: string; required?: boolean } = {},
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    if (required) return `${label} is required`;
    return null;
  }
  if (trimmed.length < min)
    return `${label} must be at least ${min} character${min === 1 ? '' : 's'}`;
  if (trimmed.length > max)
    return `${label} must be at most ${max} characters`;
  return null;
}

/**
 * Future date (calendar day). Used for coupon expiry — the value is a
 * `YYYY-MM-DD` string from a <input type="date">. An empty value is allowed
 * (callers treat "no expiry" as valid); a past/today date is rejected.
 */
export function validateFutureDate(
  value: string,
  { label = 'Date' }: { label?: string } = {},
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const target = new Date(trimmed);
  if (Number.isNaN(target.getTime())) return `Enter a valid ${label.toLowerCase()}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (target.getTime() <= today.getTime())
    return `${label} must be in the future`;
  return null;
}
