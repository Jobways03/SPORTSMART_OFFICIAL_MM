import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { AdminDeliveryMethodsService } from '../../application/services/admin-delivery-methods.service';
import { AdminUpdateDeliveryMethodsDto } from '../dtos/admin-update-delivery-methods.dto';

/**
 * All admin endpoints wrap responses in `{ success, message, data }` —
 * the storefront / franchise-admin shared `apiClient` expects this
 * envelope and surfaces "Failed to load..." when `data` is absent.
 * Don't return raw service results.
 */
function ok<T>(data: T, message = 'OK') {
  return { success: true, message, data };
}

/**
 * Marketplace-admin endpoints for managing per-seller delivery
 * entitlements (self-delivery toggle + pincode service area).
 *
 * Mounted under /admin so the existing `AdminAuthGuard` covers authn.
 * SUPER_ADMIN is required to change a seller's fulfilment entitlement.
 * (iThink removed — self-delivery is the only method today.)
 */
@ApiTags('Admin · Delivery Methods')
@Controller('admin/sellers')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminSellerDeliveryMethodsController {
  constructor(private readonly service: AdminDeliveryMethodsService) {}

  @Get(':id/delivery-methods')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getSettings(@Param('id') sellerId: string) {
    const data = await this.service.getSellerSettings(sellerId);
    return ok(data, 'Seller delivery methods retrieved');
  }

  @Patch(':id/delivery-methods')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') sellerId: string,
    @Body() body: AdminUpdateDeliveryMethodsDto,
  ) {
    const data = await this.service.updateSellerSettings(sellerId, {
      selfDeliveryEnabled: body.selfDeliveryEnabled,
      selfDeliveryPincodes:
        body.selfDeliveryPincodes === undefined ? undefined : body.selfDeliveryPincodes,
    });
    return ok(data, 'Seller delivery methods updated');
  }
}

/**
 * Franchise-admin counterpart. Lives under a separate route prefix so
 * the existing franchise-admin auth guard chain applies. The
 * underlying service is shared — entitlement logic is identical for
 * both entities.
 */
@ApiTags('Admin · Delivery Methods')
@Controller('admin/franchises')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminFranchiseDeliveryMethodsController {
  constructor(private readonly service: AdminDeliveryMethodsService) {}

  @Get(':id/delivery-methods')
  @Roles('ADMIN', 'SUPER_ADMIN')
  async getSettings(@Param('id') franchiseId: string) {
    const data = await this.service.getFranchiseSettings(franchiseId);
    return ok(data, 'Franchise delivery methods retrieved');
  }

  @Patch(':id/delivery-methods')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') franchiseId: string,
    @Body() body: AdminUpdateDeliveryMethodsDto,
  ) {
    const data = await this.service.updateFranchiseSettings(franchiseId, {
      selfDeliveryEnabled: body.selfDeliveryEnabled,
      selfDeliveryPincodes:
        body.selfDeliveryPincodes === undefined ? undefined : body.selfDeliveryPincodes,
    });
    return ok(data, 'Franchise delivery methods updated');
  }
}
