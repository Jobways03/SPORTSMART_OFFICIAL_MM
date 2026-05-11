import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
 * entitlements (iThink + self-delivery toggles).
 *
 * Mounted under /admin so the existing `AdminAuthGuard` covers
 * authn. SUPER_ADMIN is required because flipping iThink on for
 * a seller triggers warehouse registration (a billable iThink
 * operation) and changes which methods that seller can use.
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
      ithinkEnabled: body.ithinkEnabled,
      selfDeliveryEnabled: body.selfDeliveryEnabled,
      selfDeliveryPincodes:
        body.selfDeliveryPincodes === undefined ? undefined : body.selfDeliveryPincodes,
    });
    return ok(data, 'Seller delivery methods updated');
  }

  /**
   * Carrier-side warehouse registration. Calls iThink Add Warehouse
   * using the seller's stored profile address. Decoupled from the
   * toggle so an admin can flip iThink ON without depending on iThink
   * being reachable, and retry the registration when ready.
   */
  @Post(':id/delivery-methods/register-ithink')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async registerIThink(@Param('id') sellerId: string) {
    const data = await this.service.registerSellerWithIThink(sellerId);
    return ok(data, 'Seller registered with iThink');
  }

  /**
   * Sync the warehouse-approval state from iThink. Useful when iThink
   * ops has approved the warehouse but our PENDING row hasn't been
   * refreshed yet — a daily cron would do this automatically in prod.
   */
  @Post(':id/delivery-methods/refresh-ithink')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async refreshIThink(@Param('id') sellerId: string) {
    const data = await this.service.refreshSellerIThinkStatus(sellerId);
    return ok(data, 'Seller iThink status refreshed');
  }

  /**
   * Re-register the pickup at the current profile address. Used when
   * the seller has changed their address — `ithinkWarehouseStatus`
   * goes to STALE on profile save, admin clicks this to create a
   * fresh iThink warehouse_id pointed at the new address.
   */
  @Post(':id/delivery-methods/reregister-ithink')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async reregisterIThink(@Param('id') sellerId: string) {
    const data = await this.service.reregisterSellerWithIThink(sellerId);
    return ok(data, 'Seller re-registered with iThink');
  }
}

/**
 * Franchise-admin counterpart. Lives under a separate route prefix
 * so the existing franchise-admin auth guard chain applies. The
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
      ithinkEnabled: body.ithinkEnabled,
      selfDeliveryEnabled: body.selfDeliveryEnabled,
      selfDeliveryPincodes:
        body.selfDeliveryPincodes === undefined ? undefined : body.selfDeliveryPincodes,
    });
    return ok(data, 'Franchise delivery methods updated');
  }

  @Post(':id/delivery-methods/register-ithink')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async registerIThink(@Param('id') franchiseId: string) {
    const data = await this.service.registerFranchiseWithIThink(franchiseId);
    return ok(data, 'Franchise registered with iThink');
  }

  @Post(':id/delivery-methods/refresh-ithink')
  @Roles('ADMIN', 'SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async refreshIThink(@Param('id') franchiseId: string) {
    const data = await this.service.refreshFranchiseIThinkStatus(franchiseId);
    return ok(data, 'Franchise iThink status refreshed');
  }

  @Post(':id/delivery-methods/reregister-ithink')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  async reregisterIThink(@Param('id') franchiseId: string) {
    const data = await this.service.reregisterFranchiseWithIThink(franchiseId);
    return ok(data, 'Franchise re-registered with iThink');
  }
}
