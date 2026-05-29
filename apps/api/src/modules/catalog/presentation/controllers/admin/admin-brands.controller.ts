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
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CloudinaryAdapter } from '../../../../../integrations/cloudinary/cloudinary.adapter';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard, PermissionsGuard } from '../../../../../core/guards';
import { Permissions } from '../../../../../core/decorators/permissions.decorator';
import { CurrentAdmin } from '../../../../../core/decorators/current-actor.decorator';
import { RedisService } from '../../../../../bootstrap/cache/redis.service';
import { BRAND_REPOSITORY, IBrandRepository } from '../../../domain/repositories/brand.repository.interface';
import { ReApprovalService } from '../../../application/services/re-approval.service';
import { AdminCreateBrandDto } from '../../dtos/admin-create-brand.dto';
import { AdminUpdateBrandDto } from '../../dtos/admin-update-brand.dto';

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Phase 35 (2026-05-21) — Redis cache key for the storefront brands
 * list. Invalidated by every admin mutation that affects active-brand
 * state (create/update/delete/deactivate/logo/bulk-assign).
 */
const STOREFRONT_BRANDS_CACHE_PATTERN = 'storefront:brands:list:*';

/**
 * Phase 35 (2026-05-21) — Multer config for the logo upload route.
 *   - 2 MB hard cap so a 500 MB upload can't OOM the API server.
 *   - MIME allow-list of jpeg/png/webp; SVG is intentionally blocked
 *     at this layer too (defence in depth — Cloudinary's
 *     allowed_formats also blocks it).
 */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const LOGO_MULTER_OPTIONS = {
  limits: { fileSize: LOGO_MAX_BYTES },
  fileFilter: (
    _req: Request,
    file: { mimetype: string },
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    if (LOGO_ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new BadRequestAppException(
          `Only JPEG / PNG / WebP images are allowed (got ${file.mimetype})`,
        ),
        false,
      );
    }
  },
};

@ApiTags('Admin - Brands')
@Controller({ path: 'admin/brands', version: '1' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
// Phase 35 (2026-05-21) — granular @Permissions per method.
// Pre-Phase-35 the class-level `catalog.write` gated reads too,
// preventing a read-only Reports admin from browsing the brand list.
export class AdminBrandsController {
  private readonly logger = new Logger(AdminBrandsController.name);

  constructor(
    @Inject(BRAND_REPOSITORY) private readonly brandRepo: IBrandRepository,
    private readonly cloudinary: CloudinaryAdapter,
    private readonly reApprovalService: ReApprovalService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Phase 35 (2026-05-21) — invalidate the storefront cache. Mirrors
   * the Phase 34 category pattern. Failures here log but never block
   * the primary mutation.
   */
  private async invalidateBrandsCache(): Promise<void> {
    try {
      await this.redis.delPattern(STOREFRONT_BRANDS_CACHE_PATTERN);
    } catch (err) {
      this.logger.warn(
        `Failed to invalidate storefront brands cache: ${(err as Error).message}`,
      );
    }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'List all brands' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  async list(@Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '50', 10) || 50));
    const { brands, total } = await this.brandRepo.findAllPaginated({ page: pageNum, limit: limitNum, search });
    return {
      success: true, message: 'Brands retrieved',
      data: { brands, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } },
    };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'Get a single brand with its products' })
  async getOne(@Param('id') id: string) {
    const brand = await this.brandRepo.findByIdWithProducts(id);
    if (!brand) throw new NotFoundAppException('Brand not found');
    return { success: true, message: 'Brand retrieved', data: { brand } };
  }

  @Get(':id/audit-log')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.read')
  @ApiOperation({ summary: 'Audit log for a single brand (Phase 35)' })
  async getAuditLog(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : undefined;
    const entries = await this.brandRepo.findAuditLogForBrand(id, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : undefined,
    });
    return { success: true, message: 'Audit log retrieved', data: entries };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('catalog.write')
  // Phase 36 (2026-05-21) — single-call multipart create.
  //
  // Pre-Phase-36 the frontend did POST /admin/brands then POST
  // /admin/brands/:id/logo as two separate requests. A network blip
  // between them left a brand with no logo, requiring the admin to
  // find it in the list and retry the upload. Now: one request with
  // optional multipart `logo` field.
  //
  // FileInterceptor is no-op on application/json requests, so JSON
  // callers (curl, integration tests, the existing PATCH flow) keep
  // working without change. On a multipart create with a file, we:
  //   1. Validate the brand row.
  //   2. Insert the brand row (the row needs to exist before we
  //      know the Cloudinary folder name).
  //   3. Upload the logo to brands/<id>/.
  //   4. Save url+publicId in a second tx — on failure, both the
  //      Cloudinary asset AND the brand row roll back so we don't
  //      leak orphans.
  @UseInterceptors(FileInterceptor('logo', LOGO_MULTER_OPTIONS))
  @ApiOperation({ summary: 'Create a brand (optional multipart logo)' })
  async create(
    @CurrentAdmin() adminId: string,
    @Body() dto: AdminCreateBrandDto,
    @UploadedFile() logoFile?: Express.Multer.File,
  ) {
    const slug = dto.slug || toSlug(dto.name);

    // Friendly pre-checks (good UX) — the catch-P2002 below is the
    // race-safe fallback if two admins create the same brand at once.
    const existingSlug = await this.brandRepo.findBySlug(slug);
    if (existingSlug) throw new BadRequestAppException(`A brand with slug "${slug}" already exists`);
    const existingName = await this.brandRepo.findByNameInsensitive(dto.name);
    if (existingName) throw new BadRequestAppException(`A brand with name "${dto.name}" already exists`);

    let brand: any;
    try {
      brand = await this.brandRepo.create({
        name: dto.name,
        slug,
        logoUrl: dto.logoUrl ?? null,
        description: dto.description ?? null,
        metaTitle: dto.metaTitle ?? null,
        metaDescription: dto.metaDescription ?? null,
        isActive: dto.isActive !== false,
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Phase 35 (2026-05-21) — race-safe slug/name uniqueness.
        // Pre-Phase-35 this surfaced as a 500.
        throw new BadRequestAppException(
          `A brand with this name or slug already exists`,
        );
      }
      throw err;
    }

    // Phase 36 (2026-05-21) — if multipart logo present, push it to
    // Cloudinary and stamp url+publicId. Failure path deletes the
    // brand row so the caller doesn't end up with a logo-less brand
    // they didn't intend to keep.
    if (logoFile && logoFile.buffer) {
      try {
        const result = await this.cloudinary.upload(logoFile.buffer, {
          folder: `brands/${brand.id}`,
          resourceType: 'image',
          transformation: [{ width: 400, height: 400, crop: 'limit' }],
        });
        try {
          brand = await this.brandRepo.updateLogoFields(
            brand.id,
            result.secureUrl,
            result.publicId,
          );
        } catch (err) {
          // DB write failed after Cloudinary succeeded — clean both up.
          await this.cloudinary.delete(result.publicId).catch(() => undefined);
          throw err;
        }
      } catch (err) {
        // Roll back the brand row so we don't leak a half-created entry.
        await this.brandRepo
          .deleteTransactional(brand.id)
          .catch((cleanupErr) =>
            this.logger.warn(
              `Failed to roll back brand ${brand.id} after logo upload failure: ${(cleanupErr as Error).message}`,
            ),
          );
        throw err;
      }
    }

    await this.brandRepo.writeAuditLog({
      brandId: brand.id,
      action: 'CREATE',
      adminId,
      previousState: null,
      newState: brand,
    });
    await this.invalidateBrandsCache();

    return { success: true, message: 'Brand created', data: { brand } };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Update a brand' })
  async update(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() dto: AdminUpdateBrandDto,
  ) {
    const existing = await this.brandRepo.findById(id);
    if (!existing) throw new NotFoundAppException('Brand not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) {
      if (dto.slug !== existing.slug) {
        const slugExists = await this.brandRepo.findBySlugExcluding(dto.slug, id);
        if (slugExists) throw new BadRequestAppException(`Slug "${dto.slug}" already taken`);
      }
      data.slug = dto.slug;
    }
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.metaTitle !== undefined) data.metaTitle = dto.metaTitle || null;
    if (dto.metaDescription !== undefined) data.metaDescription = dto.metaDescription || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const isDeactivation = dto.isActive === false && existing.isActive === true;

    let brand;
    try {
      brand = await this.brandRepo.update(id, data);
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestAppException('Slug or name already in use');
      }
      throw err;
    }

    await this.brandRepo.writeAuditLog({
      brandId: id,
      action: isDeactivation ? 'DEACTIVATE' : 'UPDATE',
      adminId,
      previousState: existing,
      newState: brand,
    });
    await this.invalidateBrandsCache();

    return { success: true, message: 'Brand updated', data: { brand } };
  }

  @Post(':id/products')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Add products to a brand (set brandId)' })
  async addProducts(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Body() body: { productIds: string[] },
  ) {
    const brand = await this.brandRepo.findById(id);
    if (!brand) throw new NotFoundAppException('Brand not found');
    if (!body.productIds || !Array.isArray(body.productIds) || body.productIds.length === 0) {
      throw new BadRequestAppException('productIds array is required');
    }
    const count = await this.brandRepo.addProductsToBrand(id, body.productIds);

    // Phase 35 (2026-05-21) — trigger re-approval per product so an
    // admin-initiated brand reassignment doesn't silently keep an
    // ACTIVE product live with the new brand. The seller's product
    // re-approval rule already treats brand change as content;
    // pre-Phase-35 this bulk endpoint bypassed the service entirely.
    // Best-effort per product — one failure shouldn't block the rest.
    await Promise.all(
      body.productIds.map((productId) =>
        this.reApprovalService
          .triggerIfNeeded(productId, adminId, { changedFields: ['brandId'] })
          .catch((err) =>
            this.logger.warn(
              `Re-approval trigger failed for product=${productId} brand=${id}: ${(err as Error).message}`,
            ),
          ),
      ),
    );

    await this.brandRepo.writeAuditLog({
      brandId: id,
      action: 'BULK_ASSIGN',
      adminId,
      previousState: null,
      newState: { productIds: body.productIds, count },
      reason: `Bulk-assigned ${count} product(s) to brand`,
    });
    await this.invalidateBrandsCache();

    return { success: true, message: `${count} product(s) added to brand`, data: { updated: count } };
  }

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Remove a product from brand (unset brandId)' })
  async removeProduct(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    try {
      await this.brandRepo.removeProductFromBrand(id, productId);
    } catch {
      throw new NotFoundAppException('Product not found in this brand');
    }
    // Phase 35 — same re-approval as bulk-assign.
    await this.reApprovalService
      .triggerIfNeeded(productId, adminId, { changedFields: ['brandId'] })
      .catch((err) =>
        this.logger.warn(
          `Re-approval trigger failed for product=${productId} brand=${id} (remove): ${(err as Error).message}`,
        ),
      );

    await this.brandRepo.writeAuditLog({
      brandId: id,
      action: 'BULK_ASSIGN',
      adminId,
      previousState: { productId, brandId: id },
      newState: { productId, brandId: null },
      reason: 'Product removed from brand',
    });
    await this.invalidateBrandsCache();

    return { success: true, message: 'Product removed from brand' };
  }

  @Post(':id/logo')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @UseInterceptors(FileInterceptor('logo', LOGO_MULTER_OPTIONS))
  @ApiOperation({ summary: 'Upload brand logo' })
  async uploadLogo(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const brand = await this.brandRepo.findById(id);
    if (!brand) throw new NotFoundAppException('Brand not found');
    if (!file || !file.buffer) throw new BadRequestAppException('No file uploaded');

    // Phase 35 (2026-05-21) — atomic upload + replace.
    //
    // 1. Capture the previous publicId so we can clean it up after a
    //    successful replace.
    // 2. Push the new asset to Cloudinary.
    // 3. Persist URL + publicId together in a try/catch — on DB
    //    failure we MUST roll back the new Cloudinary asset so we
    //    don't accumulate orphans on every failed replace.
    // 4. On success, fire-and-forget delete of the prior asset.
    const previousPublicId = (brand as { logoPublicId?: string | null }).logoPublicId ?? null;

    const result = await this.cloudinary.upload(file.buffer, {
      folder: `brands/${id}`,
      resourceType: 'image',
      transformation: [{ width: 400, height: 400, crop: 'limit' }],
    });

    let updated;
    try {
      updated = await this.brandRepo.updateLogoFields(id, result.secureUrl, result.publicId);
    } catch (err) {
      // Clean up the asset we just pushed — better an orphan-free
      // failure than dragging the Cloudinary bill with us.
      await this.cloudinary.delete(result.publicId).catch((cleanupErr) =>
        this.logger.warn(
          `Cloudinary cleanup after DB failure missed asset ${result.publicId}: ${cleanupErr?.message}`,
        ),
      );
      throw err;
    }

    if (previousPublicId && previousPublicId !== result.publicId) {
      this.cloudinary.delete(previousPublicId).catch((err) => {
        this.logger.warn(
          `Failed to delete previous brand logo ${previousPublicId}: ${err?.message}`,
        );
      });
    }

    await this.brandRepo.writeAuditLog({
      brandId: id,
      action: 'LOGO_CHANGE',
      adminId,
      previousState: { logoUrl: brand.logoUrl, logoPublicId: previousPublicId },
      newState: { logoUrl: result.secureUrl, logoPublicId: result.publicId },
    });
    await this.invalidateBrandsCache();

    return { success: true, message: 'Logo uploaded', data: { logoUrl: updated.logoUrl } };
  }

  @Delete(':id/logo')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Remove brand logo' })
  async removeLogo(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
  ) {
    const brand = await this.brandRepo.findById(id);
    if (!brand) throw new NotFoundAppException('Brand not found');

    const previousPublicId = (brand as { logoPublicId?: string | null }).logoPublicId ?? null;

    await this.brandRepo.updateLogoFields(id, null, null);

    if (previousPublicId) {
      this.cloudinary.delete(previousPublicId).catch((err) => {
        this.logger.warn(
          `Failed to delete brand logo asset ${previousPublicId}: ${err?.message}`,
        );
      });
    }

    await this.brandRepo.writeAuditLog({
      brandId: id,
      action: 'LOGO_CHANGE',
      adminId,
      previousState: { logoUrl: brand.logoUrl, logoPublicId: previousPublicId },
      newState: { logoUrl: null, logoPublicId: null },
    });
    await this.invalidateBrandsCache();

    return { success: true, message: 'Logo removed' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Permissions('catalog.write')
  @ApiOperation({ summary: 'Delete or deactivate a brand' })
  async delete(
    @CurrentAdmin() adminId: string,
    @Param('id') id: string,
  ) {
    const brand = await this.brandRepo.findWithCounts(id);
    if (!brand) throw new NotFoundAppException('Brand not found');

    if (brand._count.products > 0) {
      await this.brandRepo.deactivate(id);
      await this.brandRepo.writeAuditLog({
        brandId: id,
        action: 'DEACTIVATE',
        adminId,
        previousState: { isActive: true },
        newState: { isActive: false },
        reason: 'Has associated products',
      });
      await this.invalidateBrandsCache();
      return { success: true, message: 'Brand deactivated (has associated products)' };
    }

    let deleted: { logoUrl: string | null; logoPublicId: string | null } | null;
    try {
      deleted = await this.brandRepo.deleteTransactional(id);
    } catch (err: any) {
      if (err?.message === 'BRAND_NOT_EMPTY') {
        // Lost the race — a product was created between the outer
        // and inner check. Fall back to deactivate.
        await this.brandRepo.deactivate(id);
        await this.brandRepo.writeAuditLog({
          brandId: id,
          action: 'DEACTIVATE',
          adminId,
          previousState: { isActive: true },
          newState: { isActive: false },
          reason: 'Product added during deletion (race)',
        });
        await this.invalidateBrandsCache();
        return {
          success: true,
          message: 'Brand deactivated (product added during deletion)',
        };
      }
      throw err;
    }

    if (deleted?.logoPublicId) {
      this.cloudinary.delete(deleted.logoPublicId).catch((err) => {
        this.logger.warn(
          `Cloudinary cleanup failed for brand logo ${deleted!.logoPublicId}: ${err?.message}`,
        );
      });
    }

    // The audit row writes before the FK cascade purges it — fine
    // for forensic snapshots that capture the DB before the row
    // disappears.
    await this.brandRepo.writeAuditLog({
      brandId: id,
      action: 'DELETE',
      adminId,
      previousState: { ...brand, ...deleted },
      newState: null,
    });
    await this.invalidateBrandsCache();

    return { success: true, message: 'Brand deleted' };
  }
}
