import { IsBoolean, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { BillingAddressDto } from './billing-address.dto';

// Phase 200 (audit #9) — full GSTIN structural regex at the DTO boundary
// (mirrors the domain GSTIN_REGEX in gstin-validator.ts). The Mod-36 checksum
// is still run in the service, but the regex rejects malformed input (wrong
// PAN block, missing 'Z', etc.) before it reaches business logic.
const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[A-Z]{1}[0-9A-Z]{1}$/;

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
  @Length(15, 15, { message: 'GSTIN must be exactly 15 characters' })
  @Matches(GSTIN_REGEX, {
    message: 'GSTIN does not match the required format (e.g. 27AAACR4849R1ZL)',
  })
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
