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
import { AdminAuthGuard } from '../../../../core/guards';
import { AdminDashboardService } from '../../application/services/admin-dashboard.service';
import { AdminOperationsService, BulkPricingUpdate } from '../../application/services/admin-operations.service';

@ApiTags('Admin Control Tower')
@Controller('admin')
@UseGuards(AdminAuthGuard)
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

  @Patch('products/bulk-pricing')
  async bulkUpdatePricing(
    @Body() body: { updates: BulkPricingUpdate[] },
  ) {
    const data = await this.operationsService.bulkUpdatePricing(body.updates);
    return { success: true, message: 'Bulk pricing update completed', data };
  }

  // ── T6: Override allocation (reassign sub-order) ────────────────────────

  @Post('orders/:subOrderId/reassign')
  async reassignSubOrder(
    @Param('subOrderId') subOrderId: string,
    @Body() body: { sellerId: string },
  ) {
    const data = await this.operationsService.reassignSubOrder(subOrderId, body.sellerId);
    return { success: true, message: 'Sub-order reassigned', data };
  }

  // ── T7: Seller mapping suspension ───────────────────────────────────────

  @Post('sellers/:sellerId/suspend-mappings')
  async suspendMappings(@Param('sellerId') sellerId: string) {
    const data = await this.operationsService.suspendSellerMappings(sellerId);
    return { success: true, message: 'Seller mappings suspended', data };
  }

  @Post('sellers/:sellerId/activate-mappings')
  async activateMappings(@Param('sellerId') sellerId: string) {
    const data = await this.operationsService.activateSellerMappings(sellerId);
    return { success: true, message: 'Seller mappings activated', data };
  }
}
