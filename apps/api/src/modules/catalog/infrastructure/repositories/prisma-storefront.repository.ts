import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { IStorefrontRepository, StorefrontListParams } from '../../domain/repositories/storefront.repository.interface';
import { Prisma } from '@prisma/client';

@Injectable()
export class PrismaStorefrontRepository implements IStorefrontRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProductsPaginated(params: StorefrontListParams): Promise<{ products: any[]; total: number }> {
    const { page, limit, search, categoryId, brandId, collectionId, sortBy, minPrice, maxPrice, filterObj } = params;
    const offset = (page - 1) * limit;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.is_deleted = false`,
      Prisma.sql`p.status = 'ACTIVE'`,
    ];

    const availabilityFilter = filterObj?.availability || null;
    const brandFilter = filterObj?.brand || null;

    if (availabilityFilter === 'out_of_stock') {
      conditions.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM seller_product_mappings spm WHERE spm.product_id = p.id AND spm.is_active = true AND spm.approval_status = 'APPROVED' AND (spm.stock_qty - spm.reserved_qty) > 0
      )`);
    } else {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM seller_product_mappings spm WHERE spm.product_id = p.id AND spm.is_active = true AND spm.approval_status = 'APPROVED' AND (spm.stock_qty - spm.reserved_qty) > 0
      )`);
    }

    if (brandFilter) conditions.push(Prisma.sql`p.brand_id = ${brandFilter}`);
    if (categoryId) conditions.push(Prisma.sql`p.category_id = ${categoryId}`);
    if (brandId) conditions.push(Prisma.sql`p.brand_id = ${brandId}`);
    if (collectionId) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM product_collection_maps pcm WHERE pcm.product_id = p.id AND pcm.collection_id = ${collectionId}
      )`);
    }
    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(Prisma.sql`(p.title ILIKE ${searchPattern} OR p.short_description ILIKE ${searchPattern} OR p.product_code ILIKE ${searchPattern})`);
    }
    if (minPrice) {
      const min = parseFloat(minPrice);
      if (!isNaN(min)) conditions.push(Prisma.sql`COALESCE(p.base_price, 0) >= ${min}`);
    }
    if (maxPrice) {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) conditions.push(Prisma.sql`COALESCE(p.base_price, 0) <= ${max}`);
    }

    // Metafield filters
    const BUILT_IN_FILTER_KEYS = new Set(['brand', 'availability', 'price_range']);
    if (filterObj) {
      for (const [filterKey, rawValue] of Object.entries(filterObj)) {
        if (BUILT_IN_FILTER_KEYS.has(filterKey)) continue;
        if (rawValue) {
          const values = String(rawValue).split(',').map((v) => v.trim()).filter(Boolean);
          if (values.length > 0) {
            conditions.push(Prisma.sql`EXISTS (
              SELECT 1 FROM product_metafields pm JOIN metafield_definitions md ON md.id = pm.metafield_definition_id
              WHERE pm.product_id = p.id AND md.key = ${filterKey}
                AND (pm.value_text IN (${Prisma.join(values)}) OR pm.value_boolean = ${values[0] === 'true'} OR pm.value_json @> ${JSON.stringify(values)}::jsonb)
            )`);
          }
        }
      }
    }

    const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;

    let orderByClause: Prisma.Sql;
    switch (sortBy) {
      case 'price_asc': orderByClause = Prisma.sql`ORDER BY COALESCE(p.base_price, 0) ASC`; break;
      case 'price_desc': orderByClause = Prisma.sql`ORDER BY COALESCE(p.base_price, 0) DESC`; break;
      default: orderByClause = Prisma.sql`ORDER BY p.created_at DESC`; break;
    }

    const countQuery = Prisma.sql`SELECT COUNT(DISTINCT p.id)::int AS total FROM products p ${whereClause}`;
    const dataQuery = Prisma.sql`
      SELECT p.id, p.product_code AS "productCode", p.title, p.slug, p.short_description AS "shortDescription",
        c.name AS "categoryName", b.name AS "brandName",
        p.base_price::numeric AS "basePrice",
        p.compare_at_price::numeric AS "compareAtPrice", p.has_variants AS "hasVariants",
        COALESCE(
          (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1),
          (SELECT pvi.url FROM product_variant_images pvi JOIN product_variants pv ON pv.id = pvi.variant_id WHERE pv.product_id = p.id AND pv.is_deleted = false ORDER BY pvi.sort_order ASC LIMIT 1)
        ) AS "primaryImageUrl",
        COALESCE(agg.total_available_stock, 0)::int AS "totalAvailableStock",
        COALESCE(agg.seller_count, 0)::int AS "sellerCount",
        COALESCE(vc.variant_count, 0)::int AS "variantCount"
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN LATERAL (
        SELECT SUM(GREATEST(spm.stock_qty - spm.reserved_qty, 0))::int AS total_available_stock,
          COUNT(DISTINCT spm.seller_id)::int AS seller_count
        FROM seller_product_mappings spm
        WHERE spm.product_id = p.id AND spm.is_active = true AND spm.approval_status = 'APPROVED' AND (spm.stock_qty - spm.reserved_qty) > 0
      ) agg ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS variant_count FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_deleted = false
      ) vc ON true
      ${whereClause} ${orderByClause} LIMIT ${limit} OFFSET ${offset}
    `;

    const [countResult, products] = await Promise.all([
      this.prisma.$queryRaw<{ total: number }[]>(countQuery),
      this.prisma.$queryRaw<any[]>(dataQuery),
    ]);

    return { products, total: countResult[0]?.total ?? 0 };
  }

  async findSearchSuggestions(query: string): Promise<Array<{ title: string; slug: string }>> {
    const searchPattern = `%${query.trim()}%`;
    return this.prisma.$queryRaw<{ title: string; slug: string }[]>(Prisma.sql`
      SELECT DISTINCT p.title, p.slug FROM products p
      WHERE p.is_deleted = false AND p.status = 'ACTIVE'
        AND (p.title ILIKE ${searchPattern} OR p.product_code ILIKE ${searchPattern})
        AND EXISTS (SELECT 1 FROM seller_product_mappings spm WHERE spm.product_id = p.id AND spm.is_active = true AND spm.approval_status = 'APPROVED' AND (spm.stock_qty - spm.reserved_qty) > 0)
      ORDER BY p.title ASC LIMIT 5
    `);
  }

  async findProductDetailBySlug(slug: string): Promise<any | null> {
    return this.prisma.product.findFirst({
      where: { slug, isDeleted: false, status: 'ACTIVE' },
      select: {
        id: true, productCode: true, title: true, slug: true, shortDescription: true,
        description: true, hasVariants: true, basePrice: true, compareAtPrice: true,
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true } },
        images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, altText: true, sortOrder: true, isPrimary: true } },
        tags: { select: { tag: true } },
        seo: { select: { metaTitle: true, metaDescription: true, handle: true } },
        options: {
          include: {
            optionDefinition: { include: { values: { orderBy: { sortOrder: 'asc' }, select: { id: true, value: true, displayValue: true, sortOrder: true } } } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        optionValues: {
          select: { optionValue: { select: { id: true, value: true, displayValue: true, optionDefinition: { select: { id: true, name: true, displayName: true, type: true } } } } },
        },
        variants: {
          where: { isDeleted: false },
          select: {
            id: true, masterSku: true, title: true, price: true,
            compareAtPrice: true, sortOrder: true, status: true,
            optionValues: {
              select: { optionValue: { select: { id: true, value: true, displayValue: true, optionDefinition: { select: { id: true, name: true, displayName: true, type: true } } } } },
            },
            images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, altText: true, sortOrder: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async findSellerMappingsForProduct(productId: string): Promise<any[]> {
    return this.prisma.sellerProductMapping.findMany({
      where: { productId, isActive: true, approvalStatus: 'APPROVED' },
      select: { variantId: true, stockQty: true, reservedQty: true, sellerId: true },
    });
  }

  async findFilterConfigs(where: any): Promise<any[]> {
    return this.prisma.storefrontFilter.findMany({
      where,
      include: {
        metafieldDefinition: {
          select: { id: true, namespace: true, key: true, name: true, type: true, choices: true, ownerType: true, categoryId: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createFilterConfig(data: any): Promise<any> {
    return this.prisma.storefrontFilter.create({
      data,
      include: { metafieldDefinition: { select: { id: true, namespace: true, key: true, name: true, type: true } } },
    });
  }

  async updateFilterConfig(id: string, data: any): Promise<any> {
    return this.prisma.storefrontFilter.update({
      where: { id },
      data,
      include: { metafieldDefinition: { select: { id: true, namespace: true, key: true, name: true, type: true } } },
    });
  }

  async deleteFilterConfig(id: string): Promise<void> {
    await this.prisma.storefrontFilter.delete({ where: { id } });
  }

  async findFilterConfigById(id: string): Promise<any | null> {
    return this.prisma.storefrontFilter.findUnique({ where: { id } });
  }

  async reorderFilterConfigs(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await this.prisma.storefrontFilter.update({
        where: { id: ids[i] },
        data: { sortOrder: i },
      });
    }
  }

  async findPostOfficeByPincode(pincode: string): Promise<any[]> {
    return this.prisma.postOffice.findMany({
      where: { pincode },
      select: {
        officeName: true, officeType: true, delivery: true,
        district: true, state: true, latitude: true, longitude: true,
      },
      orderBy: [{ officeType: 'asc' }, { officeName: 'asc' }],
    });
  }

  async findAllOptionDefinitions(): Promise<any[]> {
    return this.prisma.optionDefinition.findMany({
      include: { values: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async computeBrandFacets(baseConditions: Prisma.Sql[], otherConditions: Prisma.Sql[]): Promise<{ value: string; label: string; count: number }[]> {
    const allConditions = [...baseConditions, ...otherConditions];
    const whereClause = allConditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(allConditions, ' AND ')}`
      : Prisma.sql``;
    return this.prisma.$queryRaw<{ value: string; label: string; count: number }[]>(Prisma.sql`
      SELECT b.id AS value, b.name AS label, COUNT(DISTINCT p.id)::int AS count
      FROM products p
      JOIN brands b ON b.id = p.brand_id
      ${whereClause}
      GROUP BY b.id, b.name
      HAVING COUNT(DISTINCT p.id) > 0
      ORDER BY count DESC
      LIMIT 50
    `);
  }

  async computePriceRange(baseConditions: Prisma.Sql[], otherConditions: Prisma.Sql[]): Promise<{ min: number; max: number } | null> {
    const allConditions = [...baseConditions, ...otherConditions];
    const whereClause = allConditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(allConditions, ' AND ')}`
      : Prisma.sql``;
    const results = await this.prisma.$queryRaw<{ min: number; max: number }[]>(Prisma.sql`
      SELECT
        MIN(COALESCE(p.base_price, 0))::numeric AS min,
        MAX(COALESCE(p.base_price, 0))::numeric AS max
      FROM products p
      ${whereClause}
    `);
    const range = results[0];
    if (!range || (range.min === 0 && range.max === 0)) return null;
    return { min: Number(range.min), max: Number(range.max) };
  }

  async computeAvailabilityFacets(baseConditions: Prisma.Sql[]): Promise<{ in_stock: number; out_of_stock: number }> {
    const results = await this.prisma.$queryRaw<{ in_stock: number; out_of_stock: number }[]>(Prisma.sql`
      SELECT
        COUNT(DISTINCT CASE WHEN EXISTS (
          SELECT 1 FROM seller_product_mappings spm
          WHERE spm.product_id = p.id AND spm.is_active = true
            AND spm.approval_status = 'APPROVED'
            AND (spm.stock_qty - spm.reserved_qty) > 0
        ) THEN p.id END)::int AS in_stock,
        COUNT(DISTINCT CASE WHEN NOT EXISTS (
          SELECT 1 FROM seller_product_mappings spm
          WHERE spm.product_id = p.id AND spm.is_active = true
            AND spm.approval_status = 'APPROVED'
            AND (spm.stock_qty - spm.reserved_qty) > 0
        ) THEN p.id END)::int AS out_of_stock
      FROM products p
      WHERE p.is_deleted = false AND p.status = 'ACTIVE'
      ${baseConditions.length > 2 ? Prisma.sql`AND ${Prisma.join(baseConditions.slice(2), ' AND ')}` : Prisma.sql``}
    `);
    return { in_stock: results[0]?.in_stock ?? 0, out_of_stock: results[0]?.out_of_stock ?? 0 };
  }

  async computeBooleanMetafieldFacets(defKey: string, allConditions: Prisma.Sql[]): Promise<{ val: boolean; count: number }[]> {
    const metafieldKeyCondition = Prisma.sql`EXISTS (
      SELECT 1 FROM metafield_definitions md
      WHERE md.id = pm.metafield_definition_id AND md.key = ${defKey}
    )`;
    return this.prisma.$queryRaw<{ val: boolean; count: number }[]>(Prisma.sql`
      SELECT pm.value_boolean AS val, COUNT(DISTINCT p.id)::int AS count
      FROM products p
      JOIN product_metafields pm ON pm.product_id = p.id
      WHERE ${metafieldKeyCondition}
        AND ${Prisma.join(allConditions, ' AND ')}
      GROUP BY pm.value_boolean
    `);
  }

  async computeNumericMetafieldRange(defKey: string, allConditions: Prisma.Sql[]): Promise<{ min: number; max: number } | null> {
    const metafieldKeyCondition = Prisma.sql`EXISTS (
      SELECT 1 FROM metafield_definitions md
      WHERE md.id = pm.metafield_definition_id AND md.key = ${defKey}
    )`;
    const results = await this.prisma.$queryRaw<{ min: number; max: number }[]>(Prisma.sql`
      SELECT
        MIN(pm.value_numeric)::numeric AS min,
        MAX(pm.value_numeric)::numeric AS max
      FROM products p
      JOIN product_metafields pm ON pm.product_id = p.id
      WHERE ${metafieldKeyCondition}
        AND ${Prisma.join(allConditions, ' AND ')}
    `);
    return results[0] ?? null;
  }

  async computeTextMetafieldFacets(defKey: string, allConditions: Prisma.Sql[]): Promise<{ value: string; count: number }[]> {
    const metafieldKeyCondition = Prisma.sql`EXISTS (
      SELECT 1 FROM metafield_definitions md
      WHERE md.id = pm.metafield_definition_id AND md.key = ${defKey}
    )`;
    return this.prisma.$queryRaw<{ value: string; count: number }[]>(Prisma.sql`
      SELECT val AS value, COUNT(DISTINCT pid)::int AS count
      FROM (
        SELECT p.id AS pid, pm.value_text AS val
        FROM products p
        JOIN product_metafields pm ON pm.product_id = p.id
        WHERE ${metafieldKeyCondition}
          AND pm.value_text IS NOT NULL
          AND ${Prisma.join(allConditions, ' AND ')}
        UNION ALL
        SELECT p.id AS pid, elem AS val
        FROM products p
        JOIN product_metafields pm ON pm.product_id = p.id,
        jsonb_array_elements_text(pm.value_json) AS elem
        WHERE ${metafieldKeyCondition}
          AND pm.value_json IS NOT NULL
          AND jsonb_typeof(pm.value_json) = 'array'
          AND ${Prisma.join(allConditions, ' AND ')}
      ) AS combined
      GROUP BY val
      ORDER BY count DESC
      LIMIT 50
    `);
  }

  async findCollectionProductCategoryIds(collectionId: string): Promise<string[]> {
    const results = await this.prisma.$queryRaw<{ category_id: string }[]>(Prisma.sql`
      SELECT DISTINCT p.category_id
      FROM products p
      JOIN product_collection_maps pcm ON pcm.product_id = p.id
      WHERE pcm.collection_id = ${collectionId}
        AND p.is_deleted = false
        AND p.status = 'ACTIVE'
        AND p.category_id IS NOT NULL
    `);
    return results.map((r) => r.category_id);
  }

  async findFilterableDefinitions(categoryIds: string[]): Promise<any[]> {
    return this.prisma.metafieldDefinition.findMany({
      where: {
        isActive: true,
        categoryId: { in: categoryIds },
        ownerType: 'CATEGORY',
        type: { in: ['SINGLE_SELECT', 'MULTI_SELECT', 'BOOLEAN', 'COLOR'] },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findBrowsableProducts(sellerId: string, page: number, limit: number, search?: string, categoryId?: string, brandId?: string): Promise<{ products: any[]; total: number }> {
    const mappedProductIds = await this.prisma.sellerProductMapping.findMany({
      where: { sellerId },
      select: { productId: true },
      distinct: ['productId'],
    }).then((m) => m.map((x) => x.productId));

    const where: any = {
      status: 'ACTIVE', moderationStatus: 'APPROVED', isDeleted: false,
    };
    if (mappedProductIds.length > 0) where.id = { notIn: mappedProductIds };
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { productCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: { orderBy: { sortOrder: 'asc' }, take: 1 },
          _count: { select: { variants: { where: { isDeleted: false } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { products, total };
  }
}
