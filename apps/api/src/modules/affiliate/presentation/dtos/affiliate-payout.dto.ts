import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class AddPayoutMethodDto {
  @IsIn(['BANK', 'UPI'])
  type!: 'BANK' | 'UPI';

  @IsOptional()
  @IsString()
  @Matches(/^\d{9,18}$/, {
    message: 'Bank account number must be 9 to 18 digits',
  })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: 'IFSC must be 4 letters, a 0, then 6 alphanumeric characters',
  })
  ifscCode?: string;

  // Required for BANK payouts (sent from the affiliate payouts form), omitted
  // for UPI. When present it must be a real name — letters only, no digits —
  // mirroring the storefront `validateAccountHolderName` regex. @IsOptional
  // skips the @Matches when the field is absent (UPI path).
  @IsOptional()
  @IsString()
  @Length(2, 150)
  @Matches(/^[A-Za-z][A-Za-z .'-]*$/, {
    message:
      'Account holder name must contain only letters, spaces, periods, apostrophes or hyphens',
  })
  accountHolderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/, {
    message: 'Bank name contains invalid characters',
  })
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[\w.\-]+@[A-Za-z]+$/, {
    message: 'Enter a valid UPI ID (e.g. name@bank)',
  })
  upiId?: string;

  @IsOptional()
  @IsBoolean()
  setPrimary?: boolean;
}

export class MarkPayoutPaidDto {
  // Phase 155 — the bank UTR is REQUIRED to mark a real-money payout paid
  // (was @IsOptional → UTR-less PAID rows). Alphanumeric, 8–40 chars.
  @IsString()
  @Length(8, 40)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'transactionRef (UTR) must be alphanumeric' })
  transactionRef!: string;
}

export class MarkPayoutFailedDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}

export class RejectPayoutDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
