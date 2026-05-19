import { IsBoolean, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BillingAddressDto } from './billing-address.dto';

// Customer-supplied input for adding a B2B tax profile. GSTIN format
// (regex + Mod-36 checksum) is enforced inside the service via the
// shared `validateGstin` domain helper — the DTO only validates the
// length so a malformed string still fails fast at the boundary.
//
// `stateCode` is NOT accepted from the client; the service derives it
// from the first two characters of the validated GSTIN. This keeps
// the persisted state code consistent with the GSTIN's embedded
// state code and avoids a class of invariant violations.
//
// `isVerified` / `verifiedAt` / `verifiedBy` are also NOT accepted:
// they are admin-attested via a separate admin endpoint (not yet
// surfaced — created rows land with isVerified=false).
export class CreateCustomerTaxProfileDto {
  @IsString()
  @Length(15, 15, { message: 'GSTIN must be exactly 15 characters' })
  gstin!: string;

  @IsString()
  @Length(1, 200)
  legalName!: string;

  @ValidateNested()
  @Type(() => BillingAddressDto)
  billingAddress!: BillingAddressDto;

  // Whether this profile should become the customer's default for
  // tax-invoice generation. If true, the service unsets isDefault on
  // every other profile of this user atomically.
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
