import {
  Body,
  Controller,
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
import { NdrReattemptRequest } from '@sportsmart/logistics-contracts';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { ZodValidationPipe } from '../../../../core/pipes/zod-validation.pipe';

@ApiTags('NDR')
@RequireApiKey()
@Controller({ path: 'ndr' })
export class NdrController {
  @Post(':shipmentId/action')
  @Idempotent()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Submit a customer-side action on a non-delivery attempt.',
    description:
      'Schedules a reattempt, reschedules to a new address, requests hold-at-hub, or escalates to RTO. Forwards to the partner adapter on success.',
  })
  @ApiParam({ name: 'shipmentId', description: 'Shipment id (UUID).' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M2.' })
  @UsePipes(new ZodValidationPipe(NdrReattemptRequest))
  submit(
    @Param('shipmentId') _shipmentId: string,
    @Body() _body: NdrReattemptRequest,
  ) {
    throw new NotImplementedException('Stub — implement in M2');
  }
}
