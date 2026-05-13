import { IsString, Matches } from 'class-validator';

export class CompleteMfaEnrollmentDto {
  // 6-digit TOTP code from the authenticator app. The service-layer
  // verifier also strips whitespace and re-checks the length, but
  // doing the format check at the DTO boundary gives a clearer 400
  // ("expected 6 digits, got X") than the generic "invalid TOTP code"
  // the service returns on substantive verification failure.
  @IsString({ message: 'code must be a string' })
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}
