import { Seller, SellerSession, SellerPasswordResetOtp } from '@prisma/client';

// ───────────────────────────────────────────────────────────────
// Seller Repository Interface
// Covers all persistence operations needed by seller use-cases.
// ───────────────────────────────────────────────────────────────

/** Seller with the related seller record attached (used by reset-password) */
export type OtpWithSeller = SellerPasswordResetOtp & { seller: Seller };

/**
 * Phase 18 (2026-05-20) — canonical OTP purpose union.
 *
 * The Prisma schema's `purpose` column is `String @default("PASSWORD_RESET")`
 * (kept as string for backward-compat — renaming the table forces a
 * regen + touches every caller). This TypeScript union pins the
 * legal values at the application boundary. Adding a new OTP purpose
 * means updating this union AND wiring use-case code; no schema
 * change required.
 */
export type SellerOtpPurpose = 'PASSWORD_RESET' | 'EMAIL_VERIFICATION';

// ── Auth operations ──────────────────────────────────────────

export interface SellerRepository {
  /** Find a seller by email (unique lookup). */
  findByEmail(email: string): Promise<Seller | null>;

  /** Find a seller by phone number (unique lookup). */
  findByPhone(phoneNumber: string): Promise<Seller | null>;

  /**
   * Phase 19 (2026-05-20) — duplicate GSTIN check for the onboarding
   * submit pre-condition. Returns the seller that currently owns
   * this GSTIN, or null. Caller compares against the current
   * sellerId to allow the seller to re-submit their own GSTIN.
   */
  findByGstin(gstin: string): Promise<{ id: string } | null>;

  /**
   * Phase 19 (2026-05-20) — duplicate PAN check, same shape.
   */
  findByPanNumber(panNumber: string): Promise<{ id: string } | null>;

  /** Find a seller by ID (full record). */
  findById(id: string): Promise<Seller | null>;

  /** Find a seller by ID returning only selected fields. */
  findByIdSelect<T extends Record<string, boolean>>(
    id: string,
    select: T,
  ): Promise<Pick<Seller, Extract<keyof T, keyof Seller>> | null>;

  /** Create a new seller and return the full record. */
  createSeller(data: {
    sellerName: string;
    sellerShopName: string;
    email: string;
    phoneNumber: string;
    passwordHash: string;
    // Phase 38 — D2C / RETAIL discriminator. Omit to take the DB
    // default (D2C, per the migration). The seller-portal frontends
    // hard-code this from a build constant.
    sellerType?: 'D2C' | 'RETAIL';
  }): Promise<Seller>;

  /** Update a seller by ID and return the full record. */
  updateSeller(id: string, data: Record<string, unknown>): Promise<Seller>;

  /** Update a seller by ID returning only selected fields. */
  updateSellerSelect<T extends Record<string, boolean>>(
    id: string,
    data: Record<string, unknown>,
    select: T,
  ): Promise<Pick<Seller, Extract<keyof T, keyof Seller>>>;

  // ── Session operations ──────────────────────────────────────

  /** Create a new seller session. */
  createSession(data: {
    sellerId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<SellerSession>;

  /** Revoke all active sessions for a seller. */
  revokeAllSessions(sellerId: string): Promise<void>;

  /**
   * Phase 21 (2026-05-20) — revoke a single session by id. Used by the
   * default-logout path so a seller signed in on multiple devices
   * doesn't lose every session when one device logs out.
   */
  revokeSession(sessionId: string): Promise<void>;

  /**
   * Look up a session by the RAW refresh token. Returns null on miss.
   * Caller checks `revokedAt` / `expiresAt` themselves.
   */
  findSessionByRefreshToken(rawToken: string): Promise<{
    id: string;
    sellerId: string;
    expiresAt: Date;
    revokedAt: Date | null;
    // Phase 21 (2026-05-20) — needed by refresh use-case to enforce
    // the absolute-lifetime cap (createdAt + SESSION_ABSOLUTE_LIFETIME_DAYS).
    createdAt: Date;
  } | null>;

  /**
   * Phase 1 / C6 — secondary lookup on the burned-hash slot. A hit
   * means the caller presented a refresh token that was already
   * rotated out → theft → revoke every session for the seller.
   */
  findSessionByPreviousRefreshToken(rawToken: string): Promise<{
    id: string;
    sellerId: string;
  } | null>;

  /**
   * Rotate the refresh token on an existing session (and bump expiresAt).
   * Caller passes the new RAW token; impl hashes it before persist.
   */
  rotateSession(
    sessionId: string,
    newRawRefreshToken: string,
    newExpiresAt: Date,
  ): Promise<void>;

  // ── OTP operations ──────────────────────────────────────────

  /** Find the most recent OTP matching the given criteria. */
  findRecentOtp(params: {
    sellerId: string;
    purpose?: string;
    unusedOnly: boolean;
    createdAfter?: Date;
  }): Promise<SellerPasswordResetOtp | null>;

  /** Find an OTP by reset token, including the related seller. */
  findOtpByResetToken(resetToken: string): Promise<OtpWithSeller | null>;

  /** Find the latest valid (unexpired, unused, unverified) OTP for a seller. */
  findLatestValidOtp(
    sellerId: string,
    purpose?: string,
  ): Promise<SellerPasswordResetOtp | null>;

  /** Count OTPs created after a given date for a seller. */
  countOtpsSince(sellerId: string, since: Date): Promise<number>;

  /** Invalidate all unexpired, unused, unverified OTPs for a seller. */
  invalidateActiveOtps(sellerId: string, purpose?: string): Promise<void>;

  /** Create a new OTP record. */
  createOtp(data: {
    sellerId: string;
    otpHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<SellerPasswordResetOtp>;

  /** Update an OTP record by ID. */
  updateOtp(
    id: string,
    data: Record<string, unknown>,
  ): Promise<SellerPasswordResetOtp>;

  /** Expire an OTP (set expiresAt to now). */
  expireOtp(id: string): Promise<void>;

  /** Increment the attempt counter on an OTP. */
  incrementOtpAttempts(id: string): Promise<void>;

  /**
   * Phase 18 (2026-05-20) — atomic check-and-increment for OTP
   * attempts. The existing read-then-increment pattern in
   * verify-seller-email.use-case.ts can let two concurrent verifies
   * both pass the cap-check and both run their increments → counter
   * understates the true attempt count. This variant atomically
   * refuses the increment when the row is no longer active or the
   * cap is already reached.
   *
   * Mirrors PrismaUserRepository.incrementOtpAttemptsCas (identity
   * module). Returns the post-increment attempts count when
   * successful; `{ ok: false }` when the row was already
   * expired/used/verified or the cap was already crossed.
   */
  incrementOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }>;

  // ── Transactional operations ────────────────────────────────

  /** Reset password atomically: update password, mark OTP used, invalidate others, revoke sessions. */
  resetPasswordTransaction(params: {
    sellerId: string;
    otpId: string;
    passwordHash: string;
  }): Promise<void>;

  /** Change password atomically: update password + reset lockout + revoke sessions. */
  changePasswordTransaction(params: {
    sellerId: string;
    passwordHash: string;
  }): Promise<void>;

  /**
   * Verify email atomically: mark OTP used/verified + set
   * isEmailVerified on seller. Phase 18 (2026-05-20) — also stamps
   * emailVerifiedAt = now in the same tx so the boolean and the
   * timestamp never diverge.
   */
  verifyEmailTransaction(params: {
    sellerId: string;
    otpId: string;
  }): Promise<void>;
}

export const SELLER_REPOSITORY = Symbol('SellerRepository');
