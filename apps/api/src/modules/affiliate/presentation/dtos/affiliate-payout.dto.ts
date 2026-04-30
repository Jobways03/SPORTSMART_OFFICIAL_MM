import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
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
  @IsOptional()
  @IsString()
  transactionRef?: string;
}

export class MarkPayoutFailedDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
