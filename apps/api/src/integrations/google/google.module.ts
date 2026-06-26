import { Global, Module } from '@nestjs/common';
import { GoogleIdTokenVerifierService } from './google-id-token-verifier.service';

/**
 * "Sign in with Google" integration module.
 *
 * Marked @Global (mirroring CaptchaModule) so the identity module — or
 * any future module that wants to verify a Google ID token — can inject
 * GoogleIdTokenVerifierService without an explicit `imports` edge. The
 * service holds no per-request state beyond a one-time config warning +
 * a lazily-constructed OAuth2Client, so global is appropriate.
 */
@Global()
@Module({
  providers: [GoogleIdTokenVerifierService],
  exports: [GoogleIdTokenVerifierService],
})
export class GoogleModule {}
