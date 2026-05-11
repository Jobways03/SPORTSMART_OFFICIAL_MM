import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AdminAuthGuard,
  PermissionsGuard,
  RolesGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { ShippingOptionsService } from '../../application/services/shipping-options.service';

// Cast BigInt → string for JSON serialization (NestJS doesn't handle
// BigInt natively in responses).
function serialize(opt: Record<string, unknown>) {
  return {
    ...opt,
    priceInPaise: (opt.priceInPaise as bigint)?.toString() ?? '0',
    freeShippingMinCartPaise:
      opt.freeShippingMinCartPaise != null
        ? (opt.freeShippingMinCartPaise as bigint).toString()
        : null,
  };
}

@ApiTags('Admin Shipping Options')
@Controller('admin/shipping-options')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminShippingOptionsController {
  constructor(private readonly service: ShippingOptionsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Permissions('shipping.read')
  async list(@Query('includeInactive') includeInactive?: string) {
    const items = await this.service.list(includeInactive === 'true');
    return {
      success: true,
      message: 'Shipping options retrieved',
      data: items.map(serialize),
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('shipping.read')
  async get(@Param('id') id: string) {
    const data = await this.service.get(id);
    return {
      success: true,
      message: 'Shipping option retrieved',
      data: serialize(data),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('shipping.write')
  async create(@Body() body: any) {
    const data = await this.service.create(body);
    return {
      success: true,
      message: 'Shipping option created',
      data: serialize(data),
    };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('shipping.write')
  async update(@Param('id') id: string, @Body() body: any) {
    const data = await this.service.update(id, body);
    return {
      success: true,
      message: 'Shipping option updated',
      data: serialize(data),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('shipping.write')
  async delete(@Param('id') id: string) {
    const result = await this.service.delete(id);
    return {
      success: true,
      message: result.hardDeleted
        ? 'Shipping option deleted'
        : 'Shipping option deactivated (in use by past orders)',
      data: result,
    };
  }
}
