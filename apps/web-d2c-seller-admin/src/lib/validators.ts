/**
 * Canonical, cross-app field-level validators.
 *
 * Every validator returns an error-message string when the value is
 * invalid, or `null` when it is valid. Wire them into a form's existing
 * submit handler: compute the first error, set the form's existing error
 * state, and return before the API call.
 *
 * Profile-specific validators (name, address, etc.) live in
 * `./profile-validators`. This file holds the shared money/contact/file/
 * date/text primitives shared across the SportsMart admin apps.
 */

interface AmountOptions {
  min?: number;
  max?: number;
  decimals?: number;
  label?: string;
}

/**
 * Money / numeric amount. Trims, requires a value, must be finite, within
 * [min, max], and have at most `decimals` decimal places.
 *
 * For money INTO a ledger use a sane max (default 10_000_000). For a signed
 * adjustment pass `min: -10_000_000`.
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
  const raw = typeof value === 'number' ? String(value) : (value ?? '').trim();
  if (raw === '') return `${label} is required`;
  const num = Number(raw);
  if (!Number.isFinite(num)) return `${label} must be a valid number`;
  if (num < min) return `${label} must be at least ${min}`;
  if (num > max) return `${label} must not exceed ${max}`;
  const decimalPart = raw.split('.')[1];
  if (decimalPart && decimalPart.replace(/0+$/, '').length > decimals) {
    return decimals === 0
      ? `${label} must be a whole number`
      : `${label} can have at most ${decimals} decimal place${decimals === 1 ? '' : 's'}`;
  }
  return null;
}

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
export function validatePincode(value: string): string | null {
  if (!PINCODE_REGEX.test((value ?? '').trim())) {
    return 'Enter a valid 6-digit pincode';
  }
  return null;
}

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
export function validateIndianMobile(value: string): string | null {
  if (!INDIAN_MOBILE_REGEX.test((value ?? '').trim())) {
    return 'Enter a valid 10-digit mobile number (starts 6-9)';
  }
  return null;
}

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
export function validateGSTIN(value: string): string | null {
  const v = (value ?? '').trim().toUpperCase();
  if (v.length !== 15 || !GSTIN_REGEX.test(v)) {
    return 'Enter a valid 15-character GSTIN';
  }
  return null;
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export function validatePAN(value: string): string | null {
  if (!PAN_REGEX.test((value ?? '').trim().toUpperCase())) {
    return 'Enter a valid 10-character PAN';
  }
  return null;
}

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function validateIFSC(value: string): string | null {
  if (!IFSC_REGEX.test((value ?? '').trim().toUpperCase())) {
    return 'Enter a valid IFSC code';
  }
  return null;
}

const OTP_REGEX = /^\d{6}$/;
export function validateOtp(value: string): string | null {
  if (!OTP_REGEX.test((value ?? '').trim())) {
    return 'Code must be exactly 6 digits';
  }
  return null;
}

/**
 * Strong password: length 8-128 with an uppercase, a lowercase, a digit,
 * and a special character.
 */
export function validateStrongPassword(value: string): string | null {
  const v = value ?? '';
  if (v.length < 8) return 'Password must be at least 8 characters';
  if (v.length > 128) return 'Password must not exceed 128 characters';
  if (!/[A-Z]/.test(v)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(v)) return 'Password must contain a lowercase letter';
  if (!/\d/.test(v)) return 'Password must contain a digit';
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(v)) {
    return 'Password must contain a special character';
  }
  return null;
}

interface DateRangeOptions {
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
  if (Number.isNaN(s) || Number.isNaN(e)) {
    return 'Both start and end dates are required';
  }
  if (allowEqual ? s > e : s >= e) {
    return 'End date must be after the start date';
  }
  return null;
}

interface UploadFileOptions {
  maxBytes?: number;
  types?: string[];
}
export function validateUploadFile(
  file: File | null | undefined,
  {
    maxBytes = 5 * 1024 * 1024,
    types = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  }: UploadFileOptions = {},
): string | null {
  if (!file) return 'Please select a file';
  if (!types.includes(file.type)) {
    return 'Unsupported file type';
  }
  if (file.size > maxBytes) {
    return `File must be smaller than ${Math.round(maxBytes / (1024 * 1024))}MB`;
  }
  return null;
}

interface TextOptions {
  min?: number;
  max?: number;
  label?: string;
  required?: boolean;
}
export function validateText(
  value: string,
  {
    min = 1,
    max = 500,
    label = 'This field',
    required = true,
  }: TextOptions = {},
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return required ? `${label} is required` : null;
  }
  if (trimmed.length < min) {
    return `${label} must be at least ${min} character${min === 1 ? '' : 's'}`;
  }
  if (trimmed.length > max) {
    return `${label} must not exceed ${max} characters`;
  }
  return null;
}
