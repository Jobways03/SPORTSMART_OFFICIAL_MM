export interface FieldError {
  field: string;
  message: string;
}

const NAME_REGEX = /^[a-zA-Z][a-zA-Z\s]*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;

export function validateFirstName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'First name is required';
  if (trimmed.length < 2) return 'First name must be at least 2 characters';
  if (trimmed.length > 50) return 'First name must not exceed 50 characters';
  if (!NAME_REGEX.test(trimmed)) return 'First name must contain only letters';
  return null;
}

export function validateLastName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Last name is required';
  if (trimmed.length > 50) return 'Last name must not exceed 50 characters';
  if (!NAME_REGEX.test(trimmed)) return 'Last name must contain only letters';
  return null;
}

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Email is required';
  if (trimmed.includes(' ')) return 'Email must not contain spaces';
  if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Password is required';
  if (value !== value.trim()) return 'Password must not start or end with a space';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 128) return 'Password must not exceed 128 characters';
  if (!HAS_UPPERCASE.test(value)) return 'Password must include an uppercase letter';
  if (!HAS_LOWERCASE.test(value)) return 'Password must include a lowercase letter';
  if (!HAS_DIGIT.test(value)) return 'Password must include a number';
  if (!HAS_SPECIAL.test(value)) return 'Password must include a special character';
  return null;
}

export function validateLoginEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Email is required';
  if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address';
  return null;
}

export function validateLoginPassword(value: string): string | null {
  if (!value || !value.trim()) return 'Password is required';
  return null;
}

export function validateOtp(value: string): string | null {
  if (!value) return 'OTP is required';
  if (!/^\d{6}$/.test(value)) return 'OTP must be exactly 6 digits';
  return null;
}

export function validateConfirmPassword(password: string, confirmPassword: string): string | null {
  if (!confirmPassword) return 'Please confirm your password';
  if (password !== confirmPassword) return 'Passwords do not match';
  return null;
}

// ---------------------------------------------------------------------------
// Canonical field-level validators (shared signatures across all apps).
// Each returns an error-message string or null when valid.
// ---------------------------------------------------------------------------

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validatePincode(value: string): string | null {
  if (!PINCODE_REGEX.test((value ?? '').trim())) return 'Enter a valid 6-digit pincode';
  return null;
}

export function validateIndianMobile(value: string): string | null {
  if (!INDIAN_MOBILE_REGEX.test((value ?? '').trim())) {
    return 'Enter a valid 10-digit mobile number (starts 6-9)';
  }
  return null;
}

export function validateGSTIN(value: string): string | null {
  const normalized = (value ?? '').trim().toUpperCase();
  if (normalized.length !== 15 || !GSTIN_REGEX.test(normalized)) {
    return 'Enter a valid 15-character GSTIN';
  }
  return null;
}

export function validatePAN(value: string): string | null {
  const normalized = (value ?? '').trim().toUpperCase();
  if (!PAN_REGEX.test(normalized)) return 'Enter a valid 10-character PAN';
  return null;
}

export function validateIFSC(value: string): string | null {
  if (!IFSC_REGEX.test((value ?? '').trim().toUpperCase())) return 'Enter a valid IFSC code';
  return null;
}

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
  if (trimmed.length < min) return `${label} must be at least ${min} characters`;
  if (trimmed.length > max) return `${label} must not exceed ${max} characters`;
  return null;
}

export function validateAmount(
  value: string | number,
  {
    min = 0,
    max = 10_000_000,
    decimals = 2,
    label = 'Amount',
  }: { min?: number; max?: number; decimals?: number; label?: string } = {},
): string | null {
  const raw = typeof value === 'number' ? String(value) : (value ?? '').trim();
  if (!raw) return `${label} is required`;
  const num = Number(raw);
  if (!Number.isFinite(num)) return `Enter a valid ${label.toLowerCase()}`;
  if (num < min) return `${label} must be at least ${min}`;
  if (num > max) return `${label} must not exceed ${max}`;
  const decimalPart = raw.includes('.') ? raw.split('.')[1] ?? '' : '';
  if (decimalPart.length > decimals) {
    return `${label} can have at most ${decimals} decimal place${decimals === 1 ? '' : 's'}`;
  }
  return null;
}

export function validateDateRange(
  start: string,
  end: string,
  { allowEqual = true }: { allowEqual?: boolean } = {},
): string | null {
  if (!start || !end) return 'Both start and end dates are required';
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return 'Both start and end dates are required';
  }
  if (allowEqual ? startTime > endTime : startTime >= endTime) {
    return 'End date must be after the start date';
  }
  return null;
}

export function validateUploadFile(
  file: File | null | undefined,
  {
    maxBytes = 5 * 1024 * 1024,
    types = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  }: { maxBytes?: number; types?: string[] } = {},
): string | null {
  if (!file) return 'Please select a file';
  if (!types.includes(file.type)) return 'Unsupported file type';
  if (file.size > maxBytes) {
    return `File must be smaller than ${Math.round(maxBytes / (1024 * 1024))}MB`;
  }
  return null;
}
