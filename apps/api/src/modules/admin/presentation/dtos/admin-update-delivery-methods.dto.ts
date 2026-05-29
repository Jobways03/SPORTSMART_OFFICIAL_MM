import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Body for `PATCH /admin/sellers/:id/delivery-methods` (and the
 * franchise mirror). All fields optional — a partial PATCH updates
 * just the toggles the caller cares about. Empty `selfDeliveryPincodes`
 * array intentionally means "no service area"; passing `null` clears
 * the filter (serve everywhere).
 */
export class AdminUpdateDeliveryMethodsDto {
  @IsOptional()
  @IsBoolean()
  selfDeliveryEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsString({ each: true })
  @Matches(/^[1-9][0-9]{5}$/, {
    each: true,
    message: 'Each pincode must be a 6-digit Indian postal code',
  })
  @MaxLength(6, { each: true })
  selfDeliveryPincodes?: string[] | null;
}
