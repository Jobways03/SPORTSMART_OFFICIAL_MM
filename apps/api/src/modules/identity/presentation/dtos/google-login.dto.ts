import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * "Sign in with Google" request body.
 *
 * `credential` is the Google ID token (a signed JWT) returned by the
 * Google Identity Services button on the storefront. It is verified
 * server-side by GoogleIdTokenVerifierService before any account lookup
 * or creation. The 8192-char cap bounds the payload at the framework
 * boundary — a real Google ID token is well under 2 KB; anything larger
 * is rejected before it reaches the verifier.
 */
export class GoogleLoginDto {
  @IsNotEmpty({ message: 'Google credential is required' })
  @IsString()
  @MaxLength(8192, { message: 'Credential must not exceed 8192 characters' })
  credential!: string;
}
