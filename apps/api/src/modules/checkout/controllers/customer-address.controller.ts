import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../core/guards';
import { Idempotent } from '../../../core/decorators/idempotent.decorator';
import { CustomerAddressService } from '../application/services/customer-address.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
} from '../presentation/dtos/customer-address.dto';

/**
 * Phase 63 (2026-05-22) — controller hardening.
 *
 * Pre-Phase-63:
 *   - Inline `@Body() body: {...}` interface, no class-validator
 *     (audit Gap #4 — mass-assignment exposure).
 *   - No rate limit (audit Gap #13) — an authed user could
 *     loop POST with unique idempotency keys.
 *
 * Phase 63 closes both: DTOs at the pipe layer enforce shape
 * and bounds (and strip `+91` from phones — audit Gap #8), and
 * @Throttle on every mutation caps the per-actor budget.
 */
@ApiTags('Customer Addresses')
@Controller('customer/addresses')
@UseGuards(UserAuthGuard)
export class CustomerAddressController {
  constructor(private readonly addressService: CustomerAddressService) {}

  @Get()
  async listAddresses(@Req() req: any) {
    const addresses = await this.addressService.listAddresses(req.userId);
    return {
      success: true,
      message: 'Addresses retrieved',
      data: addresses,
    };
  }

  // Phase 4 / H46 — protect address create + update against
  // double-submits. A jittery click on "Save address" or a
  // network-retried request would otherwise persist two identical
  // rows in the customer's address book. The interceptor reads
  // X-Idempotency-Key and replays the cached response on a retry
  // with the same key (per-actor scope, 24-hour TTL).
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Idempotent()
  async createAddress(@Req() req: any, @Body() dto: CreateAddressDto) {
    const address = await this.addressService.createAddress(req.userId, dto);
    return {
      success: true,
      message: 'Address created',
      data: address,
    };
  }

  @Patch(':addressId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Idempotent()
  async updateAddress(
    @Req() req: any,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    const address = await this.addressService.updateAddress(
      req.userId,
      addressId,
      dto,
    );
    return {
      success: true,
      message: 'Address updated',
      data: address,
    };
  }

  @Delete(':addressId')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async deleteAddress(
    @Req() req: any,
    @Param('addressId') addressId: string,
  ) {
    const result = await this.addressService.deleteAddress(req.userId, addressId);
    return {
      success: true,
      message: 'Address deleted',
      data: result,
    };
  }

  @Patch(':addressId/set-default')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async setDefaultAddress(
    @Req() req: any,
    @Param('addressId') addressId: string,
  ) {
    const result = await this.addressService.setDefaultAddress(
      req.userId,
      addressId,
    );
    return {
      success: true,
      message: 'Default address updated',
      data: result,
    };
  }
}
