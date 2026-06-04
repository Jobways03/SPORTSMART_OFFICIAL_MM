import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CustomerMarkHandedOverDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  // Phase 199 (2026-06-02) — Returns audit #14. The customer-supplied
  // courier tracking/AWB number is stored verbatim on the Return and
  // shown back in the UI / handed to ops. Constrain it to a sane
  // courier-AWB charset (alphanumerics + hyphen, 8-30 chars) so a
  // hostile value can't smuggle markup/control chars onto the record.
  @Matches(/^[A-Z0-9-]{8,30}$/i, {
    message:
      'Tracking number must be 8-30 characters using letters, digits, or hyphens.',
  })
  trackingNumber?: string;
}
