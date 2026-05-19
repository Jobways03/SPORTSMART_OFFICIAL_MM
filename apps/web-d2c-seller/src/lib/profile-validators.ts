const SELLER_NAME_REGEX = /^[a-zA-Z][a-zA-Z\s.\-]*$/;
const SHOP_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9\s.\-&']*$/;
const COUNTRY_CODE_REGEX = /^\+\d{1,4}$/;
const PHONE_DIGITS_REGEX = /^\d+$/;
const CITY_STATE_REGEX = /^[a-zA-Z][a-zA-Z\s\-.']*$/;
const COUNTRY_REGEX = /^[a-zA-Z][a-zA-Z\s]*$/;
const ZIP_REGEX = /^[a-zA-Z0-9\s\-]+$/;

export function validateProfileSellerName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Seller name is required';
  if (trimmed.length < 2) return 'Seller name must be at least 2 characters';
  if (trimmed.length > 100) return 'Seller name must not exceed 100 characters';
  if (!SELLER_NAME_REGEX.test(trimmed))
    return 'Name must start with a letter and contain only letters, spaces, dots, or hyphens';
  return null;
}

export function validateProfileShopName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Shop name is required';
  if (trimmed.length < 2) return 'Shop name must be at least 2 characters';
  if (trimmed.length > 150) return 'Shop name must not exceed 150 characters';
  if (!SHOP_NAME_REGEX.test(trimmed))
    return 'Shop name must start with a letter or number and can contain letters, numbers, spaces, dots, hyphens, & or \'';
  return null;
}

export function validateCountryCode(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null; // optional standalone, cross-field validated separately
  if (!COUNTRY_CODE_REGEX.test(trimmed)) return 'Invalid country code format';
  return null;
}

export function validateContactNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null; // optional standalone
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return 'Phone number must contain only digits';
  if (digits.length < 7) return 'Phone number must be at least 7 digits';
  if (digits.length > 15) return 'Phone number must not exceed 15 digits';
  if (!PHONE_DIGITS_REGEX.test(digits)) return 'Phone number must contain only digits';
  return null;
}

export function validatePhoneCrossField(
  countryCode: string,
  contactNumber: string,
): string | null {
  const hasCode = countryCode.trim().length > 0;
  const hasPhone = contactNumber.trim().length > 0;
  if (hasCode && !hasPhone) return 'Phone number is required with country code';
  if (hasPhone && !hasCode) return 'Country code is required with phone number';
  return null;
}

export function validateStoreAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Store address is required';
  if (trimmed.length < 5) return 'Store address must be at least 5 characters';
  if (trimmed.length > 500) return 'Store address must not exceed 500 characters';
  return null;
}

export function validateCity(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'City is required';
  if (trimmed.length < 2) return 'City must be at least 2 characters';
  if (trimmed.length > 100) return 'City must not exceed 100 characters';
  if (!CITY_STATE_REGEX.test(trimmed))
    return 'City must start with a letter and contain only letters, spaces, hyphens, dots, or apostrophes';
  return null;
}

export function validateState(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'State is required';
  if (trimmed.length < 2) return 'State must be at least 2 characters';
  if (trimmed.length > 100) return 'State must not exceed 100 characters';
  if (!CITY_STATE_REGEX.test(trimmed))
    return 'State must start with a letter and contain only letters, spaces, hyphens, dots, or apostrophes';
  return null;
}

export function validateCountry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Country is required';
  if (trimmed.length < 2) return 'Country must be at least 2 characters';
  if (trimmed.length > 100) return 'Country must not exceed 100 characters';
  if (!COUNTRY_REGEX.test(trimmed))
    return 'Country must contain only letters and spaces';
  return null;
}

export function validateZipCode(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'ZIP/PIN code is required';
  if (trimmed.length < 3) return 'ZIP/PIN code must be at least 3 characters';
  if (trimmed.length > 20) return 'ZIP/PIN code must not exceed 20 characters';
  if (!ZIP_REGEX.test(trimmed))
    return 'ZIP/PIN code must contain only letters, numbers, spaces, or hyphens';
  return null;
}

// Rich text utilities
export function isEditorEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  const plainText = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return plainText.length === 0;
}

export function getPlainTextLength(html: string | null | undefined): number {
  if (!html) return 0;
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim().length;
}

export function validateRichText(
  value: string,
  label: string,
  maxLength: number,
): string | null {
  if (isEditorEmpty(value)) return `${label} is required`;
  const len = getPlainTextLength(value);
  if (len > maxLength) return `${label} must not exceed ${maxLength} characters`;
  return null;
}

// Image validation
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function validateImageFile(file: File | null): string | null {
  if (!file) return 'Please select an image file';
  if (!ALLOWED_IMAGE_TYPES.includes(file.type))
    return 'Only JPG, PNG, and WEBP images are allowed';
  if (file.size === 0) return 'Selected file appears to be empty';
  if (file.size > MAX_FILE_SIZE) return 'Image must be smaller than 5MB';
  return null;
}
