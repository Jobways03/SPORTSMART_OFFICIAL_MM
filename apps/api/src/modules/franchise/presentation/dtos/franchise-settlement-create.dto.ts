import { IsNotEmpty, IsDateString } from 'class-validator';

export class FranchiseSettlementCreateDto {
  @IsNotEmpty({ message: 'Period start date is required' })
  @IsDateString({}, { message: 'Period start must be a valid ISO date string' })
  periodStart: string;

  @IsNotEmpty({ message: 'Period end date is required' })
  @IsDateString({}, { message: 'Period end must be a valid ISO date string' })
  periodEnd: string;
}
