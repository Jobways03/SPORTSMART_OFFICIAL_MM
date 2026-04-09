import { Seller, SellerSession, SellerPasswordResetOtp } from '@prisma/client';

// ───────────────────────────────────────────────────────────────
// Seller Repository Interface
// Covers all persistence operations needed by seller use-cases.
// ───────────────────────────────────────────────────────────────

/** Seller with the related seller record attached (used by reset-password) */
export type OtpWithSeller = SellerPasswordResetOtp & { seller: Seller };

// ── Auth operations ──────────────────────────────────────────

export interface SellerRepository {
  /** Find a seller by email (unique lookup). */
  findByEmail(email: string): Promise<Seller | null>;

  /** Find a seller by phone number (unique lookup). */
  findByPhone(phoneNumber: string): Promise<Seller | null>;

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

  /** Verify email atomically: mark OTP used/verified + set isEmailVerified on seller. */
  verifyEmailTransaction(params: {
    sellerId: string;
    otpId: string;
  }): Promise<void>;
}

export const SELLER_REPOSITORY = Symbol('SellerRepository');
