import { Module } from '@nestjs/common';
import { InternalShipmentsController } from './presentation/controllers/internal-shipments.controller';
import { AdminShipmentsController } from './presentation/controllers/admin-shipments.controller';
import { DelhiveryToolsController } from './presentation/controllers/delhivery-tools.controller';
import { CreateShipmentService } from './application/services/create-shipment.service';
import { CarrierActionsService } from './application/services/carrier-actions.service';
import { DelhiveryToolsService } from './application/services/delhivery-tools.service';
import { CancelShipmentService } from './application/services/cancel-shipment.service';
import { GetShipmentService } from './application/services/get-shipment.service';
import { ShipmentRepository } from './infrastructure/repositories/shipment.repository';
import { DefaultCourierGatewayResolver } from './application/factories/courier-gateway.resolver';
import { DelhiveryModule } from '../../integrations/delhivery/delhivery.module';
import { ShadowfaxModule } from '../../integrations/shadowfax/shadowfax.module';

/**
 * Wires the shipments domain. Follows the apps/api discounts module
 * shape (presentation / application / infrastructure / domain).
 *
 * Imports every per-partner integration module so its adapter
 * provider is visible to `DefaultCourierGatewayResolver` for
 * constructor-injection. The dependency direction is intentional:
 *   • integrations expose only an Adapter that implements the port.
 *   • shipments depends on integrations.
 *   • the top-level `AppModule` composes shipments — it does NOT
 *     import the integration modules directly, which keeps
 *     "what carriers are wired in" a property of the shipments
 *     subgraph alone.
 */
@Module({
  imports: [DelhiveryModule, ShadowfaxModule],
  controllers: [
    InternalShipmentsController,
    AdminShipmentsController,
    DelhiveryToolsController,
  ],
  providers: [
    CreateShipmentService,
    CarrierActionsService,
    DelhiveryToolsService,
    CancelShipmentService,
    GetShipmentService,
    ShipmentRepository,
    DefaultCourierGatewayResolver,
  ],
  exports: [DefaultCourierGatewayResolver],
})
export class ShipmentsModule {}
