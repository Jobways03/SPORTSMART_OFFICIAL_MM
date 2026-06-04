// Phase 92 (2026-06-03) — SELLER self-service Delhivery pickup.
//
// The seller PORTALS (web-d2c-seller / web-retail-seller) log in with a SELLER
// JWT, so they cannot call the admin-only POST /admin/shipping/.../request-pickup
// route (AdminAuthGuard would 401/403). This seller-scoped route lets a seller
// schedule a Delhivery pickup for THEIR OWN order without going through an admin
// — removing the "admin forgot to raise the pickup" single point of failure.
//
// D2C and RETAIL sellers share one SellerAuthGuard (channel is just a DB column),
// so this single endpoint serves both. It reuses the SAME facade method the
// admin route uses; the only addition is an ownership check (the facade resolves
// the warehouse from the sub-order itself and does NOT validate the caller).

import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { SellerAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import {
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ShippingPublicFacade } from '../../application/facades/shipping-public.facade';

@ApiTags('Seller Shipping')
@Controller('seller/sub-orders/:subOrderId')
@UseGuards(SellerAuthGuard)
export class SellerShippingController {
  constructor(
    private readonly facade: ShippingPublicFacade,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Schedule a Delhivery pickup for the seller's own sub-order. Ownership is
   * enforced here (SellerAuthGuard only proves identity); the actual pickup is
   * the shared, idempotent-per-warehouse-per-day facade method.
   */
  @Post('request-pickup')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async requestPickup(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
  ) {
    const sellerId: string | undefined = req?.sellerId;
    const so = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, sellerId: true },
    });
    if (!so) throw new NotFoundAppException('Sub-order not found');
    if (!sellerId || so.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You can only request a pickup for a sub-order you own',
      );
    }
    const data = await this.facade.requestPickupForSubOrder(subOrderId);
    return { success: data.success, message: data.message, data };
  }

  /**
   * Fetch the Delhivery shipping-label PDF URL for the seller's own sub-order.
   * The seller packs the box, so they need the label to print + paste before
   * the pickup executive arrives. Same ownership check as request-pickup; the
   * facade fetches the real carrier label on demand (it deliberately does NOT
   * fall back to the tracking page, so labelUrl can be null until the shipment
   * is manifested — the portal handles that with a friendly message).
   */
  @Get('label')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getLabel(@Req() req: any, @Param('subOrderId') subOrderId: string) {
    const sellerId: string | undefined = req?.sellerId;
    const so = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, sellerId: true },
    });
    if (!so) throw new NotFoundAppException('Sub-order not found');
    if (!sellerId || so.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'You can only view the label for a sub-order you own',
      );
    }
    const data = await this.facade.getLabelInfo(subOrderId);
    if (!data) throw new NotFoundAppException('Label info not found');
    return { success: true, message: 'Label info', data };
  }
}
