import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { CodRuleKind } from '@prisma/client';
import { AdminAuthGuard, AnyAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { CodRuleEngine } from '../../application/services/cod-rule-engine.service';

interface CreateRuleDto {
  kind: CodRuleKind;
  priority?: number;
  conditions: any;
  active?: boolean;
  description?: string;
}

@ApiTags('COD — Admin')
@Controller('admin/cod/rules')
@UseGuards(AdminAuthGuard)
export class AdminCodRulesController {
  constructor(private readonly engine: CodRuleEngine) {}

  @Get()
  async list() {
    const data = await this.engine.listRules();
    return { success: true, message: 'Rules', data };
  }

  @Post()
  async create(@Body() body: CreateRuleDto) {
    if (!body?.kind || !body?.conditions) {
      throw new BadRequestAppException('kind and conditions are required');
    }
    const data = await this.engine.createRule(body);
    return { success: true, message: 'Rule created', data };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<CreateRuleDto>) {
    const data = await this.engine.updateRule(id, body);
    return { success: true, message: 'Rule updated', data };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.engine.deleteRule(id);
    return { success: true, message: 'Rule deleted' };
  }

  @Get('decisions')
  async listDecisions(
    @Query('eligible') eligible?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.engine.listDecisions({
      eligible: eligible === 'true' ? true : eligible === 'false' ? false : undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return { success: true, message: 'Decisions', data };
  }
}

@ApiTags('COD — Public eval')
@Controller('cod')
@UseGuards(AnyAuthGuard)
export class CodEvaluateController {
  constructor(private readonly engine: CodRuleEngine) {}

  @Post('evaluate')
  async evaluate(@Body() body: {
    pincode: string;
    sellerId?: string;
    customerId?: string;
    orderTotalInr: number;
  }) {
    if (!body?.pincode || typeof body?.orderTotalInr !== 'number') {
      throw new BadRequestAppException('pincode + orderTotalInr are required');
    }
    const data = await this.engine.evaluate(body);
    return { success: true, message: 'COD evaluated', data };
  }
}
