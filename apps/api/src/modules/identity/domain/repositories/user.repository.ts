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

export interface CustomerProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
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

  // Registration (transactional)
  createUserWithRole(data: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
  }): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }>;

  // Password update
  updatePassword(userId: string, passwordHash: string): Promise<void>;

  // Brute-force lockout counters (parity with Seller / Franchise / Admin).
  recordFailedLogin(userId: string, attempts: number, lockUntil: Date | null): Promise<void>;
  clearLoginLockout(userId: string): Promise<void>;

  // OTP operations
  findRecentOtp(userId: string, cooldownSeconds: number): Promise<PasswordResetOtpRecord | null>;
  findActiveOtp(userId: string): Promise<PasswordResetOtpRecord | null>;
  invalidateActiveOtps(userId: string): Promise<void>;
  createOtp(userId: string, otpHash: string, expiresAt: Date): Promise<void>;
  incrementOtpAttempts(otpId: string): Promise<void>;
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
