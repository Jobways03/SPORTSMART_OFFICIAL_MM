import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  UserRepository,
  UserWithRoles,
  PasswordResetOtpRecord,
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
        data: { passwordHash: params.passwordHash },
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
