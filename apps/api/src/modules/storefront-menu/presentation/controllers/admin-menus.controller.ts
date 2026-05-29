import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { StorefrontMenuService } from '../../services/menu.service';
import { MenuAuditService } from '../../services/menu-audit.service';
import {
  CreateItemDto,
  CreateMenuDto,
  ReorderItemsDto,
  UpdateItemDto,
  UpdateMenuDto,
} from '../../dtos/menu.dto';

const ok = <T>(data: T, message = 'OK') => ({ success: true, message, data });

/**
 * Phase 48 (2026-05-21) — RBAC granularity. Pre-Phase-48 the class
 * carried `@Permissions('storefront.write')` so even GET routes
 * required write access; reporting / oncall admins with read-only
 * roles got 403. Split per-method so GETs use `storefront.read` and
 * mutations use `storefront.write`.
 */
@ApiTags('Admin — Storefront Menus')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/storefront/menus')
export class AdminMenusController {
  constructor(
    private readonly service: StorefrontMenuService,
    private readonly audit: MenuAuditService,
  ) {}

  @Get()
  @Permissions('storefront.read')
  async list() {
    const menus = await this.service.listMenus();
    return ok(menus, 'Menus listed');
  }

  @Get(':id')
  @Permissions('storefront.read')
  async get(@Param('id') id: string) {
    const menu = await this.service.getMenuById(id);
    return ok(menu, 'Menu retrieved');
  }

  @Post()
  @Permissions('storefront.write')
  @Idempotent()
  async create(@Body() dto: CreateMenuDto, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    const menu = await this.service.createMenu(dto, actorId);
    return ok(menu, 'Menu created');
  }

  @Patch(':id')
  @Permissions('storefront.write')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMenuDto,
    @Req() req: Request,
  ) {
    const actorId = (req as any).adminId as string | undefined;
    const menu = await this.service.updateMenu(id, dto, actorId);
    return ok(menu, 'Menu updated');
  }

  @Delete(':id')
  @Permissions('storefront.write')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() req: Request) {
    const actorId = (req as any).adminId as string | undefined;
    await this.service.deleteMenu(id, actorId);
  }

  @Post(':id/items')
  @Permissions('storefront.write')
  @Idempotent()
  async addItem(
    @Param('id') id: string,
    @Body() dto: CreateItemDto,
    @Req() req: Request,
  ) {
    const actorId = (req as any).adminId as string | undefined;
    const item = await this.service.createItem(id, dto, actorId);
    return ok(item, 'Item added');
  }

  @Patch(':id/items/:itemId')
  @Permissions('storefront.write')
  async updateItem(
    @Param('id') _id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemDto,
    @Req() req: Request,
  ) {
    const actorId = (req as any).adminId as string | undefined;
    const item = await this.service.updateItem(itemId, dto, actorId);
    return ok(item, 'Item updated');
  }

  @Delete(':id/items/:itemId')
  @Permissions('storefront.write')
  @HttpCode(204)
  async deleteItem(
    @Param('id') _id: string,
    @Param('itemId') itemId: string,
    @Req() req: Request,
  ) {
    const actorId = (req as any).adminId as string | undefined;
    await this.service.deleteItem(itemId, actorId);
  }

  @Post(':id/items/reorder')
  @Permissions('storefront.write')
  async reorder(
    @Param('id') id: string,
    @Body() dto: ReorderItemsDto,
    @Req() req: Request,
  ) {
    const actorId = (req as any).adminId as string | undefined;
    const tree = await this.service.reorderItems(id, dto.moves, actorId);
    return ok(tree, 'Items reordered');
  }

  /**
   * Phase 48 — per-menu audit history. Marketing / compliance can
   * answer "what changed in main-menu last week" without trawling
   * app logs.
   */
  @Get(':id/history')
  @Permissions('storefront.read')
  async menuHistory(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const entries = await this.audit.list('MENU', id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return ok(entries, 'Menu audit log');
  }

  @Get(':id/items/:itemId/history')
  @Permissions('storefront.read')
  async itemHistory(
    @Param('id') _id: string,
    @Param('itemId') itemId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const entries = await this.audit.list('MENU_ITEM', itemId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return ok(entries, 'Menu item audit log');
  }
}
