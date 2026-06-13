/**
 * Canonical field-level validators for the admin storefront.
 *
 * Every validator returns an error-message string when the value is
 * invalid, or `null` when it passes. Wire the FIRST non-null result into
 * a form's existing error state and return BEFORE the API call.
 *
 * These signatures + regexes are shared verbatim across every Sportsmart
 * app so the same input validates identically everywhere. If you change a
 * rule here, change it in the other apps' validators too.
 */

export interface AmountOptions {
  min?: number;
  max?: number;
  decimals?: number;
  label?: string;
}

/**
 * Validate a money/amount string or number.
 *
 * - trims (when string), required
 * - finite
 * - >= min, <= max
 * - at most `decimals` decimal places
 *
 * For money flowing INTO a ledger keep `max` sane (default 10,000,000).
 * For a signed adjustment field pass `min: -10_000_000`.
 */
export function validateAmount(
  value: string | number | null | undefined,
  { min = 0, max = 10_000_000, decimals = 2, label = 'Amount' }: AmountOptions = {},
): string | null {
  const raw = typeof value === 'number' ? String(value) : (value ?? '').trim();
  if (raw === '') return `${label} is required`;

  const num = Number(raw);
  if (!Number.isFinite(num)) return `${label} must be a valid number`;
  if (num < min) return `${label} must be at least ${min}`;
  if (num > max) return `${label} must not exceed ${max.toLocaleString('en-IN')}`;

  const dot = raw.indexOf('.');
  if (dot !== -1 && raw.length - dot - 1 > decimals) {
    return decimals === 0
      ? `${label} must be a whole number`
      : `${label} can have at most ${decimals} decimal place${decimals === 1 ? '' : 's'}`;
  }
  return null;
}

export function validatePincode(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return /^[1-9][0-9]{5}$/.test(v) ? null : 'Enter a valid 6-digit pincode';
}

export function validateIndianMobile(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return /^[6-9]\d{9}$/.test(v)
    ? null
    : 'Enter a valid 10-digit mobile number (starts 6-9)';
}

export function validateGSTIN(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toUpperCase();
  if (v.length !== 15) return 'GSTIN must be 15 characters';
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(v)
    ? null
    : 'Enter a valid GSTIN';
}

export function validatePAN(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : 'Enter a valid PAN';
}

export function validateIFSC(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? null : 'Enter a valid IFSC code';
}

export function validateOtp(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return /^\d{6}$/.test(v) ? null : 'Code must be exactly 6 digits';
}

/**
 * Strong password: length 8-128, has uppercase, lowercase, digit, special.
 */
export function validateStrongPassword(value: string | null | undefined): string | null {
  const v = value ?? '';
  if (v.length < 8 || v.length > 128) return 'Password must be 8-128 characters';
  if (!/[A-Z]/.test(v)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(v)) return 'Password must include a lowercase letter';
  if (!/\d/.test(v)) return 'Password must include a number';
  // eslint-disable-next-line no-useless-escape
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v))
    return 'Password must include a special character';
  return null;
}

export interface DateRangeOptions {
  allowEqual?: boolean;
}

/**
 * Both dates present + parseable + start <= end (or < end when allowEqual=false).
 */
export function validateDateRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  { allowEqual = true }: DateRangeOptions = {},
): string | null {
  if (start == null || start === '') return 'Start date is required';
  if (end == null || end === '') return 'End date is required';
  const s = start instanceof Date ? start : new Date(start);
  const e = end instanceof Date ? end : new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()))
    return 'Enter valid dates';
  const ok = allowEqual ? s.getTime() <= e.getTime() : s.getTime() < e.getTime();
  return ok ? null : 'End date must be after the start date';
}

export interface UploadFileOptions {
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
  if (!file) return 'A file is required';
  if (types.length > 0 && !types.includes(file.type))
    return 'Unsupported file type';
  if (file.size > maxBytes)
    return `File must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller`;
  return null;
}

export interface TextOptions {
  min?: number;
  max?: number;
  label?: string;
  required?: boolean;
}

export function validateText(
  value: string | null | undefined,
  { min = 1, max = 500, label = 'This field', required = true }: TextOptions = {},
): string | null {
  const v = (value ?? '').trim();
  if (v === '') return required ? `${label} is required` : null;
  if (v.length < min) return `${label} must be at least ${min} characters`;
  if (v.length > max) return `${label} must be at most ${max} characters`;
  return null;
}
