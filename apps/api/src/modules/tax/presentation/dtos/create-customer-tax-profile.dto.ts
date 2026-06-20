import { IsBoolean, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BillingAddressDto } from './billing-address.dto';
import {
  GSTIN_LENGTH,
  GSTIN_REGEX,
  TAX_ID_MESSAGES,
} from '../../domain/tax-id-rules';

// GSTIN structural validation at the DTO boundary uses the shared tax-id model
// (one source of truth). The Mod-36 checksum is still run in the service via
// the `validateGstin` domain helper, so a wrong checksum fails there.

// Customer-supplied input for adding a B2B tax profile. The DTO validates
// length + the full GSTIN structural regex (Phase 200 #9); the Mod-36 checksum
// is run inside the service via the shared `validateGstin` domain helper. A
// malformed string therefore fails fast at the boundary, and a wrong checksum
// fails in the service.
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
  // Uppercase + trim before validation so "27aaacr…" passes the regex.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(GSTIN_LENGTH, GSTIN_LENGTH, { message: TAX_ID_MESSAGES.GSTIN_LENGTH })
  @Matches(GSTIN_REGEX, { message: TAX_ID_MESSAGES.GSTIN_FORMAT })
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
