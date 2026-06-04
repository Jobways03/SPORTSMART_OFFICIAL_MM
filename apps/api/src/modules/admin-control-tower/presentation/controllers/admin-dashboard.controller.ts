import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AdminAuthGuard, RolesGuard, PermissionsGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { AdminDashboardService } from '../../application/services/admin-dashboard.service';
import { AdminOperationsService, BulkPricingUpdate } from '../../application/services/admin-operations.service';
import {
  BulkActivateMappingsDto,
  BulkSuspendMappingsDto,
} from '../dtos/seller-mapping-suspension.dto';
import {
  AllocationAnalyticsQueryDto,
  AllocationEventsQueryDto,
} from '../dtos/allocation-analytics-query.dto';

/**
 * Phase 24 (2026-05-20) — Audit-driven hardening.
 *
 * Pre-Phase-24 the four read endpoints (KPIs, product performance,
 * seller performance, allocation analytics) wired AdminAuthGuard +
 * RolesGuard + PermissionsGuard but declared neither @Permissions nor
 * @Roles. PermissionsGuard.canActivate returns true when
 * requiredPermissions.length === 0, so every read endpoint was
 * effectively "any logged-in admin". A SELLER_SUPPORT admin could
 * read every business KPI on the control tower.
 *
 * Now each read uses @Permissions('analytics.read') so only admins
 * granted the read-analytics permission can hit them. SELLER_SUPPORT
 * and SELLER_OPERATIONS already have analytics.read in their default
 * role grant; SELLER_ADMIN inherits via custom-role assignment.
 *
 * Write endpoints already had @Roles('SUPER_ADMIN') (or
 * SUPER_ADMIN + SELLER_ADMIN) — kept as-is and additionally
 * annotated with a money-moving permission so the audit log carries
 * the same provenance regardless of how the route was reached.
 */
@ApiTags('Admin Control Tower')
@Controller('admin')
@UseGuards(AdminAuthGuard, RolesGuard, PermissionsGuard)
export class AdminDashboardController {
  constructor(
    private readonly dashboardService: AdminDashboardService,
    private readonly operationsService: AdminOperationsService,
  ) {}

  // ── T1: KPIs ────────────────────────────────────────────────────────────

  @Get('dashboard/kpis')
  @Permissions('analytics.read')
  async getKpis() {
    const data = await this.dashboardService.getKpis();
    return { success: true, message: 'Dashboard KPIs retrieved', data };
  }

  // ── T2: Product performance ─────────────────────────────────────────────

  @Get('dashboard/product-performance')
  @Permissions('analytics.read')
  async getProductPerformance(
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    const validPeriod = ['7d', '30d', '90d'].includes(period || '') ? period! : '30d';
    const parsedLimit = Math.min(50, Math.max(1, parseInt(limit || '10', 10) || 10));

    const data = await this.dashboardService.getProductPerformance(validPeriod, parsedLimit);
    return { success: true, message: 'Product performance retrieved', data };
  }

  // ── T3: Seller performance ──────────────────────────────────────────────

  @Get('dashboard/seller-performance')
  @Permissions('analytics.read')
  async getSellerPerformance() {
    const data = await this.dashboardService.getSellerPerformance();
    return { success: true, message: 'Seller performance retrieved', data };
  }

  // ── T4: Allocation analytics ────────────────────────────────────────────

  // Phase 233 (audit #233) — was a no-arg, no-counter endpoint. Now
  // returns the four outcome counters (primary/fallback/unservicable/
  // reassigned) + exception-queue count + top franchises alongside the
  // legacy fields, and accepts optional fromDate/toDate/nodeType
  // filters. Every aggregate excludes preview/listing/storefront noise.
  // Read-only scan that hits allocation_logs — throttled to keep a hot
  // dashboard from hammering the GROUP BYs.
  @Get('dashboard/allocation-analytics')
  @Permissions('analytics.read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getAllocationAnalytics(@Query() query: AllocationAnalyticsQueryDto) {
    const data = await this.dashboardService.getAllocationAnalytics({
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      nodeType: query.nodeType,
    });
    return { success: true, message: 'Allocation analytics retrieved', data };
  }

  // ── T4b: Allocation events drill-down ───────────────────────────────────

  // Phase 233 — paginated raw allocation_logs rows behind the counters.
  // Lets an operator inspect every decision of a given outcome /
  // eventSource (including the excluded PREVIEW/LISTING/STOREFRONT rows
  // when eventSource is pinned). limit is capped at 100 in the DTO and
  // re-clamped in the service.
  @Get('dashboard/allocation-events')
  @Permissions('analytics.read')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getAllocationEvents(@Query() query: AllocationEventsQueryDto) {
    const data = await this.dashboardService.getAllocationEvents({
      outcome: query.outcome,
      eventSource: query.eventSource,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
      nodeType: query.nodeType,
      page: query.page,
      limit: query.limit,
    });
    return { success: true, message: 'Allocation events retrieved', data };
  }

  // ── T5: Bulk pricing ───────────────────────────────────────────────────

  // Bulk pricing writes directly to product basePrice (and variant
  // price) across potentially hundreds of rows. Money-affecting +
  // cross-seller impact → SUPER_ADMIN only.
  @Patch('products/bulk-pricing')
  @Roles('SUPER_ADMIN')
  @Permissions('catalog.write')
  async bulkUpdatePricing(
    @Body() body: { updates: BulkPricingUpdate[] },
  ) {
    const data = await this.operationsService.bulkUpdatePricing(body.updates);
    return { success: true, message: 'Bulk pricing update completed', data };
  }

  // ── T6: Override allocation (reassign sub-order) — REMOVED in Phase 78
  //
  // Phase 78 (2026-05-22) — reassign audit Gap #6. The legacy
  // POST /admin/orders/:subOrderId/reassign that lived here is removed.
  // The modern, canonical endpoint is
  //   POST /admin/orders/sub-orders/:subOrderId/reassign
  // wired in AdminOrdersController. It supports SELLER and FRANCHISE
  // targets, captures a mandatory reason + admin actor, writes a
  // tx-atomic OrderReassignmentLog with FK to Admin, and publishes a
  // transactional outbox event for downstream subscribers.

  // ── T7: Seller mapping suspension ───────────────────────────────────────

  // Suspend/activate of a seller's full catalog is an operational
  // seller-account action on par with delete/impersonate — allow
  // SUPER_ADMIN and SELLER_ADMIN (same tier as those).
  //
  // Phase 59 (2026-05-22) — both endpoints now accept a mandatory
  // reason body (audit Gaps #5 + #12), pass adminId from the JWT
  // through to the service (audit Gap #3), and carry @Idempotent
  // so a retried POST returns the cached response instead of
  // re-firing audit + event + cache-invalidate (audit Gap #9).
  @Post('sellers/:sellerId/suspend-mappings')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('sellers.suspend')
  @Idempotent()
  async suspendMappings(
    @Req() req: Request,
    @Param('sellerId') sellerId: string,
    @Body() dto: BulkSuspendMappingsDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const data = await this.operationsService.suspendSellerMappings(
      sellerId,
      adminId,
      dto.reason,
    );
    return { success: true, message: 'Seller mappings suspended', data };
  }

  @Post('sellers/:sellerId/activate-mappings')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  @Permissions('sellers.suspend')
  @Idempotent()
  async activateMappings(
    @Req() req: Request,
    @Param('sellerId') sellerId: string,
    @Body() dto: BulkActivateMappingsDto,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const data = await this.operationsService.activateSellerMappings(
      sellerId,
      adminId,
      dto.reason,
    );
    return { success: true, message: 'Seller mappings activated', data };
  }
}
