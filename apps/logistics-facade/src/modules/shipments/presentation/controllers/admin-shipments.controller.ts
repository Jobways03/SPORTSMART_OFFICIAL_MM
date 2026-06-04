import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';

/**
 * Admin read-only views for the ops dashboard. The dashboard talks
 * to apps/api which proxies these calls in (the dashboard never hits
 * the facade directly — keeps the auth surface single).
 */
@ApiTags('Admin — Shipments')
@RequireApiKey()
@Controller({ path: 'admin/shipments' })
export class AdminShipmentsController {
  @Get()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'List shipments with filters.' })
  @ApiQuery({ name: 'orderId', required: false })
  @ApiQuery({ name: 'partner', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'awb', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiResponse({ status: 501, description: 'Stub — list query lands in M1.' })
  list(
    @Query('orderId') _orderId?: string,
    @Query('partner') _partner?: string,
    @Query('status') _status?: string,
    @Query('awb') _awb?: string,
    @Query('limit') _limit?: string,
    @Query('cursor') _cursor?: string,
  ) {
    throw new NotImplementedException('Stub — implement in M1');
  }

  @Get(':id')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'Fetch one shipment by id with the full event timeline.' })
  @ApiParam({ name: 'id', description: 'Shipment id (UUID).' })
  @ApiResponse({ status: 501, description: 'Stub — detail view lands in M1.' })
  findOne(@Param('id') _id: string) {
    throw new NotImplementedException('Stub — implement in M1');
  }
}
