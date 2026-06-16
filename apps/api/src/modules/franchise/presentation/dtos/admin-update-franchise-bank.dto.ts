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
 * Admin-side franchise bank-details input. Mirrors UpdateSellerBankDetailsDto.
 *
 * Field-level format checks happen here (cheap reject); cross-field validation
 * + persistence (AES-256-GCM account-number encryption) happen in
 * FranchiseBankDetailsService. The controller returns the masked view
 * (accountNumberLast4) only — this DTO never echoes back.
 */
export class AdminUpdateFranchiseBankDto {
  @IsNotEmpty({ message: 'Account holder name is required' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  // Letters only (no digits) — mirrors the storefront `validatePersonName` regex.
  @Matches(/^[A-Za-z][A-Za-z .'-]*$/, {
    message:
      'Account holder name must contain only letters, spaces, periods, apostrophes or hyphens',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
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
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/, {
    message:
      'Bank name may only contain letters, digits, spaces and & . , - / ( ) \'',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  bankName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[\w.\-]+@[A-Za-z]+$/, {
    message: 'UPI VPA must be in the form name@bank',
  })
  upiVpa?: string;
}
