import { Module } from '@nestjs/common';
import { EnvService } from '../../bootstrap/env/env.service';
import { DelhiveryClient } from './clients/delhivery.client';
import { DelhiveryOrderService } from './services/delhivery-order.service';
import { DelhiveryTrackingService } from './services/delhivery-tracking.service';
import { DelhiveryNdrService } from './services/delhivery-ndr.service';
import { DelhiveryRatesService } from './services/delhivery-rates.service';
import { DelhiveryLabelService } from './services/delhivery-label.service';
import { DelhiveryManifestService } from './services/delhivery-manifest.service';
import { DelhiveryRemittanceService } from './services/delhivery-remittance.service';
import { DelhiveryPickupService } from './services/delhivery-pickup.service';
import { DelhiveryWarehouseService } from './services/delhivery-warehouse.service';
import { DelhiveryWaybillService } from './services/delhivery-waybill.service';
import { DelhiveryCourierAdapter } from './adapters/delhivery-courier.adapter';
import { DELHIVERY_CONFIG } from './delhivery.constants';
import { loadDelhiveryConfig } from './config/delhivery.config';

/**
 * Wires the Delhivery integration:
 *   • Parses the partner-specific config slice via the EnvService.
 *   • Constructs the shared HTTP client + every service that
 *     consumes it.
 *   • Exposes the `CourierGatewayPort` implementation
 *     (`DelhiveryCourierAdapter`) + the individual services so
 *     other modules can call surfaces the port doesn't yet model
 *     (warehouse create/update, pickup-request, ewaybill update,
 *     RVP QC 3.0).
 *
 * Imported by `modules/shipments/shipments.module.ts` so the
 * adapter is visible to the `DefaultCourierGatewayResolver`.
 *
 * Pattern mirrors apps/api/src/integrations/ithink/ithink.module.ts.
 */
@Module({
  providers: [
    {
      provide: DELHIVERY_CONFIG,
      useFactory: (env: EnvService) => {
        // Lazy parse — only when this module is imported AND its
        // env vars are present. Local-dev environments without
        // partner secrets still boot the rest of the facade.
        void env;
        return loadDelhiveryConfig(process.env);
      },
      inject: [EnvService],
    },
    DelhiveryClient,
    DelhiveryOrderService,
    DelhiveryTrackingService,
    DelhiveryNdrService,
    DelhiveryRatesService,
    DelhiveryLabelService,
    DelhiveryManifestService,
    DelhiveryRemittanceService,
    DelhiveryPickupService,
    DelhiveryWarehouseService,
    DelhiveryWaybillService,
    DelhiveryCourierAdapter,
  ],
  exports: [
    DelhiveryCourierAdapter,
    DelhiveryOrderService,
    DelhiveryTrackingService,
    DelhiveryNdrService,
    DelhiveryRatesService,
    DelhiveryLabelService,
    DelhiveryPickupService,
    DelhiveryWarehouseService,
    DelhiveryWaybillService,
  ],
})
export class DelhiveryModule {}
