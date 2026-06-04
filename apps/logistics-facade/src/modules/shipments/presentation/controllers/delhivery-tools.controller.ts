import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { DelhiveryToolsService } from '../../application/services/delhivery-tools.service';

/**
 * Phase 4 Delhivery wiring (2026-06-02) — internal HTTP surface for the
 * Delhivery capabilities that previously had client services but no route:
 * serviceability, heavy-serviceability, expected-TAT, shipping-cost,
 * fetch-waybill, raise-pickup, shipment-edit, e-waybill update.
 * All ApiKey-protected (apps/api calls these).
 */
@ApiTags('Internal — Delhivery Tools')
@RequireApiKey()
@Controller({ path: 'internal/delhivery' })
export class DelhiveryToolsController {
  constructor(private readonly tools: DelhiveryToolsService) {}

  @Get('serviceability/:pincode')
  @ApiOperation({ summary: 'Delhivery pincode serviceability (prepaid/COD/reverse).' })
  @ApiParam({ name: 'pincode', description: '6-digit destination pincode.' })
  serviceability(@Param('pincode') pincode: string) {
    return this.tools.serviceability(pincode);
  }

  @Get('serviceability/:pincode/heavy')
  @ApiOperation({ summary: 'Delhivery heavy-product serviceability.' })
  @ApiParam({ name: 'pincode', description: '6-digit destination pincode.' })
  heavyServiceability(@Param('pincode') pincode: string) {
    return this.tools.heavyServiceability(pincode);
  }

  @Get('tat')
  @ApiOperation({ summary: 'Expected TAT (delivery days) between two pincodes.' })
  expectedTat(
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('mot') mot: string,
    @Query('productType') productType?: string,
    @Query('expectedPickupDate') expectedPickupDate?: string,
  ) {
    return this.tools.expectedTat({
      originPincode: origin,
      destinationPincode: destination,
      mot: (mot || 'S') as never,
      productType: productType as never,
      expectedPickupDate,
    });
  }

  @Get('cost')
  @ApiOperation({ summary: 'Calculate a live Delhivery shipping cost quote.' })
  calculateCost(
    @Query('mode') mode: string,
    @Query('weightGrams') weightGrams: string,
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('paymentType') paymentType?: string,
    @Query('lengthCm') lengthCm?: string,
    @Query('breadthCm') breadthCm?: string,
    @Query('heightCm') heightCm?: string,
  ) {
    return this.tools.calculateCost({
      mode: (mode || 'S') as never,
      weightGrams: Number(weightGrams),
      originPincode: origin,
      destinationPincode: destination,
      paymentType: paymentType as never,
      lengthCm: lengthCm ? Number(lengthCm) : undefined,
      breadthCm: breadthCm ? Number(breadthCm) : undefined,
      heightCm: heightCm ? Number(heightCm) : undefined,
    });
  }

  @Get('waybill')
  @ApiOperation({ summary: 'Fetch (reserve) bulk Delhivery waybill numbers.' })
  fetchWaybills(@Query('count') count: string) {
    return this.tools.fetchWaybills(Number(count) || 1);
  }

  @Post('pickup')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Raise a Delhivery pickup request for a warehouse.' })
  raisePickup(
    @Body()
    body: {
      warehouseName: string;
      date: string;
      time: string;
      expectedPackageCount: number;
    },
  ) {
    return this.tools.raisePickup(body);
  }

  @Post('shipments/:awb/edit')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit a booked Delhivery shipment (address/COD/weight/dims).' })
  @ApiParam({ name: 'awb' })
  editShipment(@Param('awb') awb: string, @Body() changes: never) {
    return this.tools.editShipment(awb, changes);
  }

  @Post('shipments/:awb/ewaybill')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Attach/update the GST e-way bill for an AWB.' })
  @ApiParam({ name: 'awb' })
  updateEwaybill(
    @Param('awb') awb: string,
    @Body() body: { dcn: string; ewbn: string },
  ) {
    return this.tools.updateEwaybill(awb, body.dcn, body.ewbn);
  }
}
