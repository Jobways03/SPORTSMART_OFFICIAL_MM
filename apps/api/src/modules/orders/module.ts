import { Module, forwardRef } from '@nestjs/common';
import { AdminOrdersController } from './presentation/controllers/admin-orders.controller';
import { AdminRoutingController } from './presentation/controllers/admin-routing.controller';
import { AdminVerificationController } from './presentation/controllers/admin-verification.controller';
import { SellerOrdersController } from './presentation/controllers/seller-orders.controller';
import { SellerShipmentEvidenceController } from './presentation/controllers/seller-shipment-evidence.controller';
import { FranchiseShipmentEvidenceController } from './presentation/controllers/franchise-shipment-evidence.controller';
import { AdminShipmentEvidenceController } from './presentation/controllers/admin-shipment-evidence.controller';
import { CustomerOrdersController } from './presentation/controllers/customer-orders.controller';
import { OrdersService } from './application/services/orders.service';
// Phase 80 (2026-05-22) — acceptance audit Gap #2. The legacy
// OrderTimeoutService (5min cron with a different Redis lock key)
// was deleted because it competed with OrderAcceptanceSlaProcessor
// on the same expired-sub-order rows. The Phase 80 processor below
// is now the sole acceptance-expiry cron.
import { OrderAcceptanceSlaProcessor } from './application/services/order-acceptance-sla.processor';
import { RoutingHealthService } from './application/services/routing-health.service';
import { StockRestoreService } from './application/services/stock-restore.service';
import { VerificationQueueService } from './application/services/verification-queue.service';
import { RiskScoringService } from './application/services/risk-scoring.service';
// Phase 72 (2026-05-22) — Phase 71 risk audit Gap #12. DB-driven
// rule weights/thresholds.
import { RiskRuleConfigService } from './application/services/risk-rule-config.service';
// Phase 71 (2026-05-22) — Phase 70 audit Gap #3. Scores orders at
// placement via the orders.master.created event subscriber. Without
// this handler the only scoring triggers were lazy (claim-next /
// detail-view), so the bulk-approve-green sweep returned empty
// because most orders had a null band.
import { OrderRiskScoringHandler } from './application/event-handlers/order-risk-scoring.handler';
// Phase 73 (2026-05-22) — claim-flow audit Gap #4. Proactive
// auto-release of expired verification claims; pre-Phase-73 stale
// claim columns accumulated forever.
import { VerificationClaimExpiryCron } from './application/jobs/verification-claim-expiry.cron';
// Phase 84 (2026-05-23) — order timeline / status history.
// Single recorder for every status-transition event.
import { OrderTimelineService } from './application/services/order-timeline.service';
import { OrdersPublicFacade } from './application/facades/orders-public.facade';
import { PrismaOrderRepository } from './infrastructure/repositories/prisma-order.repository';
import { ORDER_REPOSITORY } from './domain/repositories/order.repository.interface';
import { AdminAuthGuard, SellerAuthGuard, UserAuthGuard, PermissionsGuard, RolesGuard, StepUpGuard } from '../../core/guards';
import { CatalogModule } from '../catalog/module';
import { FranchiseModule } from '../franchise/module';
import { MoneyModule } from '../../core/money/money.module';
import { TaxModule } from '../tax/module';
// Phase 68 (2026-05-22) — audit Gap #11 + #1. The verification
// queue surface (controller + services + risk scoring) was built
// but never registered in any module — routes were silently absent
// from the running app. Phase 68 wires them in along with the
// AuditModule import OrdersService.verifyOrder + VerificationQueue
// approve/reject now depend on for the ORDER_VERIFIED /
// ORDER_REJECTED audit log rows.
import { AuditModule } from '../audit/module';
// Wallet refund on full-master cancel (OrdersService injects WalletPublicFacade).
// WalletModule imports only Razorpay + Audit, so no cycle back to Orders.
import { WalletModule } from '../wallet/module';
// Phase 88 (2026-05-23) — Shipment Evidence Flow. Local provider so
// the orders module's controllers + orders.service.ts can call the
// typed-evidence orchestrator without creating an import cycle with
// ShippingModule (which already imports OrdersModule).
import { ShipmentEvidenceService } from '../shipping/application/services/shipment-evidence.service';

@Module({
  // Tax-centric cycle break (Tax → Checkout → ... → Orders chain).
  // Phase 82 (2026-05-23) — FranchiseModule via forwardRef because
  // franchise-orders.service.ts now injects OrdersService for the
  // unified fulfillment writer.
  imports: [
    forwardRef(() => CatalogModule),
    forwardRef(() => FranchiseModule),
    MoneyModule,
    forwardRef(() => TaxModule),
    AuditModule,
    WalletModule,
  ],
  controllers: [
    AdminOrdersController,
    AdminRoutingController,
    AdminVerificationController,
    SellerOrdersController,
    SellerShipmentEvidenceController,
    FranchiseShipmentEvidenceController,
    AdminShipmentEvidenceController,
    CustomerOrdersController,
  ],
  providers: [
    AdminAuthGuard,
    SellerAuthGuard,
    UserAuthGuard,
    // Phase 68 — guards explicitly registered so the verification
    // controller's @UseGuards chain resolves them without relying
    // on global module discovery (PermissionsGuard, RolesGuard,
    // StepUpGuard live in the core/guards barrel).
    PermissionsGuard,
    RolesGuard,
    StepUpGuard,
    OrdersService,
    OrderAcceptanceSlaProcessor,
    RoutingHealthService,
    StockRestoreService,
    VerificationQueueService,
    RiskScoringService,
    RiskRuleConfigService,
    OrderRiskScoringHandler,
    VerificationClaimExpiryCron,
    OrderTimelineService,
    OrdersPublicFacade,
    ShipmentEvidenceService,
    {
      provide: ORDER_REPOSITORY,
      useClass: PrismaOrderRepository,
    },
  ],
  exports: [
    OrdersPublicFacade,
    // Phase 78 (2026-05-22) — reassign Gap #6. The control-tower
    // facade routes its `reassign-sub-order` action through
    // OrdersService.reassignSubOrder so all reassignment writers
    // share a single canonical implementation. Adding this export
    // lets the admin-control-tower module inject it directly.
    OrdersService,
    // Phase 84 (2026-05-23) — exposed so cross-module writers (refund,
    // commission, payments) can record their own timeline events
    // without owning a copy of the recorder logic.
    OrderTimelineService,
    // Phase 88 (2026-05-23) — exported so ShippingModule's webhook
    // POD capture path can consume the typed-evidence orchestrator.
    ShipmentEvidenceService,
    // Exported so ShippingModule's RtoSideEffectsHandler (and CheckoutModule)
    // can inject the canonical stock-restore writer instead of owning a copy.
    StockRestoreService,
  ],
})
export class OrdersModule {}
