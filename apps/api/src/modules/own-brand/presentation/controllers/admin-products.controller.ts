import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { OwnBrandService } from '../../application/services/own-brand.service';

@ApiTags('NOVA — Products')
@Controller('admin/nova/products')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('nova.write')
export class AdminNovaProductsController {
  constructor(private readonly service: OwnBrandService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.service.listOwnBrandProducts({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      search: search?.trim() || undefined,
    });
    return { success: true, message: 'Own-brand products retrieved', data };
  }

  @Post(':productId/convert')
  async convertToOwnBrand(@Param('productId') productId: string) {
    const data = await this.service.convertToOwnBrand(productId);
    return {
      success: true,
      message: 'Product converted to OWN_BRAND',
      data,
    };
  }

  @Post(':productId/unconvert')
  async unconvertToSeller(@Param('productId') productId: string) {
    const data = await this.service.unconvertToSeller(productId);
    return {
      success: true,
      message: 'Product reverted to SELLER',
      data,
    };
  }
}
