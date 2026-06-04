import { Module } from '@nestjs/common';
import { EnvService } from '../../bootstrap/env/env.service';
import { LogisticsFacadeClient } from './clients/logistics-facade.client';
import { LogisticsFacadePartnersService } from './services/logistics-facade-partners.service';
import { LOGISTICS_FACADE_CONFIG } from './logistics-facade.constants';
import { loadLogisticsFacadeConfig } from './config/logistics-facade.config';

/**
 * apps/api integration for the logistics-facade. Provides:
 *   • LogisticsFacadeClient — HTTP transport with retry + ApiKey auth.
 *   • LogisticsFacadePartnersService — typed wrappers for the facade's
 *     `v1/partners` endpoints (used by LogisticsPartnerModule).
 *
 * The config is parsed lazily from process.env (mirrors the Delhivery
 * + Razorpay modules) so apps/api still boots in environments where
 * the facade URL is unset — callers that try to use the service will
 * fail at request time, not at startup.
 */
@Module({
  providers: [
    {
      provide: LOGISTICS_FACADE_CONFIG,
      useFactory: (env: EnvService) => {
        void env;
        return loadLogisticsFacadeConfig(process.env);
      },
      inject: [EnvService],
    },
    LogisticsFacadeClient,
    LogisticsFacadePartnersService,
  ],
  exports: [LogisticsFacadePartnersService, LogisticsFacadeClient],
})
export class LogisticsFacadeModule {}
