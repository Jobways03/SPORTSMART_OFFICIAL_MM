export interface OtpSenderPort {
  /**
   * Send an OTP to the destination. Returns `true` when the email
   * (or other transport) was successfully dispatched; `false` when
   * the underlying transport returned a soft-failure (SMTP refused,
   * provider error). Phase 18 (2026-05-20) — return value added so
   * the seller registration flow can surface
   * `verificationEmailSent: false` to the verify page instead of
   * silently lying about delivery. Callers that don't care can
   * `await` and ignore the boolean (the existing forgot-password
   * paths do — enumeration safety means the API response shouldn't
   * betray send success anyway).
   */
  sendOtp(destination: string, otp: string): Promise<boolean>;
}
