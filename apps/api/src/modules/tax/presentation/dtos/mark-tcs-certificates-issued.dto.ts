import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Phase 160 (§52 TCS lifecycle audit B1 / #12) — body for
 * POST /admin/tax/tcs/mark-certificates-issued.
 *
 * Marks PAID_TO_GOVT rows CERTIFICATE_ISSUED (the terminal §52 stage),
 * stamping a per-row certificate number. Each row gets its OWN number
 * (one supplier = one certificate); the optional prefix lets ops brand
 * the certificate series, e.g. "TCS" → "TCS/2026-04/AB12CD34".
 */
export class MarkTcsCertificatesIssuedDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'ledgerIds must contain at least one id' })
  @ArrayMaxSize(2000, {
    message: 'ledgerIds may contain at most 2000 entries per request',
  })
  @ArrayUnique({ message: 'ledgerIds must be unique' })
  @IsString({ each: true })
  ledgerIds!: string[];

  /** Optional certificate-number prefix (alphanumeric, ≤12 chars). */
  @IsOptional()
  @IsString()
  @MaxLength(12, { message: 'certificateNumberPrefix must be at most 12 chars' })
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'certificateNumberPrefix must be alphanumeric',
  })
  certificateNumberPrefix?: string;
}
