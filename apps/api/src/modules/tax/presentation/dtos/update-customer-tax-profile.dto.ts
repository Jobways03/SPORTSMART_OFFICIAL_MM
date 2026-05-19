import { IsBoolean, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BillingAddressDto } from './billing-address.dto';

// GSTIN is intentionally NOT updatable here — the (customerId, gstin)
// pair is a unique key and treating it as immutable keeps the audit
// trail honest (an issued invoice carries the GSTIN that was in
// effect at issue time). To switch GSTINs, the customer deletes the
// profile and creates a new one.
export class UpdateCustomerTaxProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  legalName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingAddressDto)
  billingAddress?: BillingAddressDto;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
