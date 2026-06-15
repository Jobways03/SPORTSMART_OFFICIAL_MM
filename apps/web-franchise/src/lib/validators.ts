const NAME_REGEX = /^[a-zA-Z][a-zA-Z\s.\-]*$/;
const BUSINESS_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\s.\-&']*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;

export function validateOwnerName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Owner name is required';
  if (trimmed.length < 2) return 'Owner name must be at least 2 characters';
  if (trimmed.length > 100) return 'Owner name must not exceed 100 characters';
  if (!NAME_REGEX.test(trimmed))
    return 'Name can only contain letters, spaces, dots, and hyphens';
  return null;
}

// Strict person-name rule: alphabets only. Must start with a letter and may
// contain only letters, spaces, periods, apostrophes and hyphens — NO digits
// and NO other special characters (@ # $ % ^ & * _ + = etc.). Length 2-50.
// Use for every PERSON name field (account holder, customer, staff, nominee,
// contact person, etc.). Business / shop / brand names must NOT use this —
// they legitimately contain digits and "&" (see validateBusinessName).
const PERSON_NAME_REGEX = /^[A-Za-z][A-Za-z .'-]*$/;
export function validatePersonName(value: string, label = 'Name'): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return `${label} is required`;
  if (trimmed.length < 2) return `${label} is too short`;
  if (trimmed.length > 50) return `${label} is too long`;
  if (!PERSON_NAME_REGEX.test(trimmed)) return `${label} must contain only letters`;
  return null;
}

export function validateBusinessName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Business name is required';
  if (trimmed.length < 2) return 'Business name must be at least 2 characters';
  if (trimmed.length > 150) return 'Business name must not exceed 150 characters';
  if (!BUSINESS_NAME_REGEX.test(trimmed)) return 'Business name contains invalid characters';
  return null;
}

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Email is required';
  if (trimmed.includes(' ')) return 'Email must not contain spaces';
  if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address';
  if (trimmed.length > 255) return 'Email is too long';
  return null;
}

// India mobile rule: exactly 10 digits, first digit 6-9. TRAI reserves
// 6/7/8/9 prefixes for cellular operators; 0-5 prefixes are landline
// area codes that won't reach a phone via SMS/WhatsApp.
export function validatePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Phone number is required';
  if (/\D/.test(trimmed)) return 'Phone number must contain only digits';
  if (trimmed.length !== 10) return 'Phone number must be exactly 10 digits';
  if (!/^[6-9]/.test(trimmed)) return 'Phone number must start with 6, 7, 8, or 9';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Password is required';
  if (value !== value.trim()) return 'Password must not start or end with spaces';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 128) return 'Password must not exceed 128 characters';
  if (!HAS_UPPERCASE.test(value)) return 'Password must include an uppercase letter';
  if (!HAS_LOWERCASE.test(value)) return 'Password must include a lowercase letter';
  if (!HAS_DIGIT.test(value)) return 'Password must include a number';
  if (!HAS_SPECIAL.test(value)) return 'Password must include a special character';
  return null;
}

export function validateIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Email or phone number is required';

  if (trimmed.includes('@')) {
    if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address';
  } else {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length === 0) return 'Please enter a valid email or phone number';
    if (digits.length < 10) return 'Phone number must be at least 10 digits';
    if (digits.length > 15) return 'Phone number must not exceed 15 digits';
  }
  return null;
}

export function validateLoginPassword(value: string): string | null {
  if (!value || !value.trim()) return 'Password is required';
  return null;
}

export function validateOtp(value: string): string | null {
  if (!value) return 'Verification code is required';
  if (!/^\d{6}$/.test(value)) return 'Code must be exactly 6 digits';
  return null;
}

export function validateConfirmPassword(password: string, confirmPassword: string): string | null {
  if (!confirmPassword) return 'Please confirm your password';
  if (password !== confirmPassword) return 'Passwords do not match';
  return null;
}

export function getPasswordStrength(value: string) {
  return {
    hasMinLength: value.length >= 8,
    hasUppercase: HAS_UPPERCASE.test(value),
    hasLowercase: HAS_LOWERCASE.test(value),
    hasDigit: HAS_DIGIT.test(value),
    hasSpecial: HAS_SPECIAL.test(value),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Canonical, cross-app field-level validators. Each returns an error-message
// string when invalid, or null when valid — wire into a form's existing submit
// handler: compute the first error, set the form's existing error state, and
// return before the API call. Signatures/regexes are kept identical across the
// SportsMart apps so every app validates the same way. The strong-password and
// OTP rules already live above (validatePassword / validateOtp) and are reused
// rather than duplicated.
// ───────────────────────────────────────────────────────────────────────────

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
