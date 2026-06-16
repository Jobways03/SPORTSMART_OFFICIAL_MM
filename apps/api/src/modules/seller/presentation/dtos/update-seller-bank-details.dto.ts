import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 19 (2026-05-20) — Seller bank-details input.
 *
 * Field-level format checks happen at the DTO layer (cheap reject),
 * cross-field + persistence happens in `SellerBankDetailsService`.
 * The DTO does NOT echo back; the controller returns the masked
 * view (`accountNumberLast4`) only.
 */
export class UpdateSellerBankDetailsDto {
  @IsNotEmpty({ message: 'Account holder name is required' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  // Account holder name is a person/business name — letters only (no digits).
  // Must start with a letter; allows spaces, periods, apostrophes, hyphens.
  // Mirrors the storefront `validatePersonName` regex so client + server agree.
  @Matches(/^[A-Za-z][A-Za-z .'-]*$/, {
    message:
      'Account holder name must contain only letters, spaces, periods, apostrophes or hyphens',
  })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  accountHolderName!: string;

  @IsNotEmpty({ message: 'Account number is required' })
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @Matches(/^[0-9]{9,18}$/, {
    message: 'Account number must be 9–18 digits with no spaces',
  })
  accountNumber!: string;

  @IsNotEmpty({ message: 'IFSC code is required' })
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: 'IFSC must be 4 letters + 0 + 6 alphanumerics (e.g. HDFC0001234)',
  })
  ifscCode!: string;

  @IsNotEmpty({ message: 'Bank name is required' })
  @IsString()
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  bankName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[\w.\-]+@[A-Za-z]+$/, {
    message: 'UPI VPA must be in the format username@bank (e.g. name@upi)',
  })
  upiVpa?: string;
}
