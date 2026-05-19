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
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return 'Phone number must contain only digits';
  if (digits.length < 10) return 'Phone number must be at least 10 digits';
  if (digits.length > 15) return 'Phone number must not exceed 15 digits';
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
