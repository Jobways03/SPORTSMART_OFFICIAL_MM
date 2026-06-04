import { Injectable, Logger } from '@nestjs/common';
import { BrandAuditAction } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IBrandRepository, BrandListParams } from '../../domain/repositories/brand.repository.interface';

@Injectable()
export class PrismaBrandRepository implements IBrandRepository {
  private readonly logger = new Logger(PrismaBrandRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAllPaginated(params: BrandListParams): Promise<{ brands: any[]; total: number }> {
    const { page, limit, search } = params;
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [brands, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.brand.count({ where }),
    ]);
    return { brands, total };
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.brand.findUnique({ where: { id } });
  }

  async findByIdWithProducts(id: string): Promise<any | null> {
    return this.prisma.brand.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true } },
        products: {
          where: { isDeleted: false },
          select: {
            id: true, title: true, slug: true, status: true, basePrice: true,
            images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
          },
          orderBy: { title: 'asc' },
          take: 200,
        },
      },
    });
  }

  async findBySlug(slug: string): Promise<any | null> {
    return this.prisma.brand.findUnique({ where: { slug } });
  }

  async findBySlugExcluding(slug: string, excludeId: string): Promise<any | null> {
    return this.prisma.brand.findFirst({ where: { slug, id: { not: excludeId } } });
  }

  async findByNameInsensitive(name: string): Promise<any | null> {
    return this.prisma.brand.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
  }

  async create(data: any): Promise<any> {
    return this.prisma.brand.create({
      data,
      include: { _count: { select: { products: true } } },
    });
  }

  async update(id: string, data: any): Promise<any> {
    return this.prisma.brand.update({
      where: { id },
      data,
      include: { _count: { select: { products: true } } },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.brand.delete({ where: { id } });
  }

  async deactivate(id: string): Promise<void> {
    await this.prisma.brand.update({ where: { id }, data: { isActive: false } });
  }

  async findWithCounts(id: string): Promise<any | null> {
    return this.prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
  }

  async addProductsToBrand(brandId: string, productIds: string[]): Promise<number> {
    const result = await this.prisma.product.updateMany({
      where: { id: { in: productIds }, isDeleted: false },
      data: { brandId },
    });
    return result.count;
  }

  async removeProductFromBrand(brandId: string, productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, brandId, isDeleted: false },
    });
    if (!product) throw new Error('Product not found in this brand');
    await this.prisma.product.update({ where: { id: productId }, data: { brandId: null } });
  }

  async updateLogoUrl(id: string, logoUrl: string | null): Promise<any> {
    return this.prisma.brand.update({ where: { id }, data: { logoUrl } });
  }

  /**
   * Phase 35 (2026-05-21) — atomic logo+publicId write. The url and
   * the publicId always travel together so the next delete/replace
   * call has the media reference to clean up.
   */
  async updateLogoFields(
    id: string,
    logoUrl: string | null,
    logoPublicId: string | null,
  ): Promise<any> {
    return this.prisma.brand.update({
      where: { id },
      data: { logoUrl, logoPublicId },
    });
  }

  /**
   * Phase 35 (2026-05-21) — transactional hard-delete. Race-safe
   * against a product being created between the controller's
   * pre-check and the delete itself. Returns logo fields so the
   * controller can clean up the media asset.
   */
  async deleteTransactional(id: string): Promise<{
    logoUrl: string | null;
    logoPublicId: string | null;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.brand.findUnique({
        where: { id },
        select: {
          id: true,
          logoUrl: true,
          logoPublicId: true,
          _count: { select: { products: true } },
        },
      });
      if (!fresh) return null;
      if (fresh._count.products > 0) {
        throw new Error('BRAND_NOT_EMPTY');
      }
      await tx.brand.delete({ where: { id } });
      return { logoUrl: fresh.logoUrl, logoPublicId: fresh.logoPublicId };
    });
  }

  /**
   * Phase 35 (2026-05-21) — best-effort audit-log write. Mirrors the
   * category pattern: a failure here logs but never propagates.
   */
  async writeAuditLog(entry: {
    brandId: string;
    action:
      | 'CREATE'
      | 'UPDATE'
      | 'DELETE'
      | 'DEACTIVATE'
      | 'LOGO_CHANGE'
      | 'BULK_ASSIGN';
    adminId?: string | null;
    previousState?: unknown;
    newState?: unknown;
    reason?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.brandAuditLog.create({
        data: {
          brandId: entry.brandId,
          action: entry.action as BrandAuditAction,
          adminId: entry.adminId ?? null,
          previousState: (entry.previousState ?? null) as any,
          newState: (entry.newState ?? null) as any,
          reason: entry.reason ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `BrandAuditLog write failed for ${entry.brandId} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  async findAuditLogForBrand(
    brandId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<unknown[]> {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const skip = Math.max(opts.offset ?? 0, 0);
    return this.prisma.brandAuditLog.findMany({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });
  }

  async findAllActive(search?: string): Promise<any[]> {
    // Phase 35 (2026-05-21) — search by name OR slug for parity with
    // admin list (audit #14).
    return this.prisma.brand.findMany({
      where: {
        isActive: true,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { slug: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }
}
