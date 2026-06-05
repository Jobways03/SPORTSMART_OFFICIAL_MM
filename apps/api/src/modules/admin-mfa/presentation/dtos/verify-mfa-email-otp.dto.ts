import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /admin/auth/mfa-email/verify — submits the 6-digit code
 * the admin received by email. Separate from VerifyMfaChallengeDto
 * because an email OTP and a TOTP code are both 6 digits and can't be
 * distinguished by format; the dedicated endpoint removes the ambiguity.
 */
export class VerifyMfaEmailOtpDto {
  @IsString({ message: 'challengeToken must be a string' })
  @MinLength(20, { message: 'challengeToken is too short to be a JWT' })
  @MaxLength(2048, { message: 'challengeToken is too long to be a valid JWT' })
  challengeToken!: string;

  @IsString({ message: 'code must be a string' })
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from your email' })
  code!: string;
}
