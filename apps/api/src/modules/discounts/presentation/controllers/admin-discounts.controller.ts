import { Controller, Get, Post, Put, Delete, Param, Query, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { DiscountsService } from '../../application/services/discounts.service';

@ApiTags('Admin Discounts')
@Controller('admin/discounts')
@UseGuards(AdminAuthGuard)
export class AdminDiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Query('page') page?: string, @Query('limit') limit?: string, @Query('status') status?: string, @Query('search') search?: string) {
    const data = await this.discountsService.list({
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50)),
      status, search,
    });
    return { success: true, message: 'Discounts retrieved', data };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async get(@Param('id') id: string) {
    const data = await this.discountsService.get(id);
    return { success: true, message: 'Discount retrieved', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: any) {
    const data = await this.discountsService.create(body);
    return { success: true, message: 'Discount created', data };
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async update(@Param('id') id: string, @Body() body: any) {
    const data = await this.discountsService.update(id, body);
    return { success: true, message: 'Discount updated', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Param('id') id: string) {
    await this.discountsService.delete(id);
    return { success: true, message: 'Discount deleted' };
  }
}
