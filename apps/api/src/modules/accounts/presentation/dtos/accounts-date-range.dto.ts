import { IsOptional, IsDateString } from 'class-validator';

export class AccountsDateRangeDto {
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}
