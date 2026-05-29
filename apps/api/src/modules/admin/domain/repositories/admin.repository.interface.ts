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
    // Phase 23 (2026-05-20) — needed for absolute-lifetime cap.
    createdAt: Date;
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

  /**
   * Phase 25 (2026-05-20) — race-safe MFA enrolment commit.
   *
   * Pre-Phase-25 the service did `findAdminById` (check mfaEnabledAt
   * is null) then a separate `updateAdmin`. Two concurrent
   * completeEnrollment calls with the same valid TOTP code could both
   * pass the check, both write the four columns idempotently, then
   * both call generateAndHashForAdmin and overwrite each other's
   * backup-code hashes — the admin sees two different code lists
   * from two response bodies and only the last one is real.
   *
   * This method runs the commit as a single updateMany guarded by
   * `mfaEnabledAt: null`. Returns true when this caller's row update
   * actually landed (count === 1), false when another concurrent
   * complete already committed. The caller then knows whether to
   * generate backup codes or to surface a 409.
   *
   * Optional on the interface for test stub tolerance.
   */
  commitMfaEnrollmentAtomic?(args: {
    adminId: string;
    pendingCiphertext: string;
    enabledAt: Date;
    lastUsedStep: number;
  }): Promise<boolean>;

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
  /**
   * Phase 26 (2026-05-20) — atomic CAS attempt increment. Returns the
   * post-increment attempts count if the row was eligible (active +
   * below cap) at the moment of the increment, or {ok:false} when
   * ineligible. Closes the race where two concurrent verifies both
   * observe `attempts < maxAttempts`. Mirror of
   * UserRepository.incrementOtpAttemptsCas + Seller / Franchise variants.
   */
  incrementAdminOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }>;
  /**
   * Phase 26 (2026-05-20) — count of admin OTPs created since a given
   * timestamp. Powers the per-admin hourly resend cap.
   */
  countAdminOtpsSince(adminId: string, since: Date): Promise<number>;
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
  // Phase 28 (2026-05-21) — extended to support franchise via the
  // targetActorType + targetActorId pair. sellerId is preserved for
  // back-compat with old readers when targetActorType=SELLER. The
  // tokenJti is the Redis-revocation key (see end-impersonation flow).
  createImpersonationLog(data: {
    adminId: string;
    targetActorType: 'SELLER' | 'FRANCHISE';
    targetActorId: string;
    tokenId: string;
    tokenJti: string;
    reason?: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ id: string }>;

  /**
   * Phase 28 (2026-05-21) — locate the active impersonation log row
   * for a given JTI so the end-impersonation flow can stamp endedAt
   * + clear the Redis key in one transaction.
   */
  findImpersonationLogByJti(
    tokenJti: string,
  ): Promise<{
    id: string;
    adminId: string;
    targetActorType: 'SELLER' | 'FRANCHISE';
    targetActorId: string;
    endedAt: Date | null;
    revokedAt: Date | null;
  } | null>;

  /**
   * Phase 28 (2026-05-21) — mark an impersonation as ended (clean
   * exit) or revoked (force-stop). Updates isActive=false in the
   * same write so existing isActive readers see the change.
   */
  endImpersonationLog(args: {
    id: string;
    endedAt: Date;
    revokedAt?: Date | null;
    revokedReason?: string | null;
  }): Promise<void>;

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
