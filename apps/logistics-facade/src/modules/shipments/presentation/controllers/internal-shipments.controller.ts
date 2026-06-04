import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  Post,
  UsePipes,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CancelShipmentRequest,
  CreateShipmentRequest,
} from '@sportsmart/logistics-contracts';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { ZodValidationPipe } from '../../../../core/pipes/zod-validation.pipe';
import { CreateShipmentService } from '../../application/services/create-shipment.service';
// Phase 3 Delhivery wiring (2026-06-02) — stateless, AWB-keyed carrier actions.
import { CarrierActionsService } from '../../application/services/carrier-actions.service';

/**
 * Internal shipment surface. Apps/api hits these routes to book,
 * cancel, and look up shipments. All routes are ApiKey-protected.
 *
 * Every handler is a stub for M0 — they throw NotImplementedException
 * so the contract is in place and partner integration can land in
 * M1 by filling in the services.
 */
@ApiTags('Internal — Shipments')
@RequireApiKey()
@Controller({ path: 'internal/shipments' })
export class InternalShipmentsController {
  constructor(
    private readonly createService: CreateShipmentService,
    private readonly carrierActions: CarrierActionsService,
  ) {}

  // ─── Phase 3 Delhivery wiring (2026-06-02) — stateless, AWB-keyed carrier
  // actions. Namespaced under `awb/:awb/...` so they never collide with the
  // legacy shipmentId-keyed `:id` / `:id/cancel` routes below (which stay 501
  // stubs because the facade create path is stateless / persists no row).

  @Get('awb/:awb/track')
  @ApiOperation({ summary: 'Tracking snapshot for one AWB (Delhivery).' })
  @ApiParam({ name: 'awb', description: 'Carrier AWB / waybill number.' })
  track(@Param('awb') awb: string) {
    return this.carrierActions.track(awb);
  }

  @Get('awb/:awb/label')
  @ApiOperation({ summary: 'Print/label PDF URL for an AWB (Delhivery).' })
  @ApiParam({ name: 'awb', description: 'Carrier AWB / waybill number.' })
  label(@Param('awb') awb: string) {
    return this.carrierActions.label(awb);
  }

  @Post('awb/:awb/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a Delhivery shipment by AWB (pre-pickup).' })
  @ApiParam({ name: 'awb', description: 'Carrier AWB / waybill number.' })
  cancelByAwb(@Param('awb') awb: string) {
    return this.carrierActions.cancel(awb);
  }

  @Post('awb/:awb/ndr-reattempt')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a Delhivery NDR re-attempt for an AWB.' })
  @ApiParam({ name: 'awb', description: 'Carrier AWB / waybill number.' })
  ndrReattempt(@Param('awb') awb: string) {
    return this.carrierActions.ndrReattempt(awb);
  }

  @Post('awb/:awb/rto')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate RTO for an AWB. Delhivery has no explicit RTO API; this aliases to cancel/auto-RTO.',
  })
  @ApiParam({ name: 'awb', description: 'Carrier AWB / waybill number.' })
  rto(@Param('awb') awb: string) {
    return this.carrierActions.rto(awb);
  }

  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Book a shipment with a courier partner.',
    description:
      'Resolves the partner adapter (default Delhivery; honours `partnerHint`), calls createShipment, and returns the AWB + label.',
  })
  @ApiResponse({
    status: 201,
    description: 'Shipment booked with the courier partner.',
  })
  @UsePipes(new ZodValidationPipe(CreateShipmentRequest))
  create(@Body() body: CreateShipmentRequest) {
    return this.createService.execute(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single shipment by id.' })
  @ApiParam({ name: 'id', description: 'Shipment id (UUID).' })
  @ApiResponse({
    status: 501,
    description: 'Stub — repository wiring lands in M1.',
  })
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  findOne(@Param('id') _id: string) {
    throw new NotImplementedException('Stub — implement in M1');
  }

  @Post(':id/cancel')
  @Idempotent()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Cancel a shipment (pre-pickup only).',
    description:
      'Pre-pickup statuses are cancellable; post-pickup goes through the RTO flow.',
  })
  @ApiParam({ name: 'id', description: 'Shipment id (UUID).' })
  @ApiResponse({ status: 501, description: 'Stub — cancellation flow lands in M1.' })
  @UsePipes(new ZodValidationPipe(CancelShipmentRequest))
  cancel(@Param('id') _id: string, @Body() _body: CancelShipmentRequest) {
    throw new NotImplementedException('Stub — implement in M1');
  }

  /**
   * Smoke-test fixture. Always 501. Lets the e2e suite assert the
   * "auth-required, stubbed-out" contract without needing a real
   * shipment row OR a valid CreateShipmentRequest body. Remove on
   * M1 cleanup PR.
   */
  @Get('dummy')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'M0 smoke route — always 501, used by the facade e2e suite.',
  })
  @ApiResponse({
    status: 501,
    description: 'Stub by design — proves the auth + stub contract.',
  })
  dummy() {
    throw new NotImplementedException('Stub — implement in M1');
  }
}
