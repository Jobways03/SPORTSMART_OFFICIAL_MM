import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';

@ApiTags('RTO')
@RequireApiKey()
@Controller({ path: 'rto' })
export class RtoController {
  @Get()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'List RTO attempts with filters.' })
  @ApiQuery({ name: 'partner', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M2.' })
  list(
    @Query('partner') _partner?: string,
    @Query('status') _status?: string,
    @Query('limit') _limit?: string,
  ) {
    throw new NotImplementedException('Stub — implement in M2');
  }

  @Post(':shipmentId/initiate')
  @Idempotent()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Manually initiate an RTO for a shipment.',
    description:
      'Ops-only escape hatch. The normal RTO flow is partner-initiated after delivery attempts exhaust.',
  })
  @ApiParam({ name: 'shipmentId', description: 'Shipment id (UUID).' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: { type: 'string', maxLength: 500 },
      },
    },
  })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M2.' })
  initiate(
    @Param('shipmentId') _shipmentId: string,
    @Body() _body: { reason: string },
  ) {
    throw new NotImplementedException('Stub — implement in M2');
  }
}
