import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ConsentService } from '../../application/services/consent.service';

/**
 * Body for POST /customer/consent.
 *
 * `purpose` is restricted to the REVOCABLE set — TERMS / PRIVACY are
 * one-shot acceptances at registration and cannot be flipped via this
 * surface (withdrawing them = account deletion, a separate flow).
 *
 * Phase 28 (2026-05-21):
 *   - `consentVersion` is optional. When omitted, the server stamps
 *     ConsentService.CURRENT_POLICY_VERSION. When provided, it must
 *     match the current version (anti-spoofing — a stale client cannot
 *     reaffirm consent for an older notice).
 *   - `source` is optional + allowlisted so the cookie banner /
 *     checkout banner / other surfaces can attribute their writes
 *     instead of inheriting the controller default.
 */
export class SetConsentDto {
  @IsString()
  @IsIn(ConsentService.REVOCABLE_PURPOSES as unknown as string[], {
    message: `purpose must be one of: ${ConsentService.REVOCABLE_PURPOSES.join(', ')}`,
  })
  purpose!: string;

  @IsBoolean({ message: 'granted must be a boolean' })
  granted!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @IsIn([ConsentService.CURRENT_POLICY_VERSION], {
    message: 'consentVersion is stale — refetch /customer/consent before re-submitting',
  })
  consentVersion?: string;

  @IsOptional()
  @IsString()
  @IsIn(['customer-portal', 'cookie-banner', 'checkout-banner'], {
    message: 'source must be one of: customer-portal, cookie-banner, checkout-banner',
  })
  source?: string;
}
