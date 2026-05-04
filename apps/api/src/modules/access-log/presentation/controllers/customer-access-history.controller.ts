import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import { AccessLogService } from '../../application/services/access-log.service';

@ApiTags('Customer Account')
@Controller('customer/account/access-history')
@UseGuards(UserAuthGuard)
export class CustomerAccessHistoryController {
  constructor(private readonly service: AccessLogService) {}

  @Get()
  async list(@Req() req: any, @Query('limit') limit?: string) {
    const items = await this.service.listForActor({
      actorType: 'CUSTOMER',
      actorId: req.userId,
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return { success: true, message: 'Access history retrieved', data: { items } };
  }
}
