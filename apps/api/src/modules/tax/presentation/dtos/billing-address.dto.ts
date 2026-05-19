import { IsOptional, IsString, Length, Matches } from 'class-validator';

// Shared billing-address shape for customer tax profiles. Persisted
// as JSON (billingAddressJson) on customer_tax_profiles and copied
// verbatim onto issued tax_documents so the legal record stays
// stable even if the customer later edits the profile.
export class BillingAddressDto {
  @IsString()
  @Length(1, 120)
  line1!: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  line2?: string;

  @IsString()
  @Length(1, 60)
  city!: string;

  @IsString()
  @Length(1, 60)
  state!: string;

  // Indian PIN — exactly 6 digits per India Post.
  @Matches(/^\d{6}$/, { message: 'pincode must be exactly 6 digits' })
  pincode!: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  country?: string;
}
