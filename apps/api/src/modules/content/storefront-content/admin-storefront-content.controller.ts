import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Post,
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
import {
  StorefrontContentService,
  UpsertStorefrontContentInput,
} from './storefront-content.service';

const MULTER_OPTIONS = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
};

@ApiTags('Admin Storefront Content')
@Controller('admin/storefront-content')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminStorefrontContentController {
  constructor(private readonly service: StorefrontContentService) {}

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
   * Upsert a slot. Use PUT so the operation is idempotent — the same
   * payload sent twice produces the same final state.
   */
  @Put(':slot')
  @Permissions('content.write')
  async upsert(
    @Param('slot') slot: string,
    @Body() body: UpsertStorefrontContentInput,
    @Req() req: Request,
  ) {
    const adminId = (req as any).adminId as string | undefined;
    const data = await this.service.upsert(slot, body, adminId);
    return { success: true, message: 'Block saved', data };
  }

  /**
   * Reset the slot to the storefront's curated fallback by deleting
   * the row. Idempotent: deleting a non-existent slot returns 200.
   */
  @Delete(':slot')
  @Permissions('content.write')
  async reset(@Param('slot') slot: string) {
    await this.service.resetSlot(slot);
    return { success: true, message: 'Block reset to fallback' };
  }

  /**
   * Upload an image for a slot. Multipart `image` field. Returns the
   * updated block (with the Cloudinary URL) so the admin UI can flip
   * the preview without a second round-trip.
   */
  @Post(':slot/upload')
  @Permissions('content.write')
  @UseInterceptors(FileInterceptor('image', MULTER_OPTIONS))
  async upload(
    @Param('slot') slot: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestAppException('image file is required');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestAppException('uploaded file must be an image');
    }
    const adminId = (req as any).adminId as string | undefined;
    const data = await this.service.uploadImage(slot, file, adminId);
    return { success: true, message: 'Image uploaded', data };
  }
}
