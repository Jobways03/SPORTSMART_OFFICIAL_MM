export const USER_REPOSITORY = Symbol('UserRepository');

export interface UserWithRoles {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  status: string;
  failedLoginAttempts: number;
  lockUntil: Date | null;
  roleAssignments: Array<{
    role: { name: string };
  }>;
}

export interface PasswordResetOtpRecord {
  id: string;
  userId: string;
  otpHash: string;
  attempts: number;
  maxAttempts: number;
  verifiedAt: Date | null;
  usedAt: Date | null;
  resetToken: string | null;
  expiresAt: Date;
  createdAt: Date;
  user?: { id: string; email: string; status: string };
}

export interface EmailVerificationOtpRecord {
  id: string;
  userId: string;
  otpHash: string;
  attempts: number;
  maxAttempts: number;
  verifiedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Consent purposes captured at registration. The full canonical
 * purpose list lives in ConsentService.PURPOSES — the registration
 * flow only writes the subset the user is asked about on the form.
 *
 * Phase 28 (2026-05-21) — `consentVersion` is required so the row
 * pins which privacy-notice version the user agreed to at signup.
 */
export interface RegistrationConsentInput {
  purpose: string;
  granted: boolean;
  consentVersion: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  source?: string | null;
}

export interface CustomerProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerProfileWithPassword extends CustomerProfile {
  passwordHash: string;
}

export interface UpdateCustomerProfileInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
}

export interface UserRepository {
  findById(id: string): Promise<unknown | null>;
  findByEmail(email: string): Promise<unknown | null>;
  findByEmailWithRoles(email: string): Promise<UserWithRoles | null>;
  save(user: unknown): Promise<void>;

  // Customer profile self-service
  findCustomerProfile(id: string): Promise<CustomerProfile | null>;
  findCustomerProfileWithPassword(id: string): Promise<CustomerProfileWithPassword | null>;
  updateCustomerProfile(id: string, data: UpdateCustomerProfileInput): Promise<CustomerProfile>;
  existsByEmailExcept(email: string, excludeUserId: string): Promise<boolean>;
  existsByPhoneExcept(phone: string, excludeUserId: string): Promise<boolean>;
  changePasswordAndRevokeSessions(userId: string, passwordHash: string): Promise<void>;

  // Registration (transactional).
  //
  // Atomically creates:
  //   - User row with status=PENDING_VERIFICATION, emailVerified=false
  //   - RoleAssignment (CUSTOMER role)
  //   - ConsentRecord rows (one per (userId, purpose))
  //   - EmailVerificationOtp row (SHA-256 hashed OTP, 10-min TTL)
  //
  // Either all four land or none of them do. A failure to find the
  // CUSTOMER role surfaces as an exception (we never want to ship an
  // un-roled user). A duplicate-email returns null so the use-case can
  // emit a uniform "check your inbox" response rather than leaking
  // account existence.
  createUserWithRole(data: {
    firstName: string;
    lastName: string;
    email: string;
    /**
     * Phase 21 (2026-05-20) — optional phone collected at registration.
     * Format normalised to India 10-digit by the DTO; the repo stores
     * verbatim or null. Phone uniqueness is enforced at the schema
     * level; duplicates surface as P2002 (caller handles as the
     * uniform duplicate-email path).
     */
    phone?: string | null;
    passwordHash: string;
    otpHash: string;
    otpExpiresAt: Date;
    consents: RegistrationConsentInput[];
  }): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    otpId: string;
  } | null>;

  /**
   * Look up the active customer record by email, but only return
   * shape needed for the verify / resend OTP flows. Status filter is
   * the caller's responsibility — they may want to accept both
   * PENDING_VERIFICATION (resend OTP) and reject ACTIVE (already verified).
   */
  findByEmailForVerification(email: string): Promise<{
    id: string;
    email: string;
    status: string;
    emailVerified: boolean;
  } | null>;

  // EmailVerificationOtp operations
  createEmailVerificationOtp(
    userId: string,
    otpHash: string,
    expiresAt: Date,
  ): Promise<{ id: string }>;
  findActiveEmailVerificationOtp(
    userId: string,
  ): Promise<EmailVerificationOtpRecord | null>;
  findRecentEmailVerificationOtp(
    userId: string,
    cooldownSeconds: number,
  ): Promise<EmailVerificationOtpRecord | null>;
  /**
   * Phase 27 (2026-05-21) — count of EmailVerificationOtp rows created
   * since `since`. Powers the hourly resend cap on
   * resend-verification-otp. Distinct from countOtpsSince which counts
   * password-reset rows (separate table).
   */
  countEmailVerificationOtpsSince(userId: string, since: Date): Promise<number>;
  invalidateActiveEmailVerificationOtps(userId: string): Promise<void>;
  expireEmailVerificationOtp(otpId: string): Promise<void>;
  /**
   * Atomic check-and-increment for the verify-email path. Same pattern
   * as incrementOtpAttemptsCas() on password-reset OTPs: the WHERE
   * clause asserts the row is still active and below the cap, so
   * concurrent verify requests cannot both pass the attempt check.
   */
  incrementEmailVerificationOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }>;
  /**
   * Atomic "OTP verified" transaction: marks the OTP as consumed and
   * flips the user to status=ACTIVE + emailVerified=true +
   * emailVerifiedAt=now in the same DB transaction. Either both land
   * or neither does, so a power-fail mid-verify never leaves a user
   * with a consumed OTP but no ACTIVE status.
   */
  markEmailVerified(otpId: string, userId: string): Promise<void>;

  // Password update
  updatePassword(userId: string, passwordHash: string): Promise<void>;

  // Brute-force lockout counters (parity with Seller / Franchise / Admin).
  recordFailedLogin(userId: string, attempts: number, lockUntil: Date | null): Promise<void>;
  /**
   * Phase 17 (2026-05-20) — atomic version of recordFailedLogin. The
   * previous read-then-set pattern let two concurrent failed logins
   * both observe `failedLoginAttempts = N`, both compute `N+1`, both
   * write `N+1` — losing one increment under contention. This variant
   * uses Prisma's `{ increment: 1 }` so the database serialises the
   * update. Returns the post-increment count so the caller can decide
   * whether the lockout threshold was crossed and writes lockUntil in
   * the same statement when it has been.
   */
  recordFailedLoginAtomic(
    userId: string,
    maxAttempts: number,
    lockDurationMs: number,
  ): Promise<{ failedLoginAttempts: number; lockUntil: Date | null }>;
  clearLoginLockout(userId: string): Promise<void>;
  /**
   * Phase 17 (2026-05-20) — stamp lastLoginAt on every successful
   * authentication. Decoupled from clearLoginLockout so the call
   * stays best-effort: a write failure here must never block login.
   */
  touchLastLogin(userId: string): Promise<void>;

  // OTP operations
  findRecentOtp(userId: string, cooldownSeconds: number): Promise<PasswordResetOtpRecord | null>;
  /**
   * Phase 26 (2026-05-20) — count of OTPs (any state) created since a
   * given timestamp. Powers the per-account hourly resend cap.
   */
  countOtpsSince(userId: string, since: Date): Promise<number>;
  findActiveOtp(userId: string): Promise<PasswordResetOtpRecord | null>;
  invalidateActiveOtps(userId: string): Promise<void>;
  createOtp(userId: string, otpHash: string, expiresAt: Date): Promise<void>;
  incrementOtpAttempts(otpId: string): Promise<void>;
  /**
   * Phase 1 / H5 — atomic check-and-increment. Returns the new
   * attempts count when the increment landed (and the row was still
   * active + below the cap), or `{ ok: false }` when another
   * concurrent verify already consumed the last slot, the OTP was
   * already used / verified / expired. Use this instead of the
   * read-then-increment pattern when calling from a hot verification
   * loop.
   */
  incrementOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }>;
  expireOtp(otpId: string): Promise<void>;
  markOtpVerified(otpId: string, resetToken: string): Promise<void>;
  findOtpByResetToken(resetToken: string): Promise<PasswordResetOtpRecord | null>;

  // Reset password transaction (update password + mark OTP used + revoke sessions)
  resetPasswordTransaction(params: {
    userId: string;
    passwordHash: string;
    otpId: string;
  }): Promise<void>;

  // Role/permission queries
  getUserRoles(userId: string): Promise<string[]>;
  hasPermission(userId: string, permissionCode: string): Promise<boolean>;
}
