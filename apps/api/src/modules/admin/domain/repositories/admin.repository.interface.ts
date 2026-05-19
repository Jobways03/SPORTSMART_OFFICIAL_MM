import { Prisma } from '@prisma/client';

// ──────────────────────────────────────────────────────────────
// Injection token
// ──────────────────────────────────────────────────────────────
export const ADMIN_REPOSITORY = Symbol('AdminRepository');

// ──────────────────────────────────────────────────────────────
// Result types
// ──────────────────────────────────────────────────────────────
export interface AdminRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  passwordHash: string;
  failedLoginAttempts: number;
  lockUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  // Phase 10 MFA fields (PR 10.1 schema, PR 10.4 wiring,
  // PR 10.7 added mfaLastUsedStep for anti-replay).
  // Optional on the interface because findAdminById's `select`
  // parameter decides which columns the caller asks for.
  mfaSecretCiphertext?: string | null;
  mfaPendingSecretCiphertext?: string | null;
  mfaEnabledAt?: Date | null;
  mfaBackupCodesHashes?: unknown;
  mfaLastUsedStep?: number | null;
}

export interface AdminSessionRecord {
  id: string;
  adminId: string;
  refreshToken: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}

export interface AdminPasswordResetOtpRecord {
  id: string;
  adminId: string;
  otpHash: string;
  attempts: number;
  maxAttempts: number;
  verifiedAt: Date | null;
  resetToken: string | null;
  usedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  admin?: { id: string; email: string; status: string };
}

export interface SellerBasicRecord {
  id: string;
  sellerName: string;
  sellerShopName: string | null;
  email: string;
  phoneNumber: string | null;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  isDeleted: boolean;
  deletedAt: Date | null;
  isProfileCompleted: boolean;
  profileCompletionPercentage: number;
}

export interface SellerListItem {
  id: string;
  sellerName: string;
  sellerShopName: string | null;
  email: string;
  phoneNumber: string | null;
  status: string;
  verificationStatus: string;
  isEmailVerified: boolean;
  profileCompletionPercentage: number;
  isProfileCompleted: boolean;
  sellerProfileImageUrl: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface CustomerListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  createdAt: Date;
  addresses: Array<{ city: string | null; state: string | null; country: string | null }>;
  orders: Array<{ totalAmount: any; paymentStatus: string }>;
}

export interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: Date;
  addresses: any[];
}

export interface MasterOrderRecord {
  id: string;
  customerId: string;
  totalAmount: any;
  paymentStatus: string;
  createdAt: Date;
  subOrders: any[];
}

// ──────────────────────────────────────────────────────────────
// Repository interface
// ──────────────────────────────────────────────────────────────
export interface AdminRepository {
  // ── Admin auth ──────────────────────────────────────────────
  findAdminByEmail(email: string): Promise<AdminRecord | null>;
  findAdminById(
    adminId: string,
    select?: Record<string, boolean>,
  ): Promise<Partial<AdminRecord> | null>;
  updateAdmin(adminId: string, data: Record<string, unknown>): Promise<void>;
  /**
   * Phase 1 / H3 — atomic anti-replay advance for the TOTP step
   * counter. Updates `mfaLastUsedStep` to `step` ONLY if the column
   * is currently null OR strictly less than `step`. Returns true when
   * the advance landed, false when another concurrent verify already
   * advanced past this step (the same TOTP was being replayed).
   *
   * The check-and-advance is a single SQL UPDATE so two parallel
   * verifies presenting the same code cannot both win.
   */
  advanceMfaLastUsedStepCas(
    adminId: string,
    step: number,
  ): Promise<boolean>;
  createAdminSession(data: {
    adminId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<AdminSessionRecord>;
  revokeAdminSessions(adminId: string): Promise<void>;
  /**
   * Look up a session by the RAW refresh token (caller never sees the hash).
   * Returns null on miss. Caller validates `revokedAt` / `expiresAt` itself.
   */
  findAdminSessionByRefreshToken(rawToken: string): Promise<{
    id: string;
    adminId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null>;
  /**
   * Phase 1 / C6 — secondary lookup on the burned-hash slot
   * (`previousRefreshTokenHash`). A hit means the caller presented
   * a token that was already rotated out → theft. The use-case
   * revokes every session for the actor on hit.
   */
  findAdminSessionByPreviousRefreshToken(rawToken: string): Promise<{
    id: string;
    adminId: string;
  } | null>;
  /**
   * Rotate the refresh token on an existing session (and bump expiresAt).
   * Caller passes the new RAW token; the impl hashes it before persist.
   */
  rotateAdminSession(
    sessionId: string,
    newRawRefreshToken: string,
    newExpiresAt: Date,
  ): Promise<void>;
  // PR 10.10 — step-up auth. Stamps `stepUpVerifiedAt = now` on the
  // specified session row so subsequent destructive-route requests
  // pass the @RequiresStepUp guard. Caller verifies the TOTP / backup
  // code before invoking. Optional on the interface for test stub
  // tolerance; the Prisma implementation provides it.
  markSessionStepUpVerified?(sessionId: string): Promise<void>;

  // ── Admin password reset OTP ────────────────────────────────
  findRecentAdminOtp(params: {
    adminId: string;
    unusedOnly: boolean;
    createdAfter: Date;
  }): Promise<AdminPasswordResetOtpRecord | null>;
  findActiveAdminOtp(adminId: string): Promise<AdminPasswordResetOtpRecord | null>;
  invalidateActiveAdminOtps(adminId: string): Promise<void>;
  createAdminOtp(data: {
    adminId: string;
    otpHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<void>;
  incrementAdminOtpAttempts(otpId: string): Promise<void>;
  expireAdminOtp(otpId: string): Promise<void>;
  markAdminOtpVerified(otpId: string, resetToken: string): Promise<void>;
  findAdminOtpByResetToken(
    resetToken: string,
  ): Promise<AdminPasswordResetOtpRecord | null>;
  resetAdminPasswordTransaction(params: {
    adminId: string;
    passwordHash: string;
    otpId: string;
  }): Promise<void>;

  // ── Seller management ──────────────────────────────────────
  findSellerById(sellerId: string): Promise<any | null>;
  findSellerByIdWithSelect(
    sellerId: string,
    select: Record<string, boolean>,
  ): Promise<any | null>;
  listSellers(params: {
    where: Prisma.SellerWhereInput;
    orderBy: Prisma.SellerOrderByWithRelationInput;
    skip: number;
    take: number;
  }): Promise<[SellerListItem[], number]>;
  updateSeller(
    sellerId: string,
    data: Record<string, unknown>,
    select?: Record<string, boolean>,
  ): Promise<any>;
  softDeleteSellerAndRevokeSessions(
    sellerId: string,
  ): Promise<void>;
  changeSellerPasswordAndRevokeSessions(
    sellerId: string,
    passwordHash: string,
  ): Promise<void>;

  // ── Impersonation log ──────────────────────────────────────
  createImpersonationLog(data: {
    adminId: string;
    sellerId: string;
    tokenId: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ id: string }>;

  // ── Seller messages ────────────────────────────────────────
  createSellerMessage(data: {
    sellerId: string;
    sentByAdminId: string;
    subject: string;
    message: string;
    channel: string;
    status: string;
  }): Promise<{
    id: string;
    subject: string;
    channel: string;
    status: string;
    createdAt: Date;
  }>;

  // ── Audit log ──────────────────────────────────────────────
  createAuditLog(data: {
    adminId: string;
    sellerId?: string | null;
    actionType: string;
    oldValue?: any;
    newValue?: any;
    reason?: string | null;
    metadata?: any;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void>;

  // ── Customers ──────────────────────────────────────────────
  listCustomers(params: {
    where: any;
    skip: number;
    take: number;
  }): Promise<[CustomerListItem[], number]>;
  findCustomerById(customerId: string): Promise<CustomerDetail | null>;
  findCustomerOrders(customerId: string): Promise<MasterOrderRecord[]>;
}
