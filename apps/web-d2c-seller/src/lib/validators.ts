const SELLER_NAME_REGEX = /^[a-zA-Z][a-zA-Z\s.\-]*$/;
const SHOP_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\s.\-&']*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HAS_UPPERCASE = /[A-Z]/;
const HAS_LOWERCASE = /[a-z]/;
const HAS_DIGIT = /\d/;
const HAS_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;

export function validateSellerName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Seller name is required';
  if (trimmed.length < 2) return 'Seller name must be at least 2 characters';
  if (trimmed.length > 100) return 'Seller name must not exceed 100 characters';
  if (!SELLER_NAME_REGEX.test(trimmed))
    return 'Name can only contain letters, spaces, dots, and hyphens';
  return null;
}

export function validateShopName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Shop name is required';
  if (trimmed.length < 2) return 'Shop name must be at least 2 characters';
  if (trimmed.length > 150) return 'Shop name must not exceed 150 characters';
  if (!SHOP_NAME_REGEX.test(trimmed)) return 'Shop name contains invalid characters';
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

export function validatePhoneNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Phone number is required';
  // Phase 18 (2026-05-20) — strict India mobile format mirroring
  // the backend DTO so frontend rejects the same shapes the server
  // will. Strip leading 91 country-code if the user typed it.
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  }
  if (digits.length === 0) return 'Phone number must contain only digits';
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return 'Enter a 10-digit Indian mobile number starting with 6, 7, 8, or 9';
  }
  return null;
}

// Phase 18 helpers `validateConfirmPassword` and `validateOtp` live
// below (single source of truth at the bottom of this file).

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
    // Treat as email
    if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address';
  } else {
    // Treat as phone
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

// ---------------------------------------------------------------------------
// Canonical field-level validators (cross-app parity). Each returns an
// error-message string or null when valid. Signatures + regexes are shared
// verbatim across the seller / admin / storefront apps so every surface
// rejects the same shapes the backend DTOs do.
// ---------------------------------------------------------------------------

const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

// Person name: must start with a letter; only letters, spaces, period,
// apostrophe, hyphen — NO digits, NO other special characters. Mirrors the
// backend's person-name rule. Use this for any human-name field (account
// holder, contact person, nominee, etc.). Business / shop names stay
// permissive (see validateShopName) — do NOT use this for those.
const PERSON_NAME_REGEX = /^[A-Za-z][A-Za-z .'-]*$/;

/**
 * Strict person-name validator — alphabets only (plus space, period,
 * apostrophe, hyphen). Required, 2-50 chars, no digits, no other specials.
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

/** Strict 6-digit Indian PIN code (no leading zero). */
export function validatePincode(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Enter a valid 6-digit pincode';
  if (!PINCODE_REGEX.test(trimmed)) return 'Enter a valid 6-digit pincode';
  return null;
}

/** Strict 10-digit Indian mobile starting 6-9. Strips a leading 91. */
export function validateIndianMobile(value: string): string | null {
  let digits = (value ?? '').trim().replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  if (!INDIAN_MOBILE_REGEX.test(digits)) {
    return 'Enter a valid 10-digit mobile number (starts 6-9)';
  }
  return null;
}

interface ValidateTextOptions {
  min?: number;
  max?: number;
  label?: string;
  required?: boolean;
}

/** Required/empty + length-bounds check for free text fields. */
export function validateText(
  value: string,
  { min = 1, max = 500, label = 'This field', required = true }: ValidateTextOptions = {},
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

interface ValidateAmountOptions {
  min?: number;
  max?: number;
  decimals?: number;
  label?: string;
}

/** Money amount: finite, within bounds, at most `decimals` decimal places. */
export function validateAmount(
  value: string | number,
  { min = 0, max = 10_000_000, decimals = 2, label = 'Amount' }: ValidateAmountOptions = {},
): string | null {
  const raw = typeof value === 'number' ? String(value) : (value ?? '').trim();
  if (!raw) return `${label} is required`;
  const num = Number(raw);
  if (!Number.isFinite(num)) return `${label} must be a valid number`;
  if (num < min) return `${label} must be at least ${min}`;
  if (num > max) return `${label} must not exceed ${max}`;
  const decimalPart = raw.includes('.') ? raw.split('.')[1] : '';
  if (decimalPart.length > decimals) {
    return `${label} can have at most ${decimals} decimal place${decimals === 1 ? '' : 's'}`;
  }
  return null;
}

interface ValidateUploadFileOptions {
  maxBytes?: number;
  types?: string[];
}

/** Upload guard: present, allowed MIME type, size within `maxBytes`. */
export function validateUploadFile(
  file: File | null | undefined,
  {
    maxBytes = 5 * 1024 * 1024,
    types = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  }: ValidateUploadFileOptions = {},
): string | null {
  if (!file) return 'Please select a file';
  if (!types.includes(file.type)) {
    return 'File type is not allowed';
  }
  if (file.size > maxBytes) {
    return `File must be smaller than ${Math.round(maxBytes / (1024 * 1024))}MB`;
  }
  return null;
}
