import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../core/guards';
import { Permissions } from '../../core/decorators/permissions.decorator';
import {
  CreateSportEventInput,
  MarketingService,
  UpdateSportEventInput,
} from './marketing.service';

@ApiTags('Admin Events')
@Controller('admin/events')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminEventsController {
  constructor(private readonly service: MarketingService) {}

  @Get()
  @Permissions('content.read')
  async list(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const data = await this.service.adminListEvents({
      page: pageNum,
      limit: limitNum,
    });
    return { success: true, message: 'Events', data };
  }

  @Get(':id')
  @Permissions('content.read')
  async getOne(@Param('id') id: string) {
    const event = await this.service.adminGetEvent(id);
    return { success: true, message: 'Event', data: event };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('content.write')
  async create(@Body() body: CreateSportEventInput) {
    const event = await this.service.createEvent(body);
    return { success: true, message: 'Event created', data: event };
  }

  @Patch(':id')
  @Permissions('content.write')
  async update(@Param('id') id: string, @Body() body: UpdateSportEventInput) {
    const event = await this.service.updateEvent(id, body);
    return { success: true, message: 'Event updated', data: event };
  }

  @Delete(':id')
  @Permissions('content.write')
  async remove(@Param('id') id: string) {
    await this.service.deleteEvent(id);
    return { success: true, message: 'Event deleted' };
  }
}
