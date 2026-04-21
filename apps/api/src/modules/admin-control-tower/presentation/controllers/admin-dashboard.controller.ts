import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { AdminDashboardService } from '../../application/services/admin-dashboard.service';
import { AdminOperationsService, BulkPricingUpdate } from '../../application/services/admin-operations.service';

@ApiTags('Admin Control Tower')
@Controller('admin')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminDashboardController {
  constructor(
    private readonly dashboardService: AdminDashboardService,
    private readonly operationsService: AdminOperationsService,
  ) {}

  // ── T1: KPIs ────────────────────────────────────────────────────────────

  @Get('dashboard/kpis')
  async getKpis() {
    const data = await this.dashboardService.getKpis();
    return { success: true, message: 'Dashboard KPIs retrieved', data };
  }

  // ── T2: Product performance ─────────────────────────────────────────────

  @Get('dashboard/product-performance')
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
  async getSellerPerformance() {
    const data = await this.dashboardService.getSellerPerformance();
    return { success: true, message: 'Seller performance retrieved', data };
  }

  // ── T4: Allocation analytics ────────────────────────────────────────────

  @Get('dashboard/allocation-analytics')
  async getAllocationAnalytics() {
    const data = await this.dashboardService.getAllocationAnalytics();
    return { success: true, message: 'Allocation analytics retrieved', data };
  }

  // ── T5: Bulk pricing ───────────────────────────────────────────────────

  // Bulk pricing writes directly to product basePrice (and variant
  // price) across potentially hundreds of rows. Money-affecting +
  // cross-seller impact → SUPER_ADMIN only.
  @Patch('products/bulk-pricing')
  @Roles('SUPER_ADMIN')
  async bulkUpdatePricing(
    @Body() body: { updates: BulkPricingUpdate[] },
  ) {
    const data = await this.operationsService.bulkUpdatePricing(body.updates);
    return { success: true, message: 'Bulk pricing update completed', data };
  }

  // ── T6: Override allocation (reassign sub-order) ────────────────────────

  // Reassigning a sub-order moves earnings from one seller to another
  // and bypasses the normal routing engine. SUPER_ADMIN only.
  @Post('orders/:subOrderId/reassign')
  @Roles('SUPER_ADMIN')
  async reassignSubOrder(
    @Param('subOrderId') subOrderId: string,
    @Body() body: { sellerId: string },
  ) {
    const data = await this.operationsService.reassignSubOrder(subOrderId, body.sellerId);
    return { success: true, message: 'Sub-order reassigned', data };
  }

  // ── T7: Seller mapping suspension ───────────────────────────────────────

  // Suspend/activate of a seller's full catalog is an operational
  // seller-account action on par with delete/impersonate — allow
  // SUPER_ADMIN and SELLER_ADMIN (same tier as those).
  @Post('sellers/:sellerId/suspend-mappings')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  async suspendMappings(@Param('sellerId') sellerId: string) {
    const data = await this.operationsService.suspendSellerMappings(sellerId);
    return { success: true, message: 'Seller mappings suspended', data };
  }

  @Post('sellers/:sellerId/activate-mappings')
  @Roles('SUPER_ADMIN', 'SELLER_ADMIN')
  async activateMappings(@Param('sellerId') sellerId: string) {
    const data = await this.operationsService.activateSellerMappings(sellerId);
    return { success: true, message: 'Seller mappings activated', data };
  }
}
