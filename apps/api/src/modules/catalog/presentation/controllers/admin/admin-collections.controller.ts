import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AdminAuthGuard, PermissionsGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import { CurrentAdmin } from '../../../../../core/decorators/current-actor.decorator';
import { MediaStorageAdapter } from '../../../../../integrations/media/media-storage.adapter';
import { FileService } from '../../../../files/application/services/file.service';
import { RedisService } from '../../../../../bootstrap/cache/redis.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../../core/exceptions';
import { COLLECTION_REPOSITORY, ICollectionRepository } from '../../../domain/repositories/collection.repository.interface';
import { AdminCreateCollectionDto } from '../../dtos/admin-create-collection.dto';
import { AdminUpdateCollectionDto } from '../../dtos/admin-update-collection.dto';
import {
  AdminAttachCollectionProductsDto,
  AdminDetachCollectionProductsDto,
} from '../../dtos/admin-attach-collection-products.dto';
import { AdminReorderCollectionProductsDto } from '../../dtos/admin-reorder-collection-products.dto';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Phase 37 (2026-05-21) — media publicId extractor; same shape
 *  as the category/brand controllers. */
function extractmediaPublicId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  return match ? match[1]! : null;
}

const STOREFRONT_COLLECTIONS_CACHE_PATTERN = 'storefront:collections:list:*';

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGE_MULTER_OPTIONS = {
  limits: { fileSize: IMAGE_MAX_BYTES },
  fileFilter: (
    _req: Request,
    file: { mimetype: string },
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    if (IMAGE_ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else
      cb(
        new BadRequestAppException(
          `Only JPEG / PNG / WebP images are allowed (got ${file.mimetype})`,
        ),
        false,
      );
  },
};

@ApiTags('Admin Collections')
@Controller('admin/collections')
@UseGuards(AdminAuthGuard, PermissionsGuard)
// Phase 37 (2026-05-21) — granular @Permissions per method.
// Pre-Phase-37 the class-level `catalog.write` gated reads too,
// preventing a read-only Reports admin from browsing curated
// collections.
export class AdminCollectionsController {
  private readonly logger = new Logger(AdminCollectionsController.name);

  constructor(
    @Inject(COLLECTION_REPOSITORY) private readonly collectionRepo: ICollectionRepository,
    private readonly media: MediaStorageAdapter,
    private readonly redis: RedisService,
    private readonly fileService: FileService,
  ) {}

  private async invalidateCollectionsCache(): Promise<void> {
    try {
      await this.redis.delPattern(STOREFRONT_COLLECTIONS_CACHE_PATTERN);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate storefront collections cache: ${(err as Error).message}`,
      );
    }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  async listCollections(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const { collections, total } = await this.collectionRepo.findAllPaginated({
      page: pageNum,
      limit: limitNum,
      search,
      includeDeleted: includeDeleted === 'true',
    });
    const mapped = collections.map((c: any) => ({
      id: c.id, name: c.name, slug: c.slug, description: c.description,
      imageUrl: c.imageUrl, imageAltText: c.imageAltText,
      isActive: c.isActive, deletedAt: c.deletedAt,
      productCount: c._count.products, createdAt: c.createdAt,
    }));
    return {
      success: true, message: 'Collections retrieved',
      data: { collections: mapped, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  async getCollection(@Param('id') id: string) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');
    return { success: true, message: 'Collection retrieved', data: { ...collection, productCount: collection.products.length } };
  }

  @Get(':id/audit-log')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'Audit log for one collection (Phase 37)' })
  async getAuditLog(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;
    const entries = await this.collectionRepo.findAuditLogForCollection(id, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : undefined,
    });
    return { success: true, message: 'Audit log retrieved', data: entries };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog.write')
  // Phase 37 (2026-05-21) — single-call multipart create. Optional
  // `image` file field; JSON callers pass through unchanged.
  @UseInterceptors(FileInterceptor('image', IMAGE_MULTER_OPTIONS))
  async createCollection(
    @CurrentAdmin() adminId: string,
    @Body() dto: AdminCreateCollectionDto,
    @UploadedFile() imageFile?: Express.Multer.File,
  ) {
    const slug = dto.slug || toSlug(dto.name);

    const existingSlug = await this.collectionRepo.findBySlug(slug);
    if (existingSlug) throw new BadRequestAppException(`A collection with slug "${slug}" already exists`);
    const existingName = await this.collectionRepo.findByNameInsensitiveExcluding(dto.name);
    if (existingName) throw new BadRequestAppException(`A collection with name "${dto.name}" already exists`);

    let collection: any;
    try {
      collection = await this.collectionRepo.create({
        name: dto.name,
        slug,
        description: dto.description ?? null,
        imageAltText: dto.imageAltText ?? null,
        isActive: dto.isActive !== false,
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestAppException('A collection with this name or slug already exists');
      }
      throw err;
    }

    if (imageFile && imageFile.buffer) {
      try {
        const result = await this.media.upload(imageFile.buffer, {
          folder: `collections/${collection.id}`,
          resourceType: 'image',
        });
        // Additively register the media asset in the central
        // FileMetadata table so the integrity-verifier, audit, and
        // orphan sweep can see it. Best-effort — never breaks upload.
        void this.fileService
          .registerExternalAsset({
            publicId: result.publicId,
            url: result.secureUrl,
            mimeType: imageFile.mimetype,
            sizeBytes: imageFile.size,
            purpose: 'BANNER',
            uploadedBy: adminId,
            uploadedByType: 'ADMIN',
            fileName: imageFile.originalname,
            buffer: imageFile.buffer,
          })
          .catch(() => undefined);
        try {
          collection = await this.collectionRepo.updateImageFields(
            collection.id,
            result.secureUrl,
            result.publicId,
          );
        } catch (err) {
          await this.media.delete(result.publicId).catch(() => undefined);
          throw err;
        }
      } catch (err) {
        // Roll back the collection row so an upload failure doesn't
        // leave a half-created entry. The hard `delete` is fine here
        // because the row has no map references yet on the create
        // path.
        await this.collectionRepo.delete(collection.id).catch(() => undefined);
        throw err;
      }
    }

    // Phase 38 (2026-05-21) — initial product attach inside the same
    // request. The frontend now ships `initialProductIds[]` in the
    // multipart body when admin clicks Save with products selected.
    // Pre-Phase-38 the second POST to /:id/products was a separate
    // request; a network blip between them left empty collections.
    // The attach still goes through the same `addProducts` repo so
    // the eligibility filter + `skipped` reporting are identical to
    // the standalone path.
    let initialAttach: { attached: string[]; skipped: Array<{ productId: string; reason: string }> } | null = null;
    if (dto.initialProductIds && dto.initialProductIds.length > 0) {
      initialAttach = await this.collectionRepo.addProducts(
        collection.id,
        dto.initialProductIds,
      );
      if (initialAttach.attached.length > 0) {
        await this.collectionRepo.writeAuditLog({
          collectionId: collection.id,
          action: 'ATTACH',
          adminId,
          previousState: null,
          newState: initialAttach,
          reason: `Initial attach during create: ${initialAttach.attached.length} attached, ${initialAttach.skipped.length} skipped`,
        });
      }
    }

    await this.collectionRepo.writeAuditLog({
      collectionId: collection.id,
      action: 'CREATE',
      adminId,
      previousState: null,
      newState: collection,
    });
    await this.invalidateCollectionsCache();

    return {
      success: true,
      message: 'Collection created',
      data: initialAttach ? { ...collection, initialAttach } : collection,
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async updateCollection(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: AdminUpdateCollectionDto,
  ) {
    // Phase 37 (2026-05-21) — the dead `findBySlug('')` call from the
    // pre-Phase-37 controller (audit gap #4) is removed.
    const existing = await this.collectionRepo.findById(id);
    if (!existing) throw new NotFoundAppException('Collection not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      // Phase 37 — name uniqueness check on update too (audit gap #9).
      const nameClash = await this.collectionRepo.findByNameInsensitiveExcluding(dto.name, id);
      if (nameClash) {
        throw new BadRequestAppException(`A collection with name "${dto.name}" already exists`);
      }
      data.name = dto.name;
    }
    if (dto.slug !== undefined) {
      if (dto.slug !== existing.slug) {
        const slugExists = await this.collectionRepo.findBySlug(dto.slug);
        if (slugExists) throw new BadRequestAppException(`Slug "${dto.slug}" already taken`);
      }
      data.slug = dto.slug;
    }
    if (dto.description !== undefined) data.description = dto.description || null;
    if (dto.imageAltText !== undefined) data.imageAltText = dto.imageAltText || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const isDeactivation = dto.isActive === false && existing.isActive === true;

    let updated;
    try {
      updated = await this.collectionRepo.update(id, data);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestAppException('Slug or name already in use');
      }
      throw err;
    }

    await this.collectionRepo.writeAuditLog({
      collectionId: id,
      action: 'UPDATE',
      adminId,
      previousState: existing,
      newState: updated,
      reason: isDeactivation ? 'Deactivated' : null,
    });
    await this.invalidateCollectionsCache();

    return { success: true, message: 'Collection updated', data: updated };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  // Phase 37 (2026-05-21) — soft-delete by default. Pre-Phase-37 a
  // hard-delete mid-sale cascade-removed all map rows + 404'd the
  // storefront page with no undo. Now: stamps deletedAt + cascade
  // detaches maps in one tx; POST :id/restore reverses it.
  async deleteCollection(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
  ) {
    const existing = await this.collectionRepo.findById(id);
    if (!existing) throw new NotFoundAppException('Collection not found');

    const deleted = await this.collectionRepo.softDelete(id);
    if (!deleted) {
      return { success: true, message: 'Collection already deleted' };
    }

    const publicId =
      existing.imagePublicId ?? extractmediaPublicId(deleted.imageUrl);
    if (publicId) {
      this.media.delete(publicId).catch((err) =>
        this.logger.warn(
          `media cleanup failed for collection ${id} hero ${publicId}: ${err?.message}`,
        ),
      );
    }

    await this.collectionRepo.writeAuditLog({
      collectionId: id,
      action: 'DELETE',
      adminId,
      previousState: existing,
      newState: null,
      reason: 'Soft-deleted (deletedAt stamped, all maps detached)',
    });
    await this.invalidateCollectionsCache();

    return { success: true, message: 'Collection deleted (recoverable via /restore)' };
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Restore a soft-deleted collection (Phase 37)' })
  async restoreCollection(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
  ) {
    const restored = await this.collectionRepo.restore(id);
    if (!restored) {
      throw new NotFoundAppException('Collection not found or not deleted');
    }
    await this.collectionRepo.writeAuditLog({
      collectionId: id,
      action: 'RESTORE',
      adminId,
      previousState: null,
      newState: restored,
    });
    await this.invalidateCollectionsCache();
    return { success: true, message: 'Collection restored', data: restored };
  }

  @Post(':id/products')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async addProducts(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: AdminAttachCollectionProductsDto,
  ) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');

    // Phase 37 (2026-05-21) — eligibility-filtered attach. The repo
    // returns `{attached, skipped}` so the UI can show "Added 8,
    // skipped 2 — Product X is DRAFT, Product Y is REJECTED" instead
    // of the old "I added 10, why are only 8 on the storefront?"
    // mystery.
    const result = await this.collectionRepo.addProducts(id, dto.productIds);

    if (result.attached.length > 0) {
      await this.collectionRepo.writeAuditLog({
        collectionId: id,
        action: 'ATTACH',
        adminId,
        previousState: null,
        newState: { attached: result.attached, skipped: result.skipped },
        reason: `Attached ${result.attached.length}, skipped ${result.skipped.length}`,
      });
      await this.invalidateCollectionsCache();
    }

    return {
      success: true,
      message: `${result.attached.length} product(s) attached, ${result.skipped.length} skipped`,
      data: result,
    };
  }

  @Post(':id/products/bulk-detach')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Bulk detach products from a collection (Phase 37)' })
  async bulkDetach(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: AdminDetachCollectionProductsDto,
  ) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');

    const removed = await this.collectionRepo.removeProducts(id, dto.productIds);

    if (removed > 0) {
      await this.collectionRepo.writeAuditLog({
        collectionId: id,
        action: 'DETACH',
        adminId,
        previousState: { productIds: dto.productIds },
        newState: { removedCount: removed },
        reason: `Bulk-detached ${removed} product(s)`,
      });
      await this.invalidateCollectionsCache();
    }

    return {
      success: true,
      message: `${removed} product(s) detached`,
      data: { removed },
    };
  }

  @Patch(':id/products/reorder')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Reorder products inside a collection (Phase 37)' })
  async reorderProducts(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: AdminReorderCollectionProductsDto,
  ) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');

    const attachedIds = new Set(
      (collection.products ?? []).map((m: any) => m.productId),
    );
    const missing = dto.items
      .map((i) => i.productId)
      .filter((pid) => !attachedIds.has(pid));
    if (missing.length > 0) {
      throw new BadRequestAppException(
        `Products not attached to this collection: ${missing.join(', ')}`,
      );
    }

    await this.collectionRepo.reorderProducts(id, dto.items);
    await this.collectionRepo.writeAuditLog({
      collectionId: id,
      action: 'REORDER',
      adminId,
      previousState: null,
      newState: { items: dto.items },
    });
    await this.invalidateCollectionsCache();

    return {
      success: true,
      message: `${dto.items.length} product(s) reordered`,
    };
  }

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async removeProduct(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    await this.collectionRepo.removeProduct(id, productId);
    await this.collectionRepo.writeAuditLog({
      collectionId: id,
      action: 'DETACH',
      adminId,
      previousState: { productId },
      newState: null,
    });
    await this.invalidateCollectionsCache();
    return { success: true, message: 'Product removed from collection' };
  }

  @Post(':id/image')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @UseInterceptors(FileInterceptor('image', IMAGE_MULTER_OPTIONS))
  async uploadImage(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');
    if (!file || !file.buffer) throw new BadRequestAppException('Image file is required');

    // Phase 37 — atomic upload + replace. Same pattern as Phase 35
    // brand logo handling.
    const previousPublicId =
      collection.imagePublicId ??
      extractmediaPublicId(collection.imageUrl ?? null);

    const result = await this.media.upload(file.buffer, {
      folder: `collections/${id}`,
      resourceType: 'image',
    });

    // Additively register the media asset in the central
    // FileMetadata table so the integrity-verifier, audit, and orphan
    // sweep can see it. Best-effort — must never break the upload.
    void this.fileService
      .registerExternalAsset({
        publicId: result.publicId,
        url: result.secureUrl,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        purpose: 'BANNER',
        uploadedBy: adminId,
        uploadedByType: 'ADMIN',
        fileName: file.originalname,
        buffer: file.buffer,
      })
      .catch(() => undefined);

    let updated;
    try {
      updated = await this.collectionRepo.updateImageFields(
        id,
        result.secureUrl,
        result.publicId,
      );
    } catch (err) {
      await this.media.delete(result.publicId).catch((cleanupErr) =>
        this.logger.warn(
          `media cleanup after DB failure missed asset ${result.publicId}: ${cleanupErr?.message}`,
        ),
      );
      throw err;
    }

    if (previousPublicId && previousPublicId !== result.publicId) {
      this.media.delete(previousPublicId).catch((err) =>
        this.logger.warn(
          `Failed to delete previous collection image ${previousPublicId}: ${err?.message}`,
        ),
      );
    }

    await this.collectionRepo.writeAuditLog({
      collectionId: id,
      action: 'IMAGE_CHANGE',
      adminId,
      previousState: { imageUrl: collection.imageUrl, imagePublicId: previousPublicId },
      newState: { imageUrl: result.secureUrl, imagePublicId: result.publicId },
    });
    await this.invalidateCollectionsCache();

    return { success: true, message: 'Image uploaded', data: { imageUrl: updated.imageUrl } };
  }

  @Delete(':id/image')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  async deleteImage(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
  ) {
    const collection = await this.collectionRepo.findById(id);
    if (!collection) throw new NotFoundAppException('Collection not found');

    const previousPublicId =
      collection.imagePublicId ??
      extractmediaPublicId(collection.imageUrl ?? null);

    const updated = await this.collectionRepo.updateImageFields(id, null, null);

    if (previousPublicId) {
      this.media.delete(previousPublicId).catch((err) =>
        this.logger.warn(
          `Failed to delete collection image asset ${previousPublicId}: ${err?.message}`,
        ),
      );
    }

    await this.collectionRepo.writeAuditLog({
      collectionId: id,
      action: 'IMAGE_CHANGE',
      adminId,
      previousState: { imageUrl: collection.imageUrl, imagePublicId: previousPublicId },
      newState: { imageUrl: null, imagePublicId: null },
    });
    await this.invalidateCollectionsCache();

    return { success: true, message: 'Image removed', data: updated };
  }
}
