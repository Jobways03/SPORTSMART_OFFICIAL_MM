import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminUpdateFranchiseCommissionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Online fulfillment rate must be a number' })
  @Min(0, { message: 'Online fulfillment rate must be at least 0' })
  @Max(100, { message: 'Online fulfillment rate must not exceed 100' })
  onlineFulfillmentRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Procurement fee rate must be a number' })
  @Min(0, { message: 'Procurement fee rate must be at least 0' })
  @Max(100, { message: 'Procurement fee rate must not exceed 100' })
  procurementFeeRate?: number;
}
