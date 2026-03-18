import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AdminAuthGuard } from '../../infrastructure/guards/admin-auth.guard';
import { NotFoundAppException } from '../../../../core/exceptions';

@ApiTags('Admin Customers')
@Controller('admin/customers')
@UseGuards(AdminAuthGuard)
export class AdminCustomersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async listCustomers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20));

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
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      this.prisma.user.count({ where }),
    ]);

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
      success: true,
      message: 'Customers retrieved successfully',
      data: {
        customers: enriched,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getCustomer(@Param('id') id: string) {
    const customer = await this.prisma.user.findUnique({
      where: { id },
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
          orderBy: { isDefault: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new NotFoundAppException('Customer not found');
    }

    // Get order stats
    const orders = await this.prisma.masterOrder.findMany({
      where: { customerId: id },
      include: {
        subOrders: {
          include: {
            items: true,
            seller: { select: { sellerShopName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalSpent = orders
      .filter((o) => o.paymentStatus !== 'CANCELLED')
      .reduce((sum, o) => sum + Number(o.totalAmount), 0);

    const lastOrder = orders.length > 0 ? orders[0] : null;

    return {
      success: true,
      message: 'Customer retrieved',
      data: {
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
      },
    };
  }
}
