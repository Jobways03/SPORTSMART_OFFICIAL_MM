import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ConfirmRefundDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  refundReference: string;

  @IsOptional()
  @IsIn(['ORIGINAL_PAYMENT', 'WALLET', 'BANK_TRANSFER', 'CASH'])
  refundMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
