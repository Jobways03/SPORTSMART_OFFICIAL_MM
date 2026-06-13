/**
 * Canonical field-level validators shared across every SportsMart admin/seller
 * app. Each returns an error-message string, or `null` when the value is valid.
 *
 * Keep the signatures + regexes IN SYNC with the other apps so a value that
 * passes here passes everywhere (and vice-versa). Profile-specific validators
 * (seller name, shop name, address, …) live in ./profile-validators.ts.
 */

// ── Amount ────────────────────────────────────────────────────────────────

interface AmountOptions {
  /** Lower bound (inclusive). Use a negative for signed adjustments. */
  min?: number;
  /** Upper bound (inclusive). */
  max?: number;
  /** Max number of decimal places allowed. */
  decimals?: number;
  /** Field label used in the error messages. */
  label?: string;
}

/**
 * Validate a money / numeric amount typed as a string.
 *
 * Rejects: empty, non-finite, below `min`, above `max`, or more than
 * `decimals` fractional digits. For money INTO a ledger keep a sane `max`
 * (default 10,000,000). For a signed adjustment pass `min: -10_000_000`.
 */
export function validateAmount(
  value: string | number,
  {
    min = 0,
    max = 10_000_000,
    decimals = 2,
    label = 'Amount',
  }: AmountOptions = {},
): string | null {
  const raw = typeof value === 'number' ? String(value) : value;
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return `${label} is required`;

  const num = Number(trimmed);
  if (!Number.isFinite(num)) return `${label} must be a valid number`;
  if (num < min) return `${label} must be at least ${min}`;
  if (num > max) return `${label} must not exceed ${max}`;

  const decimalPart = trimmed.includes('.') ? trimmed.split('.')[1] : '';
  if (decimalPart.length > decimals) {
    return decimals === 0
      ? `${label} must be a whole number`
      : `${label} must have at most ${decimals} decimal places`;
  }
  return null;
}

// ── Indian statutory identifiers ────────────────────────────────────────────

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validatePincode(value: string): string | null {
  if (!PINCODE_REGEX.test((value ?? '').trim()))
    return 'Enter a valid 6-digit pincode';
  return null;
}

export function validateIndianMobile(value: string): string | null {
  if (!INDIAN_MOBILE_REGEX.test((value ?? '').trim()))
    return 'Enter a valid 10-digit mobile number (starts 6-9)';
  return null;
}

export function validateGSTIN(value: string): string | null {
  const v = (value ?? '').trim().toUpperCase();
  if (v.length !== 15 || !GSTIN_REGEX.test(v)) return 'Enter a valid 15-character GSTIN';
  return null;
}

export function validatePAN(value: string): string | null {
  const v = (value ?? '').trim().toUpperCase();
  if (!PAN_REGEX.test(v)) return 'Enter a valid PAN (e.g. ABCDE1234F)';
  return null;
}

export function validateIFSC(value: string): string | null {
  const v = (value ?? '').trim().toUpperCase();
  if (!IFSC_REGEX.test(v)) return 'Enter a valid IFSC code';
  return null;
}

// ── OTP / codes ──────────────────────────────────────────────────────────

export function validateOtp(value: string): string | null {
  if (!/^\d{6}$/.test((value ?? '').trim())) return 'Code must be exactly 6 digits';
  return null;
}

// ── Password ──────────────────────────────────────────────────────────────

/**
 * Strong-password rule shared with the rest of the suite: 8-128 chars and at
 * least one uppercase, one lowercase, one digit, and one special character.
 */
export function validateStrongPassword(value: string): string | null {
  const v = value ?? '';
  if (v.length < 8) return 'Password must be at least 8 characters';
  if (v.length > 128) return 'Password must not exceed 128 characters';
  if (!/[A-Z]/.test(v)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(v)) return 'Password must contain a lowercase letter';
  if (!/\d/.test(v)) return 'Password must contain a digit';
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(v))
    return 'Password must contain a special character';
  return null;
}

// ── Date range ───────────────────────────────────────────────────────────

interface DateRangeOptions {
  /** When false, the start must be strictly before the end. */
  allowEqual?: boolean;
}

export function validateDateRange(
  start: string,
  end: string,
  { allowEqual = true }: DateRangeOptions = {},
): string | null {
  if (!start || !end) return 'Both start and end dates are required';
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 'Enter valid dates';
  if (allowEqual ? s > e : s >= e) return 'End date must be after the start date';
  return null;
}

// ── File upload ──────────────────────────────────────────────────────────

interface UploadFileOptions {
  maxBytes?: number;
  types?: string[];
}

const DEFAULT_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export function validateUploadFile(
  file: File | null,
  {
    maxBytes = 5 * 1024 * 1024,
    types = DEFAULT_UPLOAD_TYPES,
  }: UploadFileOptions = {},
): string | null {
  if (!file) return 'Please select a file';
  if (!types.includes(file.type)) {
    const friendly = types
      .map((t) => t.split('/')[1]?.toUpperCase() ?? t)
      .join(', ');
    return `File must be one of: ${friendly}`;
  }
  if (file.size === 0) return 'Selected file appears to be empty';
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    return `File must be smaller than ${mb}MB`;
  }
  return null;
}

// ── Free text ────────────────────────────────────────────────────────────

interface TextOptions {
  min?: number;
  max?: number;
  label?: string;
  required?: boolean;
}

export function validateText(
  value: string,
  { min = 1, max = 500, label = 'This field', required = true }: TextOptions = {},
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    if (required) return `${label} is required`;
    return null;
  }
  if (trimmed.length < min)
    return `${label} must be at least ${min} character${min === 1 ? '' : 's'}`;
  if (trimmed.length > max) return `${label} must not exceed ${max} characters`;
  return null;
}
