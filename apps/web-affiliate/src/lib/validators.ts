// Phase 252 — affiliate form field validators. Each returns an error message
// string, or null when the value is valid. Mirrors the seller/franchise apps'
// `lib/validators.ts` convention so forms validate before hitting the API.

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// UPI VPA: handle@psp — handle is alphanumeric/._- (2+), psp is letters (2+).
const UPI_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
const NAME_REGEX = /^[A-Za-z][A-Za-z .'-]*$/;
// Business / shop / bank / brand name: letters AND digits plus a small set of
// punctuation (& . , - / ( ) ' and space). Digits are deliberately allowed.
const BUSINESS_NAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const OTP_REGEX = /^\d{6}$/;

// ───────────────────────────────────────────────────────────────────────────
// onChange input filters. These strip-as-you-type so the stored value can only
// ever hold characters the field permits (paste-safe). Submit validators above
// still run as the source of truth — the filters just keep the UI honest.

/** Person-name keystroke filter — letters, space, period, apostrophe, hyphen. */
export function filterPersonNameInput(value: string): string {
  return (value ?? '').replace(/[^A-Za-z .'-]/g, '');
}

/**
 * Business / shop / bank / brand-name keystroke filter — keeps letters AND
 * digits plus & . , - / ( ) ' and space. Never strips digits.
 */
export function filterBusinessNameInput(value: string): string {
  return (value ?? '').replace(/[^A-Za-z0-9 &.,\-/()']/g, '');
}

/** Bank account number — digits only, 9–18 long (covers all Indian banks). */
export function validateBankAccount(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Account number is required';
  if (!/^\d+$/.test(trimmed)) return 'Account number must contain only digits';
  if (trimmed.length < 9 || trimmed.length > 18)
    return 'Account number must be 9 to 18 digits';
  return null;
}

/** IFSC — 4 letters + 0 + 6 alphanumerics (e.g. HDFC0001234). */
export function validateIFSC(value: string): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  if (!trimmed) return 'IFSC code is required';
  if (!IFSC_REGEX.test(trimmed))
    return 'Enter a valid 11-character IFSC (e.g. HDFC0001234)';
  return null;
}

/** Account holder name — required, letters/spaces/.'- , min 2 chars. */
export function validateAccountHolderName(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Account holder name is required';
  if (trimmed.length < 2) return 'Account holder name is too short';
  if (!NAME_REGEX.test(trimmed))
    return 'Account holder name contains invalid characters';
  return null;
}

/**
 * Person name — ALPHABETS ONLY (first/last/full/owner/contact names, etc.).
 * Must start with a letter; allows only letters, spaces, period, apostrophe,
 * and hyphen. NO digits, NO other special characters. Length 2–50.
 */
export function validatePersonName(value: string, label = 'Name'): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return `${label} is required`;
  if (trimmed.length < 2) return `${label} is too short`;
  if (trimmed.length > 50) return `${label} is too long`;
  if (!NAME_REGEX.test(trimmed)) return `${label} must contain only letters`;
  return null;
}

/** UPI VPA — handle@psp. */
export function validateUPI(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'UPI ID is required';
  if (!UPI_REGEX.test(trimmed)) return 'Enter a valid UPI ID (e.g. name@upi)';
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Canonical, cross-app field-level validators. Signatures + regexes are kept
// identical to the seller/franchise apps so every app validates the same way.

/** Email — trimmed, no spaces, RFC-ish local@domain.tld, max 255 chars. */
export function validateEmail(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Email is required';
  if (trimmed.includes(' ')) return 'Email must not contain spaces';
  if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address';
  if (trimmed.length > 255) return 'Email is too long';
  return null;
}

/** India mobile — exactly 10 digits, first digit 6–9. */
export function validateIndianMobile(value: string): string | null {
  if (!INDIAN_MOBILE_REGEX.test((value ?? '').trim())) {
    return 'Enter a valid 10-digit mobile number (starts 6-9)';
  }
  return null;
}

/** 6-digit numeric OTP. */
export function validateOtp(value: string): string | null {
  if (!OTP_REGEX.test((value ?? '').trim())) {
    return 'Code must be exactly 6 digits';
  }
  return null;
}

/**
 * Strong password: length 8–128 with an uppercase, a lowercase, a digit, and
 * a special character. Exported as `validatePassword` (the app's convention).
 */
export function validatePassword(value: string): string | null {
  const v = value ?? '';
  if (!v) return 'Password is required';
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

interface TextOptions {
  min?: number;
  max?: number;
  label?: string;
  required?: boolean;
}

/** Free-text field — required/empty check plus length bounds. */
export function validateText(
  value: string,
  { min = 1, max = 500, label = 'This field', required = true }: TextOptions = {},
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

/**
 * Business / shop / bank / brand / legal name — letters AND digits plus a small
 * punctuation set (& . , - / ( ) ' and space). Unlike a person name, digits are
 * allowed (e.g. "3M India", "Bank of America (NA)"). Length 2–150 by default.
 * `required: false` lets optional fields (e.g. an optional bank name) pass when
 * left blank.
 */
export function validateBusinessName(
  value: string,
  { label = 'Name', required = true }: { label?: string; required?: boolean } = {},
): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return required ? `${label} is required` : null;
  if (trimmed.length < 2) return `${label} is too short`;
  if (trimmed.length > 150) return `${label} is too long`;
  if (!BUSINESS_NAME_REGEX.test(trimmed))
    return `${label} contains invalid characters`;
  return null;
}
