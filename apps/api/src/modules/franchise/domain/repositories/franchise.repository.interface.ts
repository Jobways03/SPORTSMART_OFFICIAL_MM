import {
  FranchisePartner,
  FranchiseSession,
  FranchisePasswordResetOtp,
} from '@prisma/client';

// ───────────────────────────────────────────────────────────────
// Franchise Partner Repository Interface
// Covers all persistence operations needed by franchise use-cases.
// ───────────────────────────────────────────────────────────────

/** OTP with the related franchise partner record attached (used by reset-password) */
export type OtpWithFranchise = FranchisePasswordResetOtp & {
  franchisePartner: FranchisePartner;
};

// ── Auth operations ──────────────────────────────────────────

export interface FranchisePartnerRepository {
  /** Find a franchise partner by email (unique lookup). */
  findByEmail(email: string): Promise<FranchisePartner | null>;

  /** Find a franchise partner by phone number (unique lookup). */
  findByPhone(phoneNumber: string): Promise<FranchisePartner | null>;

  /** Find a franchise partner by ID (full record). */
  findById(id: string): Promise<FranchisePartner | null>;

  /** Find a franchise partner by ID returning only selected fields. */
  findByIdSelect<T extends Record<string, boolean>>(
    id: string,
    select: T,
  ): Promise<Pick<FranchisePartner, Extract<keyof T, keyof FranchisePartner>> | null>;

  /** Create a new franchise partner and return the full record. */
  createFranchise(data: {
    ownerName: string;
    businessName: string;
    email: string;
    phoneNumber: string;
    passwordHash: string;
    franchiseCode: string;
  }): Promise<FranchisePartner>;

  /** Update a franchise partner by ID and return the full record. */
  updateFranchise(id: string, data: Record<string, unknown>): Promise<FranchisePartner>;

  /** Update a franchise partner by ID returning only selected fields. */
  updateFranchiseSelect<T extends Record<string, boolean>>(
    id: string,
    data: Record<string, unknown>,
    select: T,
  ): Promise<Pick<FranchisePartner, Extract<keyof T, keyof FranchisePartner>>>;

  /** Generate the next sequential franchise code. */
  generateNextFranchiseCode(): Promise<string>;

  // ── Session operations ──────────────────────────────────────

  /** Create a new franchise session. */
  createSession(data: {
    franchisePartnerId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<FranchiseSession>;

  /** Revoke all active sessions for a franchise partner. */
  revokeAllSessions(franchisePartnerId: string): Promise<void>;

  // ── OTP operations ──────────────────────────────────────────

  /** Find the most recent OTP matching the given criteria. */
  findRecentOtp(params: {
    franchisePartnerId: string;
    purpose?: string;
    unusedOnly: boolean;
    createdAfter?: Date;
  }): Promise<FranchisePasswordResetOtp | null>;

  /** Find an OTP by reset token, including the related franchise partner. */
  findOtpByResetToken(resetToken: string): Promise<OtpWithFranchise | null>;

  /** Find the latest valid (unexpired, unused, unverified) OTP for a franchise partner. */
  findLatestValidOtp(
    franchisePartnerId: string,
    purpose?: string,
  ): Promise<FranchisePasswordResetOtp | null>;

  /** Count OTPs created after a given date for a franchise partner. */
  countOtpsSince(franchisePartnerId: string, since: Date): Promise<number>;

  /** Invalidate all unexpired, unused, unverified OTPs for a franchise partner. */
  invalidateActiveOtps(franchisePartnerId: string, purpose?: string): Promise<void>;

  /** Create a new OTP record. */
  createOtp(data: {
    franchisePartnerId: string;
    otpHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<FranchisePasswordResetOtp>;

  /** Update an OTP record by ID. */
  updateOtp(
    id: string,
    data: Record<string, unknown>,
  ): Promise<FranchisePasswordResetOtp>;

  /** Expire an OTP (set expiresAt to now). */
  expireOtp(id: string): Promise<void>;

  /** Increment the attempt counter on an OTP. */
  incrementOtpAttempts(id: string): Promise<void>;

  // ── Transactional operations ────────────────────────────────

  /** Reset password atomically: update password, mark OTP used, invalidate others, revoke sessions. */
  resetPasswordTransaction(params: {
    franchisePartnerId: string;
    otpId: string;
    passwordHash: string;
  }): Promise<void>;

  /** Change password atomically: update password + reset lockout + revoke sessions. */
  changePasswordTransaction(params: {
    franchisePartnerId: string;
    passwordHash: string;
  }): Promise<void>;

  /** Verify email atomically: mark OTP used/verified + set isEmailVerified on franchise partner. */
  verifyEmailTransaction(params: {
    franchisePartnerId: string;
    otpId: string;
  }): Promise<void>;

  // ── Admin operations ────────────────────────────────────────

  /** Find all franchise partners with pagination, search, and filters. */
  findAll(params: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
    verificationStatus?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<{ records: FranchisePartner[]; total: number }>;
}

export const FRANCHISE_PARTNER_REPOSITORY = Symbol('FranchisePartnerRepository');
