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
