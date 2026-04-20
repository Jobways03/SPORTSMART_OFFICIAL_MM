import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  UserRepository,
  UserWithRoles,
  PasswordResetOtpRecord,
  CustomerProfile,
  CustomerProfileWithPassword,
  UpdateCustomerProfileInput,
} from '../../domain/repositories/user.repository';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { roleAssignments: { include: { role: true } } },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { roleAssignments: { include: { role: true } } },
    });
  }

  async findByEmailWithRoles(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        roleAssignments: {
          include: { role: true },
        },
      },
    }) as Promise<UserWithRoles | null>;
  }

  async save(_user: unknown): Promise<void> {
    // Generic save - not used in current use-cases but kept for interface compliance
  }

  // ── Customer profile self-service ──────────────────────────

  async findCustomerProfile(id: string): Promise<CustomerProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return user as CustomerProfile | null;
  }

  async findCustomerProfileWithPassword(
    id: string,
  ): Promise<CustomerProfileWithPassword | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        passwordHash: true,
      },
    });
    return user as CustomerProfileWithPassword | null;
  }

  async updateCustomerProfile(
    id: string,
    data: UpdateCustomerProfileInput,
  ): Promise<CustomerProfile> {
    // If email is changing, mark as unverified again
    const updates: any = { ...data };
    if (data.email !== undefined) {
      updates.emailVerified = false;
    }
    if (data.phone !== undefined) {
      updates.phoneVerified = false;
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return user as CustomerProfile;
  }

  async existsByEmailExcept(email: string, excludeUserId: string): Promise<boolean> {
    const found = await this.prisma.user.findFirst({
      where: { email, id: { not: excludeUserId } },
      select: { id: true },
    });
    return !!found;
  }

  async existsByPhoneExcept(phone: string, excludeUserId: string): Promise<boolean> {
    const found = await this.prisma.user.findFirst({
      where: { phone, id: { not: excludeUserId } },
      select: { id: true },
    });
    return !!found;
  }

  async changePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        // Clear the lockout counter too so the user is never stuck
        // locked-out after a self-service password change.
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async recordFailedLogin(
    userId: string,
    attempts: number,
    lockUntil: Date | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: attempts, lockUntil },
    });
  }

  async clearLoginLockout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockUntil: null },
    });
  }

  // ── Registration ───────────────────────────────────────────

  async createUserWithRole(data: {
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
  }): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          passwordHash: data.passwordHash,
        },
      });

      const customerRole = await tx.role.findUnique({
        where: { name: 'CUSTOMER' },
      });

      if (customerRole) {
        await tx.roleAssignment.create({
          data: {
            userId: newUser.id,
            roleId: customerRole.id,
          },
        });
      }

      return newUser;
    });
  }

  // ── Password update ────────────────────────────────────────

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  // ── OTP operations ─────────────────────────────────────────

  async findRecentOtp(userId: string, cooldownSeconds: number): Promise<PasswordResetOtpRecord | null> {
    return this.prisma.passwordResetOtp.findFirst({
      where: {
        userId,
        usedAt: null,
        createdAt: {
          gte: new Date(Date.now() - cooldownSeconds * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<PasswordResetOtpRecord | null>;
  }

  async findActiveOtp(userId: string): Promise<PasswordResetOtpRecord | null> {
    return this.prisma.passwordResetOtp.findFirst({
      where: {
        userId,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<PasswordResetOtpRecord | null>;
  }

  async invalidateActiveOtps(userId: string): Promise<void> {
    await this.prisma.passwordResetOtp.updateMany({
      where: {
        userId,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { expiresAt: new Date() },
    });
  }

  async createOtp(userId: string, otpHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.passwordResetOtp.create({
      data: {
        userId,
        otpHash,
        expiresAt,
      },
    });
  }

  async incrementOtpAttempts(otpId: string): Promise<void> {
    await this.prisma.passwordResetOtp.update({
      where: { id: otpId },
      data: { attempts: { increment: 1 } },
    });
  }

  async expireOtp(otpId: string): Promise<void> {
    await this.prisma.passwordResetOtp.update({
      where: { id: otpId },
      data: { expiresAt: new Date() },
    });
  }

  async markOtpVerified(otpId: string, resetToken: string): Promise<void> {
    await this.prisma.passwordResetOtp.update({
      where: { id: otpId },
      data: {
        verifiedAt: new Date(),
        resetToken,
      },
    });
  }

  async findOtpByResetToken(resetToken: string): Promise<PasswordResetOtpRecord | null> {
    return this.prisma.passwordResetOtp.findUnique({
      where: { resetToken },
      include: { user: true },
    }) as unknown as PasswordResetOtpRecord | null;
  }

  // ── Reset password transaction ─────────────────────────────

  async resetPasswordTransaction(params: {
    userId: string;
    passwordHash: string;
    otpId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: params.userId },
        data: {
          passwordHash: params.passwordHash,
          // Clear lockout so a previously locked-out user can log in
          // immediately with the new password.
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });

      await tx.passwordResetOtp.update({
        where: { id: params.otpId },
        data: { usedAt: new Date() },
      });

      // Revoke all active sessions for this user
      await tx.session.updateMany({
        where: {
          userId: params.userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });
  }

  // ── Role/permission queries ────────────────────────────────

  async getUserRoles(userId: string): Promise<string[]> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { userId },
      include: { role: true },
    });
    return assignments.map((a) => a.role.name);
  }

  async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    const count = await this.prisma.rolePermission.count({
      where: {
        role: { assignments: { some: { userId } } },
        permission: { code: permissionCode },
      },
    });
    return count > 0;
  }
}
