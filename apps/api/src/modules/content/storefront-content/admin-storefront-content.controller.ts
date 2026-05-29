import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { AdminAuthGuard, PermissionsGuard } from '../../../core/guards';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { BadRequestAppException } from '../../../core/exceptions';
import { StorefrontContentService } from './storefront-content.service';
import { ContentAuditService } from './content-audit.service';
import { UpsertStorefrontContentDto } from './dtos/storefront-content.dto';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_MULTER_OPTIONS,
  MAX_IMAGE_BYTES,
} from '../../catalog/presentation/controllers/_helpers/image-upload';

@ApiTags('Admin Storefront Content')
@Controller('admin/storefront-content')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminStorefrontContentController {
  constructor(
    private readonly service: StorefrontContentService,
    private readonly audit: ContentAuditService,
  ) {}

  /**
   * List every block (active or not). Powers the admin grid. The
   * frontend's slot registry decides which slots to *show* even when
   * the DB has no row for them yet — this endpoint just returns what's
   * actually persisted.
   */
  @Get()
  @Permissions('content.read')
  async list() {
    return {
      success: true,
      message: 'Storefront content blocks',
      data: { items: await this.service.listAll() },
    };
  }

  @Get(':slot')
  @Permissions('content.read')
  async getOne(@Param('slot') slot: string) {
    const block = await this.service.findBySlot(slot);
    return {
      success: true,
      message: block ? 'Block found' : 'No block yet for this slot',
      data: block,
    };
  }

  /**
   * Phase 47 (2026-05-21) — per-slot attestation audit history.
   * Marketing / compliance can answer "who changed the hero on
   * July 4" without trawling app logs.
   */
  @Get(':slot/history')
  @Permissions('content.read')
  async history(
    @Param('slot') slot: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const entries = await this.audit.list('CONTENT_BLOCK', slot, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { success: true, message: 'Content audit log', data: entries };
  }

  /**
   * Upsert a slot. Use PUT so the operation is idempotent — the same
   * payload sent twice produces the same final state.
   */
  @Put(':slot')
  @Permissions('content.write')
  async upsert(
    @Param('slot') slot: string,
    @Body() body: UpsertStorefrontContentDto,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const data = await this.service.upsert(slot, body, adminId);
    return { success: true, message: 'Block saved', data };
  }

  /**
   * Reset the slot — soft-delete the row + clean up the Cloudinary
   * asset. Idempotent: deleting a non-existent / already-soft-deleted
   * slot returns 200.
   */
  @Delete(':slot')
  @Permissions('content.write')
  async reset(@Param('slot') slot: string, @Req() req: Request) {
    const adminId = (req as any).adminId as string | undefined;
    await this.service.resetSlot(slot, adminId);
    return { success: true, message: 'Block reset to fallback' };
  }

  /**
   * Phase 47 (2026-05-21) — uses the shared IMAGE_MULTER_OPTIONS so
   * MIME allowlist (JPEG / PNG / WEBP) is enforced at fileFilter
   * stage. SVG and other types are rejected pre-upload.
   */
  @Post(':slot/upload')
  @Permissions('content.write')
  @UseInterceptors(FileInterceptor('image', IMAGE_MULTER_OPTIONS))
  async upload(
    @Param('slot') slot: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestAppException('image file is required');
    }
    // Defence-in-depth: the Multer fileFilter already rejects non-
    // image MIME, but a misconfigured FileInterceptor would let it
    // through.
    if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestAppException(
        `Only ${ALLOWED_IMAGE_MIME_TYPES.join(', ')} images are allowed`,
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestAppException('Image must not exceed 5MB');
    }
    const adminId = (req as any).adminId as string | undefined;
    const data = await this.service.uploadImage(slot, file, adminId);
    return { success: true, message: 'Image uploaded', data };
  }
}
