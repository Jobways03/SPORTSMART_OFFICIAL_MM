import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { Prisma } from '@prisma/client';
import { Request } from 'express';

@ApiTags('Storefront - Filters')
@Controller({ path: 'storefront/filters', version: '1' })
export class StorefrontFiltersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CatalogCacheService,
  ) {}

  /**
   * GET /storefront/filters
   * Returns available filter groups with faceted counts for the current context.
   * Query params: categoryId, collectionId, search, + current active filter[key]=value params.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get available storefront filters with faceted counts' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'collectionId', required: false })
  @ApiQuery({ name: 'search', required: false })
  async getFilters(
    @Req() req: Request,
    @Query('categoryId') categoryId?: string,
    @Query('collectionId') collectionId?: string,
    @Query('search') search?: string,
  ) {
    // Parse active filter[key]=value params from query
    const activeFilters = parseFilterParams(req.query as Record<string, string>);

    // 1. Determine which filters are configured for this context
    const filterConfigs = await this.getFilterConfigsForContext(categoryId, collectionId);

    if (filterConfigs.length === 0) {
      return { success: true, message: 'No filters configured', data: { filters: [] } };
    }

    // 2. Build base WHERE conditions (same as product listing, minus metafield filters)
    const baseConditions = this.buildBaseConditions(categoryId, collectionId, search);

    // 3. Compute faceted counts for each filter group
    const filters = [];

    for (const config of filterConfigs) {
      if (config.builtInType) {
        const filter = await this.computeBuiltInFilter(config, baseConditions, activeFilters);
        if (filter) filters.push(filter);
      } else if (config.metafieldDefinition) {
        const filter = await this.computeMetafieldFilter(config, baseConditions, activeFilters);
        if (filter) filters.push(filter);
      }
    }

    return { success: true, message: 'Filters retrieved', data: { filters } };
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private async getFilterConfigsForContext(categoryId?: string, collectionId?: string) {
    const orConditions: any[] = [
      { scopeType: 'GLOBAL' },
      { scopeType: null },
    ];

    if (categoryId) {
      const categoryIds = await this.getCategoryAncestorIds(categoryId);
      orConditions.push({ scopeType: 'CATEGORY', scopeId: { in: categoryIds } });
    }

    if (collectionId) {
      orConditions.push({ scopeType: 'COLLECTION', scopeId: collectionId });
    }

    const manualConfigs = await this.prisma.storefrontFilter.findMany({
      where: {
        isActive: true,
        OR: orConditions,
      },
      include: {
        metafieldDefinition: {
          select: {
            id: true, namespace: true, key: true, name: true, type: true,
            choices: true, ownerType: true, categoryId: true,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    // If manual configs exist, use them as-is
    if (manualConfigs.length > 0) return manualConfigs;

    // ── Auto-generate filters from metafield definitions ──
    // Always include Brand + Price Range as defaults, then add category metafield filters
    const autoConfigs: any[] = [];
    let sortOrder = 0;

    // Default: Brand filter
    autoConfigs.push({
      id: '_auto_brand',
      builtInType: 'brand',
      metafieldDefinitionId: null,
      metafieldDefinition: null,
      label: 'Brand',
      filterType: 'checkbox',
      sortOrder: sortOrder++,
      isActive: true,
      scopeType: 'GLOBAL',
      scopeId: null,
      collapsed: false,
      showCounts: true,
    });

    // Default: Price Range filter
    autoConfigs.push({
      id: '_auto_price',
      builtInType: 'price_range',
      metafieldDefinitionId: null,
      metafieldDefinition: null,
      label: 'Price',
      filterType: 'price_range',
      sortOrder: sortOrder++,
      isActive: true,
      scopeType: 'GLOBAL',
      scopeId: null,
      collapsed: false,
      showCounts: false,
    });

    // Default: Availability filter
    autoConfigs.push({
      id: '_auto_availability',
      builtInType: 'availability',
      metafieldDefinitionId: null,
      metafieldDefinition: null,
      label: 'Availability',
      filterType: 'checkbox',
      sortOrder: sortOrder++,
      isActive: true,
      scopeType: 'GLOBAL',
      scopeId: null,
      collapsed: true,
      showCounts: true,
    });

    // Auto-generate from metafield definitions for the category
    if (categoryId) {
      const categoryIds = await this.getCategoryAncestorIds(categoryId);

      const definitions = await this.prisma.metafieldDefinition.findMany({
        where: {
          isActive: true,
          categoryId: { in: categoryIds },
          ownerType: 'CATEGORY',
          type: { in: ['SINGLE_SELECT', 'MULTI_SELECT', 'BOOLEAN', 'COLOR'] },
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      for (const def of definitions) {
        // Map metafield type to filter type
        let filterType = 'checkbox';
        if (def.type === 'BOOLEAN') filterType = 'boolean_toggle';
        else if (def.type === 'COLOR') filterType = 'color_swatch';

        autoConfigs.push({
          id: `_auto_mf_${def.id}`,
          builtInType: null,
          metafieldDefinitionId: def.id,
          metafieldDefinition: {
            id: def.id,
            namespace: def.namespace,
            key: def.key,
            name: def.name,
            type: def.type,
            choices: def.choices,
            ownerType: def.ownerType,
            categoryId: def.categoryId,
          },
          label: def.name,
          filterType,
          sortOrder: sortOrder++,
          isActive: true,
          scopeType: 'CATEGORY',
          scopeId: categoryId,
          collapsed: false,
          showCounts: true,
        });
      }
    }

    // For collections without a category: get definitions from products in the collection
    if (collectionId && !categoryId) {
      // Find category IDs of products in this collection
      const productCategories = await this.prisma.$queryRaw<{ category_id: string }[]>(Prisma.sql`
        SELECT DISTINCT p.category_id
        FROM products p
        JOIN product_collection_maps pcm ON pcm.product_id = p.id
        WHERE pcm.collection_id = ${collectionId}
          AND p.is_deleted = false
          AND p.status = 'ACTIVE'
          AND p.category_id IS NOT NULL
      `);

      if (productCategories.length > 0) {
        const allCategoryIds = productCategories.map((pc) => pc.category_id);

        const definitions = await this.prisma.metafieldDefinition.findMany({
          where: {
            isActive: true,
            categoryId: { in: allCategoryIds },
            ownerType: 'CATEGORY',
            type: { in: ['SINGLE_SELECT', 'MULTI_SELECT', 'BOOLEAN', 'COLOR'] },
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });

        // Deduplicate by key — merge choices and definition IDs across categories
        const keyMap = new Map<string, { def: typeof definitions[0]; allDefIds: string[]; mergedChoices: any[] }>();
        for (const def of definitions) {
          if (keyMap.has(def.key)) {
            const existing = keyMap.get(def.key)!;
            existing.allDefIds.push(def.id);
            // Merge choices (deduplicate by value)
            if (def.choices && Array.isArray(def.choices)) {
              const existingValues = new Set(existing.mergedChoices.map((c: any) => c.value));
              for (const choice of def.choices as any[]) {
                if (!existingValues.has(choice.value)) {
                  existing.mergedChoices.push(choice);
                }
              }
            }
          } else {
            keyMap.set(def.key, {
              def,
              allDefIds: [def.id],
              mergedChoices: def.choices && Array.isArray(def.choices) ? [...def.choices as any[]] : [],
            });
          }
        }

        for (const [, { def, allDefIds, mergedChoices }] of keyMap) {
          let filterType = 'checkbox';
          if (def.type === 'BOOLEAN') filterType = 'boolean_toggle';
          else if (def.type === 'COLOR') filterType = 'color_swatch';

          autoConfigs.push({
            id: `_auto_mf_${def.id}`,
            builtInType: null,
            metafieldDefinitionId: def.id,
            metafieldDefinition: {
              id: def.id,
              allDefIds,
              namespace: def.namespace,
              key: def.key,
              name: def.name,
              type: def.type,
              choices: mergedChoices.length > 0 ? mergedChoices : def.choices,
              ownerType: def.ownerType,
              categoryId: def.categoryId,
            },
            label: def.name,
            filterType,
            sortOrder: sortOrder++,
            isActive: true,
            scopeType: 'COLLECTION',
            scopeId: collectionId,
            collapsed: false,
            showCounts: true,
          });
        }
      }
    }

    return autoConfigs;
  }

  private async getCategoryAncestorIds(categoryId: string): Promise<string[]> {
    const ids: string[] = [];
    let current = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, parentId: true },
    });
    while (current) {
      ids.push(current.id);
      current = current.parentId
        ? await this.prisma.category.findUnique({
            where: { id: current.parentId },
            select: { id: true, parentId: true },
          })
        : null;
    }
    return ids;
  }

  private buildBaseConditions(categoryId?: string, collectionId?: string, search?: string): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p.is_deleted = false`,
      Prisma.sql`p.status = 'ACTIVE'`,
      Prisma.sql`EXISTS (
        SELECT 1 FROM seller_product_mappings spm
        WHERE spm.product_id = p.id
          AND spm.is_active = true
          AND spm.approval_status = 'APPROVED'
          AND (spm.stock_qty - spm.reserved_qty) > 0
      )`,
    ];

    if (categoryId) {
      conditions.push(Prisma.sql`p.category_id = ${categoryId}`);
    }

    if (collectionId) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM product_collection_maps pcm
        WHERE pcm.product_id = p.id AND pcm.collection_id = ${collectionId}
      )`);
    }

    if (search) {
      const pattern = `%${search}%`;
      conditions.push(Prisma.sql`(
        p.title ILIKE ${pattern}
        OR p.short_description ILIKE ${pattern}
        OR p.product_code ILIKE ${pattern}
      )`);
    }

    return conditions;
  }

  /**
   * Build metafield filter conditions for all active filters EXCEPT the one being computed
   * (disjunctive faceting — counts for "material" should not be filtered by material selection)
   */
  private buildOtherMetafieldConditions(
    activeFilters: Map<string, string[]>,
    excludeKey: string,
  ): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];

    for (const [key, values] of activeFilters.entries()) {
      if (key === excludeKey || key.startsWith('_')) continue; // skip excluded and built-in prefixes

      if (values.length === 1) {
        conditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM product_metafields pm
          JOIN metafield_definitions md ON md.id = pm.metafield_definition_id
          WHERE pm.product_id = p.id
            AND md.key = ${key}
            AND (pm.value_text = ${values[0]} OR pm.value_json @> ${JSON.stringify(values)}::jsonb)
        )`);
      } else if (values.length > 0) {
        conditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM product_metafields pm
          JOIN metafield_definitions md ON md.id = pm.metafield_definition_id
          WHERE pm.product_id = p.id
            AND md.key = ${key}
            AND (pm.value_text IN (${Prisma.join(values)}) OR pm.value_json ?| array[${Prisma.join(values)}])
        )`);
      }
    }

    return conditions;
  }

  private async computeBuiltInFilter(
    config: any,
    baseConditions: Prisma.Sql[],
    activeFilters: Map<string, string[]>,
  ) {
    const allOtherConditions = this.buildOtherMetafieldConditions(activeFilters, `_${config.builtInType}`);
    const allConditions = [...baseConditions, ...allOtherConditions];
    const whereClause = allConditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(allConditions, ' AND ')}`
      : Prisma.sql``;

    switch (config.builtInType) {
      case 'brand': {
        const results = await this.prisma.$queryRaw<{ value: string; label: string; count: number }[]>(Prisma.sql`
          SELECT b.id AS value, b.name AS label, COUNT(DISTINCT p.id)::int AS count
          FROM products p
          JOIN brands b ON b.id = p.brand_id
          ${whereClause}
          GROUP BY b.id, b.name
          HAVING COUNT(DISTINCT p.id) > 0
          ORDER BY count DESC
          LIMIT 50
        `);
        if (results.length === 0) return null;
        return {
          key: 'brand',
          label: config.label,
          type: config.filterType,
          builtIn: true,
          collapsed: config.collapsed,
          showCounts: config.showCounts,
          values: results,
        };
      }

      case 'price_range': {
        const results = await this.prisma.$queryRaw<{ min: number; max: number }[]>(Prisma.sql`
          SELECT
            MIN(COALESCE(p.platform_price, p.base_price, 0))::numeric AS min,
            MAX(COALESCE(p.platform_price, p.base_price, 0))::numeric AS max
          FROM products p
          ${whereClause}
        `);
        const range = results[0];
        if (!range || (range.min === 0 && range.max === 0)) return null;
        return {
          key: 'price_range',
          label: config.label,
          type: 'price_range',
          builtIn: true,
          collapsed: config.collapsed,
          showCounts: config.showCounts,
          range: { min: Number(range.min), max: Number(range.max) },
        };
      }

      case 'availability': {
        // Count in-stock and out-of-stock products
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
        return {
          key: 'availability',
          label: config.label,
          type: 'checkbox',
          builtIn: true,
          collapsed: config.collapsed,
          showCounts: config.showCounts,
          values: [
            { value: 'in_stock', label: 'In Stock', count: results[0]?.in_stock ?? 0 },
            { value: 'out_of_stock', label: 'Out of Stock', count: results[0]?.out_of_stock ?? 0 },
          ],
        };
      }

      default:
        return null;
    }
  }

  private async computeMetafieldFilter(
    config: any,
    baseConditions: Prisma.Sql[],
    activeFilters: Map<string, string[]>,
  ) {
    const def = config.metafieldDefinition;
    if (!def) return null;

    const otherConditions = this.buildOtherMetafieldConditions(activeFilters, def.key);
    const allConditions = [...baseConditions, ...otherConditions];
    const whereClause = Prisma.sql`WHERE ${Prisma.join(allConditions, ' AND ')}`;

    // Use key-based matching to find metafield values across all categories with the same key
    const defKey = def.key;
    const metafieldKeyCondition = Prisma.sql`EXISTS (
      SELECT 1 FROM metafield_definitions md
      WHERE md.id = pm.metafield_definition_id AND md.key = ${defKey}
    )`;

    if (def.type === 'BOOLEAN') {
      const results = await this.prisma.$queryRaw<{ val: boolean; count: number }[]>(Prisma.sql`
        SELECT pm.value_boolean AS val, COUNT(DISTINCT p.id)::int AS count
        FROM products p
        JOIN product_metafields pm ON pm.product_id = p.id
        WHERE ${metafieldKeyCondition}
          AND ${Prisma.join(allConditions, ' AND ')}
        GROUP BY pm.value_boolean
      `);

      return {
        key: def.key,
        label: config.label,
        type: config.filterType,
        builtIn: false,
        definitionId: def.id,
        collapsed: config.collapsed,
        showCounts: config.showCounts,
        counts: {
          true: results.find((r) => r.val === true)?.count ?? 0,
          false: results.find((r) => r.val === false)?.count ?? 0,
        },
      };
    }

    if (def.type === 'NUMBER_INTEGER' || def.type === 'NUMBER_DECIMAL' || def.type === 'RATING') {
      const results = await this.prisma.$queryRaw<{ min: number; max: number }[]>(Prisma.sql`
        SELECT
          MIN(pm.value_numeric)::numeric AS min,
          MAX(pm.value_numeric)::numeric AS max
        FROM products p
        JOIN product_metafields pm ON pm.product_id = p.id
        WHERE ${metafieldKeyCondition}
          AND ${Prisma.join(allConditions, ' AND ')}
      `);

      const range = results[0];
      if (!range) return null;

      return {
        key: def.key,
        label: config.label,
        type: config.filterType,
        builtIn: false,
        definitionId: def.id,
        collapsed: config.collapsed,
        showCounts: config.showCounts,
        range: { min: Number(range.min), max: Number(range.max) },
      };
    }

    // Text-based select types (SINGLE_SELECT, MULTI_SELECT, COLOR, etc.)
    // Use a unified query that pulls from BOTH value_text and value_json,
    // since the same key can be SINGLE_SELECT in one category and MULTI_SELECT in another.
    if (['SINGLE_LINE_TEXT', 'SINGLE_SELECT', 'MULTI_SELECT', 'COLOR', 'URL', 'FILE_REFERENCE'].includes(def.type)) {
      const results = await this.prisma.$queryRaw<{ value: string; count: number }[]>(Prisma.sql`
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

      if (results.length === 0) return null;

      // Enrich with choice labels from merged choices
      const choiceMap = new Map<string, string>();
      if (def.choices && Array.isArray(def.choices)) {
        for (const choice of def.choices as any[]) {
          choiceMap.set(choice.value, choice.label || choice.value);
        }
      }

      return {
        key: def.key,
        label: config.label,
        type: config.filterType,
        builtIn: false,
        definitionId: def.id,
        collapsed: config.collapsed,
        showCounts: config.showCounts,
        values: results.map((r) => ({
          value: r.value,
          label: choiceMap.get(r.value) || r.value,
          count: r.count,
          ...(def.type === 'COLOR' ? { colorHex: r.value } : {}),
        })),
      };
    }

    return null;
  }
}

// ─── Filter param parser ──────────────────────────────────────────────

function parseFilterParams(query: Record<string, any>): Map<string, string[]> {
  const filters = new Map<string, string[]>();

  for (const [rawKey, rawValue] of Object.entries(query)) {
    const match = rawKey.match(/^filter\[(\w+)\]$/);
    if (match && rawValue) {
      const key = match[1];
      const values = String(rawValue).split(',').map((v) => v.trim()).filter(Boolean);
      if (values.length > 0) {
        filters.set(key, values);
      }
    }
  }

  return filters;
}
