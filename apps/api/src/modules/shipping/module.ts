import { Module, forwardRef } from '@nestjs/common';

import {
  AdminAuthGuard,
  PermissionsGuard,
  SellerAuthGuard,
  FranchiseAuthGuard,
  FranchiseActiveGuard,
} from '../../core/guards';
import { OrdersModule } from '../orders/module';
// Phase 85 (2026-05-23) — TaxModule wired so the manual AWB attach
// path can fire the same `generateInvoiceForSubOrder` hook the
// seller path uses. forwardRef breaks the Tax → Checkout → Orders →
// Shipping → Tax cycle.
import { TaxModule } from '../tax/module';
import { LogisticsFacadeModule } from '../../integrations/logistics-facade/logistics-facade.module';

import { ShippingPublicFacade } from './application/facades/shipping-public.facade';
import { IngestTrackingUpdateUseCase } from './application/use-cases/ingest-tracking-update.use-case';
// Phase 86 (2026-05-23) — Gap #2/#3/#18. Internal shipment state
// machine. Replaces the 1-line `UshipmentUstateService` stub.
import { ShipmentStateService } from './application/services/shipment-state.service';
// Phase 87 (2026-05-23) — NDR/RTO Gap #1. Real NDR/RTO service
// (was a 1-line stub). Handles admin/customer NDR actions +
// admin force-RTO + auto-RTO threshold trigger.
import { NdrRtoService } from './application/services/ndr-rto.service';
// Phase 88 (2026-05-23) — ShipmentEvidenceService is exported by
// OrdersModule (which ShippingModule already imports). The IngestTracking
// use-case consumes it for POD capture via dependency injection
// without redeclaring the provider here.
// Phase 87 — Gap #12 notification handlers (NDR_RAISED + RTO_*
// emails) live in shipment-notification.handler.ts.
import { ShipmentNotificationHandler } from './application/event-handlers/shipment-notification.handler';
import { ShipmentAuditHandler } from './application/event-handlers/shipment-audit.handler';
// Phase 87 — Gap #7/#8. Refund + stock-restore on RTO_DELIVERED.
import { RtoSideEffectsHandler } from './application/event-handlers/rto-side-effects.handler';
// Phase 3 Delhivery wiring (2026-06-02) — auto-book Delhivery + attach
// AWB when a DELHIVERY sub-order is marked PACKED.
import { DelhiveryAutoBookHandler } from './application/event-handlers/delhivery-auto-book.handler';
import { ReturnReverseAutoBookHandler } from './application/event-handlers/return-reverse-auto-book.handler';
// Phase 3 Delhivery wiring (2026-06-02) — cancel the Delhivery shipment
// when a sub-order with an AWB is cancelled by admin.
import { DelhiveryCancelHandler } from './application/event-handlers/delhivery-cancel.handler';
// Phase 88 (2026-05-23) — Gap #9 retention sweep.
import { ShipmentEvidenceRetentionCron } from './infrastructure/crons/shipment-evidence-retention.cron';
import { shippingProviders } from './infrastructure/providers/shipping.providers';
import { AdminShippingController } from './presentation/controllers/admin-shipping.controller';
import { TrackingWebhookController } from './presentation/controllers/tracking-webhook.controller';
// Phase 87 — Gap #14. Customer NDR-action + admin force-RTO endpoints.
import { CustomerNdrController } from './presentation/controllers/customer-ndr.controller';
import { AdminRtoController } from './presentation/controllers/admin-rto.controller';
// Phase 4 Delhivery wiring (2026-06-02) — admin surface for serviceability /
// cost / TAT / waybill / pickup / shipment-edit / e-waybill (→ facade).
import { AdminDelhiveryController } from './presentation/controllers/admin-delhivery.controller';
import { DelhiveryToolsService } from './application/services/delhivery-tools.service';
// Phase 4 — PUBLIC storefront delivery-availability (pincode serviceability).
import { PublicDeliveryController } from './presentation/controllers/public-delivery.controller';
// Phase 92 (2026-06-03) — seller/franchise self-service pickup (portals).
import { SellerShippingController } from './presentation/controllers/seller-shipping.controller';
import { FranchiseShippingController } from './presentation/controllers/franchise-shipping.controller';
// 2026-06-04 — our own 4x6 shipping label (PDF) + its public signed-token route.
import { ShippingLabelPdfService } from './application/services/shipping-label-pdf.service';
import { PublicShippingLabelController } from './presentation/controllers/public-shipping-label.controller';

@Module({
  imports: [OrdersModule, forwardRef(() => TaxModule), LogisticsFacadeModule],
  controllers: [
    TrackingWebhookController,
    AdminShippingController,
    CustomerNdrController,
    AdminRtoController,
    AdminDelhiveryController,
    PublicDeliveryController,
    SellerShippingController,
    FranchiseShippingController,
    PublicShippingLabelController,
  ],
  providers: [
    AdminAuthGuard,
    // Phase 85 — PermissionsGuard explicitly registered so the
    // per-endpoint @Permissions decorators on AdminShippingController
    // resolve without relying on global module discovery.
    PermissionsGuard,
    // Phase 92 — seller/franchise auth guards for the portal pickup routes.
    SellerAuthGuard,
    FranchiseAuthGuard,
    FranchiseActiveGuard,
    ShippingPublicFacade,
    ShippingLabelPdfService,
    IngestTrackingUpdateUseCase,
    ShipmentStateService,
    NdrRtoService,
    DelhiveryToolsService,
    // Event handlers must be in providers for Nest's @OnEvent
    // listeners to register. The shipment-* handlers were already
    // wired implicitly; Phase 87 makes them explicit.
    ShipmentNotificationHandler,
    ShipmentAuditHandler,
    RtoSideEffectsHandler,
    DelhiveryAutoBookHandler,
    ReturnReverseAutoBookHandler,
    DelhiveryCancelHandler,
    ShipmentEvidenceRetentionCron,
    ...shippingProviders,
  ],
  exports: [
    ShippingPublicFacade,
    IngestTrackingUpdateUseCase,
    NdrRtoService,
    ...shippingProviders,
  ],
})
export class ShippingModule {}
