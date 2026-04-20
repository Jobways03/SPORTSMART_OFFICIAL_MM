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
  createAdminSession(data: {
    adminId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<AdminSessionRecord>;
  revokeAdminSessions(adminId: string): Promise<void>;

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
