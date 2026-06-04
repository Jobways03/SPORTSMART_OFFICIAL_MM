// Phase 92 (2026-06-03) — FRANCHISE self-service Delhivery pickup.
//
// The franchise PORTAL (web-franchise) logs in with a FRANCHISE JWT, so it can't
// use the admin-only request-pickup route. This franchise-scoped route lets a
// franchise owner schedule a Delhivery pickup for THEIR OWN order directly.
// Reuses the same facade method as the admin + seller routes; ownership is
// enforced here (sub-order must belong to the authenticated franchise).

import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  FranchiseAuthGuard,
  FranchiseActiveGuard,
} from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { NotFoundAppException } from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { ShippingPublicFacade } from '../../application/facades/shipping-public.facade';

@ApiTags('Franchise Shipping')
@Controller('franchise/sub-orders/:subOrderId')
@UseGuards(FranchiseAuthGuard, FranchiseActiveGuard)
export class FranchiseShippingController {
  constructor(
    private readonly facade: ShippingPublicFacade,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Schedule a Delhivery pickup for the franchise's own sub-order. The scoped
   * findFirst (id + franchiseId + FRANCHISE node) is the tenancy check; the
   * pickup itself is the shared idempotent facade method.
   */
  @Post('request-pickup')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async requestPickup(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
  ) {
    const franchiseId: string | undefined = req?.franchiseId;
    const so = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId, franchiseId, fulfillmentNodeType: 'FRANCHISE' },
      select: { id: true },
    });
    if (!so) throw new NotFoundAppException('Sub-order not found');
    const data = await this.facade.requestPickupForSubOrder(subOrderId);
    return { success: data.success, message: data.message, data };
  }

  /**
   * Fetch the Delhivery shipping-label PDF URL for the franchise's own
   * sub-order. The franchise packs the box, so it needs the label to print +
   * paste before pickup. Same tenancy check as request-pickup; the facade
   * fetches the real carrier label on demand (labelUrl can be null until the
   * shipment is manifested — the portal shows a friendly message then).
   */
  @Get('label')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async getLabel(@Req() req: any, @Param('subOrderId') subOrderId: string) {
    const franchiseId: string | undefined = req?.franchiseId;
    const so = await this.prisma.subOrder.findFirst({
      where: { id: subOrderId, franchiseId, fulfillmentNodeType: 'FRANCHISE' },
      select: { id: true },
    });
    if (!so) throw new NotFoundAppException('Sub-order not found');
    const data = await this.facade.getLabelInfo(subOrderId);
    if (!data) throw new NotFoundAppException('Label info not found');
    return { success: true, message: 'Label info', data };
  }
}
