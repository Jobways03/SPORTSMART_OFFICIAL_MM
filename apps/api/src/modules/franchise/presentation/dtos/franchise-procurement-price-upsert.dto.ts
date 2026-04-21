import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class FranchiseProcurementPriceUpsertDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  landedUnitCost!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
