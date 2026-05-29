import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class AddPayoutMethodDto {
  @IsIn(['BANK', 'UPI'])
  type!: 'BANK' | 'UPI';

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  ifscCode?: string;

  @IsOptional()
  @IsString()
  accountHolderName?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
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
