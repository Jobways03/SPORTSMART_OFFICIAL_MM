import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { CatalogPublicFacade } from '../../../catalog/application/facades/catalog-public.facade';
import { RoutingHealthService } from '../../application/services/routing-health.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { RoutingPreviewDto } from '../dtos/routing-preview.dto';

@ApiTags('Admin Routing')
@Controller('admin/routing')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('orders.read')
export class AdminRoutingController {
  constructor(
    private readonly catalogFacade: CatalogPublicFacade,
    private readonly healthService: RoutingHealthService,
    private readonly audit: AuditPublicFacade,
  ) {}

  /**
   * Routing-engine health snapshot. Combines exception-queue backlog,
   * reassignment volume, top rejecting nodes, and pincodes with coverage
   * gaps — the operational signals that help an operator decide whether
   * the engine needs attention.
   */
  @Get('health')
  // Phase 232 — health runs several full-table aggregates per call.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
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
   *
   * Phase 232 — input is validated by RoutingPreviewDto (400 on a malformed
   * pincode/shape); each allocate() is tagged eventSource=PREVIEW so the dry-run
   * doesn't pollute checkout analytics; a dedicated throttle bounds the
   * 50-items-x-full-allocator fan-out; and the sensitive ranking view is
   * recorded in the audit chain.
   */
  @Post('preview')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async preview(@Req() req: any, @Body() body: RoutingPreviewDto) {
    const results = await Promise.all(
      body.items.map(async (item) => {
        try {
          const allocation = await this.catalogFacade.allocate({
            productId: item.productId,
            variantId: item.variantId ?? undefined,
            customerPincode: body.pincode,
            quantity: item.quantity,
            paymentMethod: body.paymentMethod,
            eventSource: 'PREVIEW',
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

    // Phase 232 — best-effort audit of the sensitive routing-ranking view.
    this.audit
      .writeAuditLog({
        actorId: req?.adminId ?? req?.user?.id ?? 'SYSTEM',
        actorRole: 'ADMIN',
        action: 'ADMIN_VIEW_ROUTING_PREVIEW',
        module: 'orders',
        resource: 'RoutingPreview',
        resourceId: body.pincode,
        newValue: {
          pincode: body.pincode,
          itemCount: body.items.length,
          paymentMethod: body.paymentMethod ?? null,
        },
      } as any)
      .catch(() => undefined);

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
