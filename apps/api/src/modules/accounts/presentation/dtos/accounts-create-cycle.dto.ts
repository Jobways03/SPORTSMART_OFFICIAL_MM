import { IsNotEmpty, IsDateString } from 'class-validator';

export class AccountsCreateCycleDto {
  @IsNotEmpty()
  @IsDateString()
  periodStart!: string;

  @IsNotEmpty()
  @IsDateString()
  periodEnd!: string;
}
