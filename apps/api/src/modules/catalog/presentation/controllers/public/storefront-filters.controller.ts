import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { CatalogCacheService } from '../../../application/services/catalog-cache.service';
import { StorefrontFilterValidatorService } from '../../../application/services/storefront-filter-validator.service';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../../domain/repositories/category.repository.interface';

/**
 * Phase 40 (2026-05-21) — full rewrite to close storefront filter
 * audit gaps:
 *
 *  #3  Auto-fallback is now ADDITIVE. Manual StorefrontFilter rows are
 *      treated as scope-specific OVERRIDES (label / filterType /
 *      collapsed) and don't disable the rest of the auto-generated
 *      set. Pre-Phase-40 creating one custom filter silently dropped
 *      every other category-metafield filter for that scope.
 *
 *  #6 #11 buildOtherMetafieldConditions now takes the bare built-in
 *      key (`brand`, `availability`) instead of `_brand` etc. — the
 *      underscore prefix never matched any active filter key so the
 *      exclude was a no-op and brand-on-brand facets were wrong.
 *
 *  #10 Filter values are validated against the metafield definition's
 *      choices list (when present) and against the type's expected
 *      shape. Invalid values are dropped (not 400'd) — matching the
 *      tolerant "permalinks always render" UX of e-commerce SERPs.
 *
 *  #12 The whole response is cached 60s per (categoryId, collectionId,
 *      search, active filter values) tuple via CatalogCacheService.
 *      Invalidated by every admin filter mutation + metafield
 *      filterable-flag toggle.
 *
 *  #19 Filter values are Unicode-normalized (NFKC) so visual
 *      look-alikes (Cyrillic 'о' / Latin 'o') collapse into the same
 *      bucket.
 */

@ApiTags('Storefront - Filters')
@Controller({ path: 'storefront/filters', version: '1' })
export class StorefrontFiltersController {
  constructor(
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
    private readonly cache: CatalogCacheService,
    private readonly filterValidator: StorefrontFilterValidatorService,
  ) {}

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
    const rawFilters = parseFilterParams(req.query as Record<string, string>);

    // Phase 40 (2026-05-21) — Gap #10. Validate each value against
    // the definition's choices[] before the facet/cache step. Invalid
    // values are dropped silently — the SERP still renders, the
    // remaining filters apply. See StorefrontFilterValidatorService.
    const activeFilters = await this.filterValidator.scrub(rawFilters, categoryId);

    // Phase 40 — cache key includes the active-filter map so the
    // disjunctive facet counts (which depend on what's selected)
    // stay coherent.
    const cacheKey = {
      categoryId: categoryId ?? null,
      collectionId: collectionId ?? null,
      search: search ?? null,
      activeFilters: JSON.stringify(Array.from(activeFilters.entries()).sort()),
    };

    const result = await this.cache.getOrSetFilters(cacheKey, async () => {
      const filterConfigs = await this.getFilterConfigsForContext(categoryId, collectionId);

      if (filterConfigs.length === 0) {
        return { filters: [] as unknown[] };
      }

      const baseConditions = this.buildBaseConditions(categoryId, collectionId, search);

      const filters: unknown[] = [];
      for (const config of filterConfigs) {
        if (config.builtInType) {
          const filter = await this.computeBuiltInFilter(config, baseConditions, activeFilters);
          if (filter) filters.push(filter);
        } else if (config.metafieldDefinition) {
          const filter = await this.computeMetafieldFilter(config, baseConditions, activeFilters);
          if (filter) filters.push(filter);
        }
      }

      return { filters };
    });

    return { success: true, message: 'Filters retrieved', data: result };
  }

  // ─── Private helpers ──────────────────────────────────────────────

  /**
   * Phase 40 — additive resolution:
   *
   *   1. Build the base auto-generated set (brand, price_range,
   *      availability, plus every isFilterable=true CATEGORY metafield
   *      in the ancestor chain).
   *   2. Fetch the manual configs in scope.
   *   3. For each manual config, REPLACE the matching auto entry
   *      (matched by builtInType for built-ins, by
   *      metafieldDefinitionId for metafield ones). If no match: add
   *      to the end as an extra config.
   *
   * Result: admin overrides per-scope (label, type, collapsed,
   * showCounts, sortOrder) without disabling the rest of the set.
   */
  private async getFilterConfigsForContext(categoryId?: string, collectionId?: string) {
    const autoConfigs = await this.buildAutoConfigs(categoryId, collectionId);

    const scopeOr: any[] = [
      { scopeType: 'GLOBAL' },
      { scopeType: null },
    ];
    if (categoryId) {
      const categoryIds = await this.categoryRepo.findAncestorIds(categoryId);
      scopeOr.push({ scopeType: 'CATEGORY', scopeId: { in: categoryIds } });
    }
    if (collectionId) {
      scopeOr.push({ scopeType: 'COLLECTION', scopeId: collectionId });
    }

    const manualConfigs = await this.storefrontRepo.findFilterConfigs({
      isActive: true,
      OR: scopeOr,
    });

    if (manualConfigs.length === 0) return autoConfigs;

    // Index manual configs by what they override.
    const builtInOverrides = new Map<string, any>();
    const mfOverrides = new Map<string, any>();
    const extras: any[] = [];
    for (const mc of manualConfigs) {
      if (mc.builtInType) {
        builtInOverrides.set(mc.builtInType, mc);
      } else if (mc.metafieldDefinitionId) {
        mfOverrides.set(mc.metafieldDefinitionId, mc);
      } else {
        extras.push(mc);
      }
    }

    const merged = autoConfigs.map((auto: any) => {
      if (auto.builtInType && builtInOverrides.has(auto.builtInType)) {
        const ovr = builtInOverrides.get(auto.builtInType);
        builtInOverrides.delete(auto.builtInType);
        return { ...auto, ...this.pickOverrideFields(ovr), id: ovr.id };
      }
      if (auto.metafieldDefinitionId && mfOverrides.has(auto.metafieldDefinitionId)) {
        const ovr = mfOverrides.get(auto.metafieldDefinitionId);
        mfOverrides.delete(auto.metafieldDefinitionId);
        return { ...auto, ...this.pickOverrideFields(ovr), id: ovr.id };
      }
      return auto;
    });

    // Manual configs that didn't match any auto entry — append.
    for (const ovr of builtInOverrides.values()) merged.push(ovr);
    for (const ovr of mfOverrides.values()) merged.push(ovr);
    merged.push(...extras);

    // Stable sort by sortOrder so admin's explicit ordering wins.
    merged.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    return merged;
  }

  /**
   * Phase 40 — fields a manual config is allowed to override on the
   * auto-generated entry. We don't let an override change
   * metafieldDefinitionId / builtInType — that'd be a different
   * filter entirely, not an override.
   */
  private pickOverrideFields(ovr: any): Record<string, unknown> {
    return {
      label: ovr.label,
      filterType: ovr.filterType,
      sortOrder: ovr.sortOrder,
      collapsed: ovr.collapsed,
      showCounts: ovr.showCounts,
      isActive: ovr.isActive,
    };
  }

  private async buildAutoConfigs(categoryId?: string, collectionId?: string) {
    const autoConfigs: any[] = [];
    let sortOrder = 0;

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

    if (categoryId) {
      const categoryIds = await this.categoryRepo.findAncestorIds(categoryId);
      const definitions = await this.storefrontRepo.findFilterableDefinitions(categoryIds);
      for (const def of definitions) {
        autoConfigs.push(this.metafieldDefinitionToAutoConfig(def, sortOrder++, 'CATEGORY', categoryId));
      }
    }

    if (collectionId && !categoryId) {
      const allCategoryIds = await this.storefrontRepo.findCollectionProductCategoryIds(collectionId);
      if (allCategoryIds.length > 0) {
        const definitions = await this.storefrontRepo.findFilterableDefinitions(allCategoryIds);
        // Dedupe by key — merge choices across categories so the
        // collection page shows one filter per distinct attribute.
        const keyMap = new Map<string, { def: any; allDefIds: string[]; mergedChoices: any[] }>();
        for (const def of definitions) {
          if (keyMap.has(def.key)) {
            const existing = keyMap.get(def.key)!;
            existing.allDefIds.push(def.id);
            if (def.choices && Array.isArray(def.choices)) {
              const existingValues = new Set(existing.mergedChoices.map((c: any) => c.value));
              for (const choice of def.choices as any[]) {
                if (!existingValues.has(choice.value)) existing.mergedChoices.push(choice);
              }
            }
          } else {
            keyMap.set(def.key, {
              def,
              allDefIds: [def.id],
              mergedChoices: def.choices && Array.isArray(def.choices) ? [...(def.choices as any[])] : [],
            });
          }
        }
        for (const [, { def, allDefIds, mergedChoices }] of keyMap) {
          autoConfigs.push(this.metafieldDefinitionToAutoConfig(
            { ...def, choices: mergedChoices.length > 0 ? mergedChoices : def.choices, allDefIds },
            sortOrder++,
            'COLLECTION',
            collectionId,
          ));
        }
      }
    }

    return autoConfigs;
  }

  /**
   * Phase 40 — translate a MetafieldDefinition row into an auto-generated
   * filter config. defaultFilterType / defaultFilterLabel from the
   * definition override the per-type default.
   */
  private metafieldDefinitionToAutoConfig(def: any, sortOrder: number, scopeType: string, scopeId: string) {
    let filterType = 'checkbox';
    if (def.type === 'BOOLEAN') filterType = 'boolean_toggle';
    else if (def.type === 'COLOR') filterType = 'color_swatch';
    else if (def.type === 'NUMBER_INTEGER' || def.type === 'NUMBER_DECIMAL' || def.type === 'RATING') {
      filterType = 'price_range'; // numeric range; UI renders as range slider
    }
    if (def.defaultFilterType) filterType = def.defaultFilterType;

    return {
      id: `_auto_mf_${def.id}`,
      builtInType: null,
      metafieldDefinitionId: def.id,
      metafieldDefinition: {
        id: def.id,
        allDefIds: def.allDefIds,
        namespace: def.namespace,
        key: def.key,
        name: def.name,
        type: def.type,
        choices: def.choices,
        ownerType: def.ownerType,
        categoryId: def.categoryId,
      },
      label: def.defaultFilterLabel || def.name,
      filterType,
      sortOrder,
      isActive: true,
      scopeType,
      scopeId,
      collapsed: false,
      showCounts: true,
    };
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

    if (categoryId) conditions.push(Prisma.sql`p.category_id = ${categoryId}`);

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
   * Phase 40 — disjunctive faceting. When computing the facet count
   * for filter X, apply every OTHER active filter so the count
   * reflects "would I narrow further if I also picked this?". Gap #6
   * fix: takes the bare key (e.g. `brand`) not `_brand`.
   */
  private buildOtherMetafieldConditions(
    activeFilters: Map<string, string[]>,
    excludeKey: string,
  ): Prisma.Sql[] {
    const BUILT_IN_KEYS = new Set(['brand', 'availability', 'price_range']);
    const conditions: Prisma.Sql[] = [];

    for (const [key, values] of activeFilters.entries()) {
      if (key === excludeKey) continue;
      if (BUILT_IN_KEYS.has(key)) continue; // built-in filter facets are computed separately

      const normalized = values.map((v) => v.normalize('NFKC')).filter(Boolean);
      if (normalized.length === 0) continue;

      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM product_metafields pm
        JOIN metafield_definitions md ON md.id = pm.metafield_definition_id
        WHERE pm.product_id = p.id
          AND md.key = ${key}
          AND (
            (md.type IN ('SINGLE_LINE_TEXT','MULTI_LINE_TEXT','SINGLE_SELECT','COLOR','URL','FILE_REFERENCE')
              AND pm.value_text IS NOT NULL
              AND pm.value_text IN (${Prisma.join(normalized)}))
            OR
            (md.type = 'MULTI_SELECT'
              AND pm.value_json IS NOT NULL
              AND pm.value_json ?| array[${Prisma.join(normalized)}])
          )
      )`);
    }

    return conditions;
  }

  private async computeBuiltInFilter(
    config: any,
    baseConditions: Prisma.Sql[],
    activeFilters: Map<string, string[]>,
  ) {
    // Phase 40 — Gap #6 fix: bare key, not `_${builtInType}`.
    const otherConditions = this.buildOtherMetafieldConditions(activeFilters, config.builtInType);

    switch (config.builtInType) {
      case 'brand': {
        const results = await this.storefrontRepo.computeBrandFacets(baseConditions, otherConditions);
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
        const range = await this.storefrontRepo.computePriceRange(baseConditions, otherConditions);
        if (!range) return null;
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
        const result = await this.storefrontRepo.computeAvailabilityFacets(baseConditions);
        return {
          key: 'availability',
          label: config.label,
          type: 'checkbox',
          builtIn: true,
          collapsed: config.collapsed,
          showCounts: config.showCounts,
          values: [
            { value: 'in_stock', label: 'In Stock', count: result.in_stock },
            { value: 'out_of_stock', label: 'Out of Stock', count: result.out_of_stock },
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
    const defKey = def.key;

    if (def.type === 'BOOLEAN') {
      const results = await this.storefrontRepo.computeBooleanMetafieldFacets(defKey, allConditions);
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
      const range = await this.storefrontRepo.computeNumericMetafieldRange(defKey, allConditions);
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

    if (['SINGLE_LINE_TEXT', 'SINGLE_SELECT', 'MULTI_SELECT', 'COLOR', 'URL', 'FILE_REFERENCE'].includes(def.type)) {
      const results = await this.storefrontRepo.computeTextMetafieldFacets(defKey, allConditions);
      if (results.length === 0) return null;

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

/**
 * Phase 40 — NFKC-normalize each filter value at the entry boundary.
 * Trimmed + non-empty values only. Audit gap #19.
 */
export function parseFilterParams(query: Record<string, any>): Map<string, string[]> {
  const filters = new Map<string, string[]>();

  for (const [rawKey, rawValue] of Object.entries(query)) {
    const match = rawKey.match(/^filter\[(\w+)\]$/);
    if (match && rawValue) {
      const key = match[1]!;
      const values = String(rawValue)
        .split(',')
        .map((v) => v.trim().normalize('NFKC'))
        .filter(Boolean);
      if (values.length > 0) filters.set(key, values);
    }
  }

  return filters;
}
