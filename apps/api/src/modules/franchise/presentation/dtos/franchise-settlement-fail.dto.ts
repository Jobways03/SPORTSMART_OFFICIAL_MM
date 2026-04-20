import { IsOptional, IsString, MaxLength } from 'class-validator';

export class FranchiseSettlementFailDto {
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  @MaxLength(1000, { message: 'Reason must not exceed 1000 characters' })
  reason?: string;
}
