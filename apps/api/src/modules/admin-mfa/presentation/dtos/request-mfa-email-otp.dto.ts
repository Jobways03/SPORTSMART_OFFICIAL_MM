import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /admin/auth/mfa-email/request — asks the API to email a
 * 6-digit login code to the admin identified by the challenge token.
 * The challenge token (from POST /admin/auth/login) is the only proof
 * required; it's a short-lived, audience-pinned JWT signed with
 * JWT_ADMIN_SECRET, so it already establishes that the password step
 * succeeded.
 */
export class RequestMfaEmailOtpDto {
  @IsString({ message: 'challengeToken must be a string' })
  @MinLength(20, { message: 'challengeToken is too short to be a JWT' })
  @MaxLength(2048, { message: 'challengeToken is too long to be a valid JWT' })
  challengeToken!: string;
}
