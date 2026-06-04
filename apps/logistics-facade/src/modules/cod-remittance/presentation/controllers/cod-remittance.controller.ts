import {
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
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';

@ApiTags('COD Remittance')
@RequireApiKey()
@Controller({ path: 'cod/remittance' })
export class CodRemittanceController {
  @Get()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'List COD remittances with filters.' })
  @ApiQuery({ name: 'partner', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date (inclusive).' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date (exclusive).' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M3.' })
  list(
    @Query('partner') _partner?: string,
    @Query('from') _from?: string,
    @Query('to') _to?: string,
  ) {
    throw new NotImplementedException('Stub — implement in M3');
  }

  @Post('pull/:partner')
  @Idempotent()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Manually trigger a remittance pull for one partner.',
    description:
      'Cron lives in `application/crons/pull-remittance.cron.ts`. This endpoint is the ops escape hatch.',
  })
  @ApiParam({ name: 'partner', description: 'Canonical partner code (uppercase).' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M3.' })
  pull(@Param('partner') _partner: string) {
    throw new NotImplementedException('Stub — implement in M3');
  }
}
