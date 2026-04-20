import { Injectable, Logger } from '@nestjs/common';
import { AdminDashboardService } from '../services/admin-dashboard.service';
import { AdminOperationsService } from '../services/admin-operations.service';

@Injectable()
export class AdminControlTowerPublicFacade {
  private readonly logger = new Logger(AdminControlTowerPublicFacade.name);

  constructor(
    private readonly dashboardService: AdminDashboardService,
    private readonly operationsService: AdminOperationsService,
  ) {}

  /**
   * Get an operational read model by type (e.g. KPIs, seller performance, product performance).
   */
  async getOperationalReadModel(
    modelType: string,
    filters: Record<string, unknown>,
  ): Promise<unknown> {
    switch (modelType) {
      case 'kpis':
        return this.dashboardService.getKpis();

      case 'product-performance':
        return this.dashboardService.getProductPerformance(
          (filters.period as string) || '30d',
          Number(filters.limit) || 10,
        );

      case 'seller-performance':
        return this.dashboardService.getSellerPerformance();

      case 'allocation-analytics':
        return this.dashboardService.getAllocationAnalytics();

      default:
        this.logger.warn(`Unknown operational model type: ${modelType}`);
        return null;
    }
  }

  /**
   * Invoke an admin override action (e.g. bulk pricing, reassignment, suspension).
   */
  async invokeOverrideAction(
    action: string,
    targetId: string,
    params: unknown,
  ): Promise<void> {
    switch (action) {
      case 'suspend-mappings':
        await this.operationsService.suspendSellerMappings(targetId);
        break;

      case 'activate-mappings':
        await this.operationsService.activateSellerMappings(targetId);
        break;

      case 'reassign-sub-order':
        await this.operationsService.reassignSubOrder(
          targetId,
          (params as any).newSellerId,
        );
        break;

      default:
        this.logger.warn(`Unknown override action: ${action}`);
    }
  }
}
