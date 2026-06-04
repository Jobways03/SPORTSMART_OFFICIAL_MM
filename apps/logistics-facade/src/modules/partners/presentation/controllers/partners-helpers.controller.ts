import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';

@ApiTags('Partners')
@RequireApiKey()
@Controller({ path: 'partners' })
export class PartnersHelpersController {
  @Get('serviceability')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Multi-partner serviceability check for a pincode.',
    description:
      'Returns every registered partner that serves the pincode, with mode flags (prepaid/COD/reverse) and a health score for sorting.',
  })
  @ApiQuery({ name: 'pincode', description: '6-digit Indian pincode.' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M1.' })
  serviceability(@Query('pincode') _pincode: string) {
    throw new NotImplementedException('Stub — implement in M1');
  }

  @Get('health')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Rolling-window partner health metrics for a pincode.',
    description:
      'Reads from the PartnerHealth table populated by a cron that aggregates booking / pickup / RTO rates over the last 24h–7d window.',
  })
  @ApiQuery({ name: 'pincode', description: '6-digit Indian pincode.' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M3.' })
  health(@Query('pincode') _pincode: string) {
    throw new NotImplementedException('Stub — implement in M3');
  }
}
