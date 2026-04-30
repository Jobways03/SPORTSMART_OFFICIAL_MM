import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { StorefrontMenuService } from '../../services/menu.service';
import {
  CreateItemDto,
  CreateMenuDto,
  ReorderItemsDto,
  UpdateItemDto,
  UpdateMenuDto,
} from '../../dtos/menu.dto';

const ok = <T>(data: T, message = 'OK') => ({ success: true, message, data });

@ApiTags('Admin — Storefront Menus')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard)
@Controller('admin/storefront/menus')
export class AdminMenusController {
  constructor(private readonly service: StorefrontMenuService) {}

  @Get()
  async list() {
    const menus = await this.service.listMenus();
    return ok(menus, 'Menus listed');
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const menu = await this.service.getMenuById(id);
    return ok(menu, 'Menu retrieved');
  }

  @Post()
  async create(@Body() dto: CreateMenuDto) {
    const menu = await this.service.createMenu(dto);
    return ok(menu, 'Menu created');
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateMenuDto) {
    const menu = await this.service.updateMenu(id, dto);
    return ok(menu, 'Menu updated');
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.service.deleteMenu(id);
  }

  @Post(':id/items')
  async addItem(@Param('id') id: string, @Body() dto: CreateItemDto) {
    const item = await this.service.createItem(id, dto);
    return ok(item, 'Item added');
  }

  @Patch(':id/items/:itemId')
  async updateItem(
    @Param('id') _id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemDto,
  ) {
    const item = await this.service.updateItem(itemId, dto);
    return ok(item, 'Item updated');
  }

  @Delete(':id/items/:itemId')
  @HttpCode(204)
  async deleteItem(@Param('id') _id: string, @Param('itemId') itemId: string) {
    await this.service.deleteItem(itemId);
  }

  @Post(':id/items/reorder')
  async reorder(@Param('id') id: string, @Body() dto: ReorderItemsDto) {
    const tree = await this.service.reorderItems(id, dto.moves);
    return ok(tree, 'Items reordered');
  }
}
