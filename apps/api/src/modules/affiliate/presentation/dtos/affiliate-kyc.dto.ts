import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class SubmitAffiliateKycDto {
  @IsString()
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/i, {
    message: 'PAN must be 10 chars: 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)',
  })
  panNumber!: string;

  @IsOptional()
  @IsString()
  @Length(12, 12, { message: 'Aadhaar must be exactly 12 digits' })
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  panDocumentUrl?: string;

  @IsOptional()
  @IsString()
  aadhaarDocumentUrl?: string;
}

export class RejectAffiliateKycDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
