import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * Phase 83 (2026-05-23) — delivery confirmation audit Gap #11/#15.
 *
 * Optional proof attachments for an admin manual delivery. Pre-Phase-83
 * the endpoint took no body — admin couldn't attach a signed POD or a
 * delivery photo, so dispute investigation was blind for manual
 * deliveries. All fields stay optional so the legacy "just mark it
 * delivered" flow continues to work; callers that have proof can
 * surface it on the row.
 */
export class MarkDeliveredDto {
  @IsOptional()
  @IsString({ message: 'deliveryProofUrl must be a string' })
  @IsUrl({ require_tld: false }, { message: 'deliveryProofUrl must be a URL' })
  @MaxLength(500)
  deliveryProofUrl?: string;

  @IsOptional()
  @IsString({ message: 'deliverySignatureUrl must be a string' })
  @IsUrl({ require_tld: false }, { message: 'deliverySignatureUrl must be a URL' })
  @MaxLength(500)
  deliverySignatureUrl?: string;

  @IsOptional()
  @IsBoolean({ message: 'deliveryOtpVerified must be a boolean' })
  deliveryOtpVerified?: boolean;
}
