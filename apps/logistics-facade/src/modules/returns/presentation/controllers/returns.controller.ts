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
import { CreateReturnRequest } from '@sportsmart/logistics-contracts';
import { RequireApiKey } from '../../../../core/api-keys/require-api-key.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { ZodValidationPipe } from '../../../../core/pipes/zod-validation.pipe';

@ApiTags('Returns')
@RequireApiKey()
@Controller({ path: 'returns' })
export class ReturnsController {
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'Schedule a reverse pickup for a delivered order.' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M2.' })
  @UsePipes(new ZodValidationPipe(CreateReturnRequest))
  create(@Body() _body: CreateReturnRequest) {
    throw new NotImplementedException('Stub — implement in M2');
  }

  @Get(':id')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({ summary: 'Fetch a return by id.' })
  @ApiParam({ name: 'id', description: 'Return id (UUID).' })
  @ApiResponse({ status: 501, description: 'Stub — implementation lands in M2.' })
  findOne(@Param('id') _id: string) {
    throw new NotImplementedException('Stub — implement in M2');
  }
}
