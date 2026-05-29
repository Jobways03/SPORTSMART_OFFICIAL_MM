import { Injectable, Logger } from '@nestjs/common';
import { AdminDashboardService } from '../services/admin-dashboard.service';
import { AdminOperationsService } from '../services/admin-operations.service';
import { OrdersService } from '../../../orders/application/services/orders.service';

@Injectable()
export class AdminControlTowerPublicFacade {
  private readonly logger = new Logger(AdminControlTowerPublicFacade.name);

  constructor(
    private readonly dashboardService: AdminDashboardService,
    private readonly operationsService: AdminOperationsService,
    // Phase 78 (2026-05-22) — reassign audit Gap #6. The facade's
    // `reassign-sub-order` action used to invoke the legacy
    // AdminOperationsService.reassignSubOrder. That path is removed
    // in Phase 78; the canonical endpoint now lives on OrdersService.
    // The facade routes here to keep programmatic callers working.
    private readonly ordersService: OrdersService,
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
   *
   * Phase 59 (2026-05-22) — suspend/activate now require adminId
   * + reason (audit Gaps #3 + #5). Callers supply them via the
   * params object; missing reason falls back to a generic stub so
   * the facade stays backwards-compatible for non-controller
   * callers but the audit log still flags the missing context.
   */
  async invokeOverrideAction(
    action: string,
    targetId: string,
    params: unknown,
  ): Promise<void> {
    const p = (params ?? {}) as {
      newSellerId?: string;
      nodeType?: 'SELLER' | 'FRANCHISE';
      nodeId?: string;
      adminId?: string;
      reason?: string;
      force?: boolean;
    };
    switch (action) {
      case 'suspend-mappings':
        await this.operationsService.suspendSellerMappings(
          targetId,
          p.adminId,
          p.reason ?? 'Programmatic invocation (no reason supplied)',
        );
        break;

      case 'activate-mappings':
        await this.operationsService.activateSellerMappings(
          targetId,
          p.adminId,
          p.reason ?? 'Programmatic invocation (no reason supplied)',
        );
        break;

      case 'reassign-sub-order':
        // Phase 78 — route through the canonical OrdersService path so
        // every reassignment (UI, control-tower facade, programmatic)
        // shares the same atomic transaction + audit log + outbox event.
        if (!p.reason || p.reason.trim().length < 10) {
          throw new Error(
            'reassign-sub-order requires a reason (min 10 chars)',
          );
        }
        await this.ordersService.reassignSubOrder(
          targetId,
          p.nodeType && p.nodeId
            ? { nodeType: p.nodeType, nodeId: p.nodeId }
            : { nodeType: 'SELLER', nodeId: p.newSellerId as string },
          p.reason,
          p.adminId,
          { force: !!p.force },
        );
        break;

      default:
        this.logger.warn(`Unknown override action: ${action}`);
    }
  }
}
