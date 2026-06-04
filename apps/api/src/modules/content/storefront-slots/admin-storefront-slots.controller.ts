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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../core/guards';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { StorefrontSlotsService } from './storefront-slots.service';
import { ContentAuditService } from '../storefront-content/content-audit.service';
import {
  CreateSlotDto,
  UpdateSlotDto,
  ReorderSlotsDto,
} from '../storefront-content/dtos/storefront-content.dto';

@ApiTags('Admin Storefront Slots')
@Controller('admin/storefront-slots')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminStorefrontSlotsController {
  constructor(
    private readonly service: StorefrontSlotsService,
    private readonly audit: ContentAuditService,
  ) {}

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
  async create(@Body() body: CreateSlotDto, @Req() req: Request) {
    const adminId = (req as any).adminId as string | undefined;
    const slot = await this.service.create(body, adminId);
    return { success: true, message: 'Slot created', data: slot };
  }

  /**
   * Phase 48 (Finding #16) — bulk reorder. Declared before `:id`-style
   * routes; the literal `reorder` segment never collides with a UUID
   * param anyway, but keeping it adjacent to create makes the write
   * surface obvious.
   */
  @Post('reorder')
  @Permissions('content.write')
  async reorder(@Body() body: ReorderSlotsDto, @Req() req: Request) {
    const adminId = (req as any).adminId as string | undefined;
    const result = await this.service.reorder(body.items, adminId);
    return { success: true, message: 'Slots reordered', data: result };
  }

  /**
   * Phase 48 (Finding #15) — edit a slot's label / defaultHref /
   * position in place. Identity columns stay immutable so the linked
   * content block survives. Guarded identically to create.
   */
  @Patch(':id')
  @Permissions('content.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateSlotDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const slot = await this.service.update(id, body, adminId);
    return { success: true, message: 'Slot updated', data: slot };
  }

  @Delete(':id')
  @Permissions('content.write')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const adminId = (req as any).adminId as string | undefined;
    await this.service.remove(id, adminId);
    return { success: true, message: 'Slot deleted' };
  }

  /**
   * Phase 47 (2026-05-21) — per-slot-definition audit history.
   * Pairs with the content-block history endpoint to give the admin
   * a single "what changed" view.
   */
  @Get(':id/history')
  @Permissions('content.read')
  async history(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const entries = await this.audit.list('SLOT', id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { success: true, message: 'Slot audit log', data: entries };
  }
}
