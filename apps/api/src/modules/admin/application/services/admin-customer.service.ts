import { Inject, Injectable } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

@Injectable()
export class AdminCustomerService {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * Phase 21 (2026-05-20) — Admin unlock-account helper. Clears
   * `lockUntil` and `failedLoginAttempts` for a customer who's been
   * locked out by the 5-strikes lockout policy. Useful when support
   * needs to manually reset a customer who's offline mid-lockout.
   *
   * Audit-logged with the admin's id + IP/UA so the action is
   * traceable.
   */
  async unlockAccount(input: {
    adminId: string;
    userId: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ userId: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        lockUntil: true,
        failedLoginAttempts: true,
      },
    });
    if (!user) {
      throw new NotFoundAppException('Customer not found');
    }
    await this.prisma.user.update({
      where: { id: input.userId },
      data: { lockUntil: null, failedLoginAttempts: 0 },
    });
    this.audit
      .writeAuditLog({
        actorId: input.adminId,
        actorRole: 'ADMIN',
        action: 'CUSTOMER_ACCOUNT_UNLOCKED',
        module: 'admin',
        resource: 'User',
        resourceId: input.userId,
        oldValue: {
          lockUntil: user.lockUntil,
          failedLoginAttempts: user.failedLoginAttempts,
        },
        newValue: { lockUntil: null, failedLoginAttempts: 0 },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch(() => undefined);
    return { userId: input.userId };
  }

  async listCustomers(params: {
    page: number;
    limit: number;
    search?: string;
  }) {
    const { page, limit, search } = params;
    const pageNum = Math.max(1, page);
    const limitNum = Math.min(100, Math.max(1, limit));

    const where: any = {
      roleAssignments: {
        some: { role: { name: 'CUSTOMER' } },
      },
    };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await this.adminRepo.listCustomers({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    });

    const enriched = customers.map((c) => {
      const addr = c.addresses[0] || null;
      const orderCount = c.orders.length;
      const amountSpent = c.orders
        .filter((o) => o.paymentStatus !== 'CANCELLED')
        .reduce((sum, o) => sum + Number(o.totalAmount), 0);
      const { addresses, orders, ...rest } = c;
      return {
        ...rest,
        location: addr
          ? [addr.city, addr.state, addr.country].filter(Boolean).join(', ')
          : null,
        orderCount,
        amountSpent,
      };
    });

    return {
      customers: enriched,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }

  async getCustomer(id: string) {
    const customer = await this.adminRepo.findCustomerById(id);

    if (!customer) {
      throw new NotFoundAppException('Customer not found');
    }

    const orders = await this.adminRepo.findCustomerOrders(id);

    const totalSpent = orders
      .filter((o) => o.paymentStatus !== 'CANCELLED')
      .reduce((sum, o) => sum + Number(o.totalAmount), 0);

    const lastOrder = orders.length > 0 ? orders[0] : null;

    return {
      customer,
      stats: {
        totalOrders: orders.length,
        totalSpent,
        customerSinceDays: Math.floor(
          (Date.now() - new Date(customer.createdAt).getTime()) / (1000 * 60 * 60 * 24),
        ),
      },
      lastOrder,
      orders,
    };
  }
}
