import { Inject, Injectable } from '@nestjs/common';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

@Injectable()
export class AdminCustomerService {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
  ) {}

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
        location: addr ? `${addr.city} ${addr.state}, ${addr.country}` : null,
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
