import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Param,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';

@ApiTags('Tracking')
@RequireApiKey()
@Controller({ path: 'shipments' })
export class TrackingController {
  @Get(':awb/timeline')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Fetch the partner-agnostic tracking timeline for an AWB.',
  })
  @ApiParam({
    name: 'awb',
    description: 'Air-Way-Bill number assigned by the carrier.',
  })
  @ApiResponse({
    status: 501,
    description: 'Stub — tracking ingestion lands in M1.',
  })
  timeline(@Param('awb') _awb: string) {
    throw new NotImplementedException('Stub — implement in M1');
  }
}
