import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../core/guards';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import {
  StorefrontSlotsService,
  CreateSlotInput,
} from './storefront-slots.service';

@ApiTags('Admin Storefront Slots')
@Controller('admin/storefront-slots')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminStorefrontSlotsController {
  constructor(private readonly service: StorefrontSlotsService) {}

  @Get()
  @Permissions('content.read')
  async list() {
    return {
      success: true,
      message: 'Storefront slot definitions',
      data: { items: await this.service.list() },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('content.write')
  async create(@Body() body: CreateSlotInput) {
    const slot = await this.service.create(body);
    return { success: true, message: 'Slot created', data: slot };
  }

  @Delete(':id')
  @Permissions('content.write')
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { success: true, message: 'Slot deleted' };
  }
}
