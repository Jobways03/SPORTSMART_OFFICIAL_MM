import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { AdminCustomerService } from '../../application/services/admin-customer.service';

@ApiTags('Admin Customers')
@Controller('admin/customers')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminCustomersController {
  constructor(private readonly customerService: AdminCustomerService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Permissions('customers.read')
  async listCustomers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.customerService.listCustomers({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      search,
    });

    return {
      success: true,
      message: 'Customers retrieved successfully',
      data,
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('customers.read')
  async getCustomer(@Param('id') id: string) {
    const data = await this.customerService.getCustomer(id);

    return {
      success: true,
      message: 'Customer retrieved',
      data,
    };
  }

  /**
   * Phase 21 (2026-05-20) — Admin unlock-account.
   *
   * Clears the lockout state on a customer whose failedLoginAttempts
   * threshold tripped. Required permission `customers.update` —
   * stricter than the read-only listing endpoints because this is a
   * write that affects login behaviour.
   */
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @Permissions('customers.update')
  async unlockCustomer(
    @Param('id') id: string,
    @Req() req: Request & { adminId?: string },
  ) {
    const data = await this.customerService.unlockAccount({
      adminId: req.adminId ?? 'unknown',
      userId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      success: true,
      message: 'Customer account unlocked. They can attempt to sign in again immediately.',
      data,
    };
  }
}
