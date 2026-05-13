import { IsString, Matches, MinLength } from 'class-validator';

export class VerifyMfaChallengeDto {
  // Short-lived challenge JWT from POST /admin/auth/login response.
  // No upper bound on length — JWTs vary by claim payload — but
  // require a minimum to reject obvious junk before the verifier
  // even tries to parse it.
  @IsString({ message: 'challengeToken must be a string' })
  @MinLength(20, { message: 'challengeToken is too short to be a JWT' })
  challengeToken!: string;

  // 6-digit TOTP code. Same shape as the enrollment-complete DTO.
  @IsString({ message: 'code must be a string' })
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}
