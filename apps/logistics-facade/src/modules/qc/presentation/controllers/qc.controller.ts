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
import { CreateQcRecordRequest } from '@sportsmart/logistics-contracts';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { ZodValidationPipe } from '../../../../core/pipes/zod-validation.pipe';

@ApiTags('QC')
@RequireApiKey()
@Controller({ path: 'qc' })
export class QcController {
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'Record the warehouse QC outcome for a returned parcel.' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M2.' })
  @UsePipes(new ZodValidationPipe(CreateQcRecordRequest))
  create(@Body() _body: CreateQcRecordRequest) {
    throw new NotImplementedException('Stub — implement in M2');
  }

  @Get(':id')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'Fetch a QC record by id.' })
  @ApiParam({ name: 'id', description: 'QC record id (UUID).' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M2.' })
  findOne(@Param('id') _id: string) {
    throw new NotImplementedException('Stub — implement in M2');
  }
}
