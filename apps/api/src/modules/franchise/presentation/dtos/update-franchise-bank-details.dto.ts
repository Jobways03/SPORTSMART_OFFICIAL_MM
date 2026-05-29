import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateFranchiseBankDetailsDto {
  @IsNotEmpty({ message: 'Account holder name is required' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
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

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  upiVpa?: string;
}
