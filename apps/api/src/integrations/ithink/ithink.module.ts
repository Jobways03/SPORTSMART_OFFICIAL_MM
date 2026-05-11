import { Module } from '@nestjs/common';

import { EnvModule } from '../../bootstrap/env/env.module';

import { IThinkClient } from './clients/ithink.client';
import { IThinkConfig } from './config/ithink.config';
import { IThinkOrderService } from './services/ithink-order.service';
import { IThinkTrackingService } from './services/ithink-tracking.service';
import { IThinkShippingDocsService } from './services/ithink-shipping-docs.service';
import { IThinkRatesService } from './services/ithink-rates.service';
import { IThinkWarehouseService } from './services/ithink-warehouse.service';
import { IThinkRemittanceService } from './services/ithink-remittance.service';
import { IThinkNdrService } from './services/ithink-ndr.service';

/**
 * iThink Logistics integration module.
 *
 * Exports every service so consumers (shipping adapter, returns module,
 * settlements reconciliation cron) can inject just the slice they need
 * rather than dragging in the whole client surface.
 *
 * The module is platform-side (not domain-side): it knows about iThink
 * wire shapes but nothing about MasterOrder/SubOrder/Shipment etc.
 * Domain modules consume these services via mappers and the adapter.
 */
@Module({
  imports: [EnvModule],
  providers: [
    IThinkConfig,
    IThinkClient,
    IThinkOrderService,
    IThinkTrackingService,
    IThinkShippingDocsService,
    IThinkRatesService,
    IThinkWarehouseService,
    IThinkRemittanceService,
    IThinkNdrService,
  ],
  exports: [
    IThinkConfig,
    IThinkClient,
    IThinkOrderService,
    IThinkTrackingService,
    IThinkShippingDocsService,
    IThinkRatesService,
    IThinkWarehouseService,
    IThinkRemittanceService,
    IThinkNdrService,
  ],
})
export class IThinkModule {}
