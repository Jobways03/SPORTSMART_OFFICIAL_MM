import { IsNotEmpty, IsNumber, IsString, MinLength, MaxLength } from 'class-validator';

export class FranchiseLedgerAdjustmentDto {
  @IsNotEmpty({ message: 'Amount is required' })
  @IsNumber({}, { message: 'Amount must be a number' })
  amount: number;

  @IsNotEmpty({ message: 'Reason is required' })
  @IsString({ message: 'Reason must be a string' })
  @MinLength(5, { message: 'Reason must be at least 5 characters' })
  @MaxLength(500, { message: 'Reason must not exceed 500 characters' })
  reason: string;
}
