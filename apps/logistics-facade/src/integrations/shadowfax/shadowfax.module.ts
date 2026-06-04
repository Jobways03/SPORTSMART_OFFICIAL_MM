import { Module } from '@nestjs/common';
import { EnvService } from '../../bootstrap/env/env.service';
import { ShadowfaxClient } from './clients/shadowfax.client';
import { ShadowfaxOrderService } from './services/shadowfax-order.service';
import { ShadowfaxTrackingService } from './services/shadowfax-tracking.service';
import { ShadowfaxNdrService } from './services/shadowfax-ndr.service';
import { ShadowfaxRatesService } from './services/shadowfax-rates.service';
import { ShadowfaxLabelService } from './services/shadowfax-label.service';
import { ShadowfaxManifestService } from './services/shadowfax-manifest.service';
import { ShadowfaxRemittanceService } from './services/shadowfax-remittance.service';
import { ShadowfaxPickupService } from './services/shadowfax-pickup.service';
import { ShadowfaxCourierAdapter } from './adapters/shadowfax-courier.adapter';
import { SHADOWFAX_CONFIG } from './shadowfax.constants';
import { loadShadowfaxConfig } from './config/shadowfax.config';

/**
 * Wires the Shadowfax integration. Same shape as `DelhiveryModule`
 * with one extra provider — `ShadowfaxPickupService` — for the
 * on-demand pickup surface that has no Delhivery analogue.
 *
 * Imported by `modules/shipments/shipments.module.ts` so the
 * adapter is visible to `DefaultCourierGatewayResolver`.
 */
@Module({
  providers: [
    {
      provide: SHADOWFAX_CONFIG,
      useFactory: (env: EnvService) => {
        // Lazy parse — see DelhiveryModule for the same rationale.
        void env;
        return loadShadowfaxConfig(process.env);
      },
      inject: [EnvService],
    },
    ShadowfaxClient,
    ShadowfaxOrderService,
    ShadowfaxTrackingService,
    ShadowfaxNdrService,
    ShadowfaxRatesService,
    ShadowfaxLabelService,
    ShadowfaxManifestService,
    ShadowfaxRemittanceService,
    ShadowfaxPickupService,
    ShadowfaxCourierAdapter,
  ],
  exports: [ShadowfaxCourierAdapter],
})
export class ShadowfaxModule {}
