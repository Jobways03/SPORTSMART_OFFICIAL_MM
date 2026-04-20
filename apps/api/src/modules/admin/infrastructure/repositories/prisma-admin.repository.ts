import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { Prisma } from '@prisma/client';
import {
  AdminRepository,
  AdminRecord,
  AdminSessionRecord,
  AdminPasswordResetOtpRecord,
  SellerListItem,
  CustomerListItem,
  CustomerDetail,
  MasterOrderRecord,
} from '../../domain/repositories/admin.repository.interface';

@Injectable()
export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Admin auth ─────────────────────────────────────────────

  async findAdminByEmail(email: string): Promise<AdminRecord | null> {
    return this.prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    }) as Promise<AdminRecord | null>;
  }

  async findAdminById(
    adminId: string,
    select?: Record<string, boolean>,
  ): Promise<Partial<AdminRecord> | null> {
    if (select) {
      return this.prisma.admin.findUnique({ where: { id: adminId }, select }) as any;
    }
    return this.prisma.admin.findUnique({ where: { id: adminId } }) as any;
  }

  async updateAdmin(adminId: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.admin.update({ where: { id: adminId }, data });
  }

  async createAdminSession(data: {
    adminId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<AdminSessionRecord> {
    return this.prisma.adminSession.create({ data }) as Promise<AdminSessionRecord>;
  }

  async revokeAdminSessions(adminId: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── Seller management ──────────────────────────────────────

  async findSellerById(sellerId: string): Promise<any | null> {
    return this.prisma.seller.findUnique({ where: { id: sellerId } });
  }

  async findSellerByIdWithSelect(
    sellerId: string,
    select: Record<string, boolean>,
  ): Promise<any | null> {
    return this.prisma.seller.findUnique({ where: { id: sellerId }, select });
  }

  async listSellers(params: {
    where: Prisma.SellerWhereInput;
    orderBy: Prisma.SellerOrderByWithRelationInput;
    skip: number;
    take: number;
  }): Promise<[SellerListItem[], number]> {
    const { where, orderBy, skip, take } = params;
    const [sellers, total] = await Promise.all([
      this.prisma.seller.findMany({
        where,
        select: {
          id: true,
          sellerName: true,
          sellerShopName: true,
          email: true,
          phoneNumber: true,
          status: true,
          verificationStatus: true,
          isEmailVerified: true,
          profileCompletionPercentage: true,
          isProfileCompleted: true,
          sellerProfileImageUrl: true,
          createdAt: true,
          lastLoginAt: true,
        },
        orderBy,
        skip,
        take,
      }),
      this.prisma.seller.count({ where }),
    ]);
    return [sellers as SellerListItem[], total];
  }

  async updateSeller(
    sellerId: string,
    data: Record<string, unknown>,
    select?: Record<string, boolean>,
  ): Promise<any> {
    if (select) {
      return this.prisma.seller.update({ where: { id: sellerId }, data, select });
    }
    return this.prisma.seller.update({ where: { id: sellerId }, data });
  }

  async softDeleteSellerAndRevokeSessions(sellerId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.seller.update({
        where: { id: sellerId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          status: 'DEACTIVATED',
        },
      }),
      this.prisma.sellerSession.updateMany({
        where: { sellerId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async changeSellerPasswordAndRevokeSessions(
    sellerId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.seller.update({
        where: { id: sellerId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      }),
      this.prisma.sellerSession.updateMany({
        where: { sellerId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  // ── Impersonation log ──────────────────────────────────────

  async createImpersonationLog(data: {
    adminId: string;
    sellerId: string;
    tokenId: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{ id: string }> {
    return this.prisma.adminImpersonationLog.create({ data });
  }

  // ── Seller messages ────────────────────────────────────────

  async createSellerMessage(data: {
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
  }> {
    return this.prisma.adminSellerMessage.create({ data }) as any;
  }

  // ── Audit log ──────────────────────────────────────────────

  async createAuditLog(data: {
    adminId: string;
    sellerId?: string | null;
    actionType: string;
    oldValue?: any;
    newValue?: any;
    reason?: string | null;
    metadata?: any;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.prisma.adminActionAuditLog.create({
      data: {
        adminId: data.adminId,
        sellerId: data.sellerId || null,
        actionType: data.actionType,
        oldValue: data.oldValue ? JSON.parse(JSON.stringify(data.oldValue)) : undefined,
        newValue: data.newValue ? JSON.parse(JSON.stringify(data.newValue)) : undefined,
        reason: data.reason || null,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
      },
    });
  }

  // ── Customers ──────────────────────────────────────────────

  async listCustomers(params: {
    where: any;
    skip: number;
    take: number;
  }): Promise<[CustomerListItem[], number]> {
    const { where, skip, take } = params;
    const [customers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
          emailVerified: true,
          createdAt: true,
          addresses: {
            where: { isDefault: true },
            select: { city: true, state: true, country: true },
            take: 1,
          },
          orders: {
            select: { totalAmount: true, paymentStatus: true },
          },
        },
        orderBy: { createdAt: 'desc' as const },
        skip,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return [customers as CustomerListItem[], total];
  }

  async findCustomerById(customerId: string): Promise<CustomerDetail | null> {
    return this.prisma.user.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        emailVerified: true,
        phoneVerified: true,
        createdAt: true,
        addresses: {
          orderBy: { isDefault: 'desc' as const },
        },
      },
    }) as Promise<CustomerDetail | null>;
  }

  async findCustomerOrders(customerId: string): Promise<MasterOrderRecord[]> {
    return this.prisma.masterOrder.findMany({
      where: { customerId },
      include: {
        subOrders: {
          include: {
            items: true,
            seller: { select: { sellerShopName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' as const },
    }) as unknown as MasterOrderRecord[];
  }

  // ── Admin password reset OTP ────────────────────────────────────────────

  async findRecentAdminOtp(params: {
    adminId: string;
    unusedOnly: boolean;
    createdAfter: Date;
  }): Promise<AdminPasswordResetOtpRecord | null> {
    return this.prisma.adminPasswordResetOtp.findFirst({
      where: {
        adminId: params.adminId,
        ...(params.unusedOnly ? { usedAt: null } : {}),
        createdAt: { gte: params.createdAfter },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<AdminPasswordResetOtpRecord | null>;
  }

  async findActiveAdminOtp(
    adminId: string,
  ): Promise<AdminPasswordResetOtpRecord | null> {
    return this.prisma.adminPasswordResetOtp.findFirst({
      where: {
        adminId,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<AdminPasswordResetOtpRecord | null>;
  }

  async invalidateActiveAdminOtps(adminId: string): Promise<void> {
    await this.prisma.adminPasswordResetOtp.updateMany({
      where: {
        adminId,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { expiresAt: new Date() },
    });
  }

  async createAdminOtp(data: {
    adminId: string;
    otpHash: string;
    purpose: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.adminPasswordResetOtp.create({
      data: {
        adminId: data.adminId,
        otpHash: data.otpHash,
        purpose: data.purpose,
        expiresAt: data.expiresAt,
      },
    });
  }

  async incrementAdminOtpAttempts(otpId: string): Promise<void> {
    await this.prisma.adminPasswordResetOtp.update({
      where: { id: otpId },
      data: { attempts: { increment: 1 } },
    });
  }

  async expireAdminOtp(otpId: string): Promise<void> {
    await this.prisma.adminPasswordResetOtp.update({
      where: { id: otpId },
      data: { expiresAt: new Date() },
    });
  }

  async markAdminOtpVerified(
    otpId: string,
    resetToken: string,
  ): Promise<void> {
    await this.prisma.adminPasswordResetOtp.update({
      where: { id: otpId },
      data: { verifiedAt: new Date(), resetToken },
    });
  }

  async findAdminOtpByResetToken(
    resetToken: string,
  ): Promise<AdminPasswordResetOtpRecord | null> {
    return this.prisma.adminPasswordResetOtp.findUnique({
      where: { resetToken },
      include: {
        admin: { select: { id: true, email: true, status: true } },
      },
    }) as unknown as AdminPasswordResetOtpRecord | null;
  }

  async resetAdminPasswordTransaction(params: {
    adminId: string;
    passwordHash: string;
    otpId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: params.adminId },
        data: {
          passwordHash: params.passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });
      await tx.adminPasswordResetOtp.update({
        where: { id: params.otpId },
        data: { usedAt: new Date() },
      });
      // Revoke all existing sessions — forces re-login with the new password.
      await tx.adminSession.updateMany({
        where: { adminId: params.adminId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }
}
