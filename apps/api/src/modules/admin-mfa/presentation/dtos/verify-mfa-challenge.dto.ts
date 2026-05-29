import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class VerifyMfaChallengeDto {
  // Short-lived challenge JWT from POST /admin/auth/login response.
  // Lower bound rejects obvious junk before jsonwebtoken parses it;
  // upper bound (Phase 26, 2026-05-20) defends the parser against
  // megabyte-long input being fed in via a forged client.
  @IsString({ message: 'challengeToken must be a string' })
  @MinLength(20, { message: 'challengeToken is too short to be a JWT' })
  @MaxLength(2048, { message: 'challengeToken is too long to be a valid JWT' })
  challengeToken!: string;

  // Phase 26 (2026-05-20) — accept either:
  //   - 6-digit TOTP code (e.g. `123456`)
  //   - 11-char `xxxxx-xxxxx` backup code (case-insensitive)
  //
  // Pre-Phase-26 the regex was /^\d{6}$/ which silently rejected
  // backup codes at the DTO boundary — the service-layer
  // isBackupCodeFormat dispatch in AdminMfaVerifyChallengeUseCase
  // was unreachable. An admin who lost their TOTP device had no
  // recovery path other than DBA intervention.
  @IsString({ message: 'code must be a string' })
  @Matches(/^(\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})$/, {
    message:
      'code must be a 6-digit TOTP or an 11-character backup code (xxxxx-xxxxx)',
  })
  code!: string;
}
