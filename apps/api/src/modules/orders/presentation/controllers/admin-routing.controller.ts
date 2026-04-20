import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { CatalogPublicFacade } from '../../../catalog/application/facades/catalog-public.facade';
import { RoutingHealthService } from '../../application/services/routing-health.service';

type PreviewItem = {
  productId: string;
  variantId?: string | null;
  quantity: number;
};

@ApiTags('Admin Routing')
@Controller('admin/routing')
@UseGuards(AdminAuthGuard)
export class AdminRoutingController {
  constructor(
    private readonly catalogFacade: CatalogPublicFacade,
    private readonly healthService: RoutingHealthService,
  ) {}

  /**
   * Routing-engine health snapshot. Combines exception-queue backlog,
   * reassignment volume, top rejecting nodes, and pincodes with coverage
   * gaps — the operational signals that help an operator decide whether
   * the engine needs attention.
   */
  @Get('health')
  async getHealth() {
    const data = await this.healthService.getHealthSnapshot();
    return {
      success: true,
      message: 'Routing health snapshot',
      data,
    };
  }

  /**
   * Dry-run the allocation engine. Given a cart and pincode, returns the
   * routing decision per item (primary + alternates, scores, distances,
   * reasons) WITHOUT reserving stock or creating an order. Invaluable for
   * answering "why did this go to seller X?" questions without replaying a
   * real checkout.
   */
  @Post('preview')
  async preview(
    @Body()
    body: {
      pincode: string;
      items: PreviewItem[];
    },
  ) {
    if (!body?.pincode) {
      throw new BadRequestException('pincode is required');
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException(
        'items must be a non-empty array of {productId, variantId?, quantity}',
      );
    }
    if (body.items.length > 50) {
      throw new BadRequestException(
        'Preview capped at 50 items per request',
      );
    }

    const results = await Promise.all(
      body.items.map(async (item) => {
        if (!item.productId) {
          return {
            productId: item.productId ?? null,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            error: 'productId is required',
            allocation: null,
          };
        }
        if (!item.quantity || item.quantity < 1) {
          return {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            error: 'quantity must be >= 1',
            allocation: null,
          };
        }

        try {
          const allocation = await this.catalogFacade.allocate({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode: body.pincode,
            quantity: item.quantity,
          });
          return {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            error: null,
            allocation,
          };
        } catch (err) {
          return {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            error: (err as Error).message,
            allocation: null,
          };
        }
      }),
    );

    const unservicable = results.filter(
      (r) => !r.error && r.allocation && !r.allocation.serviceable,
    ).length;
    const failed = results.filter((r) => r.error).length;

    return {
      success: true,
      message: 'Routing preview complete',
      data: {
        pincode: body.pincode,
        summary: {
          totalItems: results.length,
          servicableItems: results.length - unservicable - failed,
          unservicableItems: unservicable,
          failedItems: failed,
        },
        results,
      },
    };
  }
}
