import { IsString, Matches } from 'class-validator';

/**
 * Phase 25 (2026-05-20) — Step-up MFA verify DTO.
 *
 * The step-up endpoint must accept either form:
 *   - 6-digit TOTP code (e.g. `123456`)
 *   - 11-char backup code in the `xxxxx-xxxxx` form
 *
 * The shared CompleteMfaEnrollmentDto only accepted /^\d{6}$/, so
 * the service-side `isBackupCodeFormat(code)` dispatch in
 * AdminMfaService.stepUp was unreachable — admins with a lost
 * authenticator device had no way to elevate their session.
 *
 * The regex is intentionally generous (case-insensitive) because
 * normaliseBackupCode in the domain layer lowercases the input before
 * bcrypt-comparing. The format check is a fast pre-filter; the real
 * validation is the bcrypt match (for backup codes) or the
 * verifyTotpCode HMAC (for TOTP).
 */
export class StepUpMfaDto {
  @IsString({ message: 'code must be a string' })
  @Matches(/^(\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})$/, {
    message:
      'code must be a 6-digit TOTP or an 11-character backup code (xxxxx-xxxxx)',
  })
  code!: string;
}
