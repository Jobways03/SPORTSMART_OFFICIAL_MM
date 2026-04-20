import { IsIn, IsOptional } from 'class-validator';

export class InitiateRefundDto {
  @IsOptional()
  @IsIn(['ORIGINAL_PAYMENT', 'WALLET', 'BANK_TRANSFER', 'CASH'])
  refundMethod?: string;
}
