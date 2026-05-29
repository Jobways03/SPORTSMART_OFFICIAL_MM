import { Global, Module } from '@nestjs/common';
import { CaptchaVerifierService } from './captcha-verifier.service';

/**
 * Phase 16 (2026-05-20) — Captcha module.
 *
 * Marked @Global so any module wiring the customer-registration flow
 * (or any other public auth endpoint that wants bot protection) can
 * inject `CaptchaVerifierService` without an explicit `imports`
 * dependency. The service has no per-request state beyond a
 * one-time warning latch so global is appropriate.
 */
@Global()
@Module({
  providers: [CaptchaVerifierService],
  exports: [CaptchaVerifierService],
})
export class CaptchaModule {}
