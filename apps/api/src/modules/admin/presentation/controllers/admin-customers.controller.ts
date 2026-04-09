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
import { AdminAuthGuard } from '../../../../core/guards';
import { AdminCustomerService } from '../../application/services/admin-customer.service';

@ApiTags('Admin Customers')
@Controller('admin/customers')
@UseGuards(AdminAuthGuard)
export class AdminCustomersController {
  constructor(private readonly customerService: AdminCustomerService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
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
  async getCustomer(@Param('id') id: string) {
    const data = await this.customerService.getCustomer(id);

    return {
      success: true,
      message: 'Customer retrieved',
      data,
    };
  }
}
