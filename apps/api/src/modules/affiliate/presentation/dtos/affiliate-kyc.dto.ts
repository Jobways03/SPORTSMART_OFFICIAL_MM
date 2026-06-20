import {
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PAN_REGEX, TAX_ID_MESSAGES } from '../../../tax/domain/tax-id-rules';

export class SubmitAffiliateKycDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(PAN_REGEX, { message: TAX_ID_MESSAGES.PAN_FORMAT })
  panNumber!: string;

  @IsOptional()
  @IsString()
  @Length(12, 12, { message: 'Aadhaar must be exactly 12 digits' })
  aadhaarNumber?: string;

  // #252.9 (2026-06-03) — These document URLs are client-supplied (the
  // affiliate POSTs back whatever the media upload returned). A bare
  // @IsString() let an affiliate inject an arbitrary host
  // (`https://evil.com/x.pdf` → admin-review SSRF / spoofed doc) or point
  // at another affiliate's stored asset. The DTO enforces https + a real
  // TLD + a length cap; the SERVICE does the authoritative host allowlist
  // (the trusted media host is derived from R2_PUBLIC_BASE_URL at runtime,
  // so it can't be pinned in a static decorator). Mirrors the returns
  // evidence-URL guard.
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'panDocumentUrl must be at most 500 characters' })
  @IsUrl(
    {
      protocols: ['https'],
      require_protocol: true,
      require_tld: true,
    },
    {
      message: 'panDocumentUrl must be an https media delivery URL',
    },
  )
  panDocumentUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'aadhaarDocumentUrl must be at most 500 characters',
  })
  @IsUrl(
    {
      protocols: ['https'],
      require_protocol: true,
      require_tld: true,
    },
    {
      message: 'aadhaarDocumentUrl must be an https media delivery URL',
    },
  )
  aadhaarDocumentUrl?: string;
}

export class RejectAffiliateKycDto {
  @IsString()
  @Length(1, 500)
  reason!: string;
}
