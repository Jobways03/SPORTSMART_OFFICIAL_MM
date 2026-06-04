import { Module } from '@nestjs/common';
import { PartnersHelpersController } from './presentation/controllers/partners-helpers.controller';
import { PartnersController } from './presentation/controllers/partners.controller';
import { PartnersService } from './application/services/partners.service';
import { ShipmentsModule } from '../shipments/shipments.module';
import { DelhiveryModule } from '../../integrations/delhivery/delhivery.module';

/**
 * Partners module wires:
 *   • The legacy helper controller (serviceability / health — stubs
 *     pending M1 / M3).
 *   • The new `v1/partners` controller for capability discovery and
 *     warehouse registration (this is what apps/api proxies for the
 *     admin "Add pickup location to Delhivery" button).
 *
 * Imports ShipmentsModule (which itself re-exports DelhiveryModule
 * adapters via DefaultCourierGatewayResolver) AND DelhiveryModule
 * directly — the service needs `DelhiveryWarehouseService` which the
 * resolver does not surface.
 */
@Module({
  imports: [ShipmentsModule, DelhiveryModule],
  controllers: [PartnersHelpersController, PartnersController],
  providers: [PartnersService],
  exports: [PartnersService],
})
export class PartnersModule {}
