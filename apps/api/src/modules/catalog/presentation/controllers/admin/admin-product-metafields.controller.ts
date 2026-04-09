import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../../core/guards';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../../domain/repositories/product.repository.interface';
import { METAFIELD_REPOSITORY, IMetafieldRepository } from '../../../domain/repositories/metafield.repository.interface';

// Maps MetafieldType -> which value column to use
const TYPE_COLUMN_MAP: Record<string, string> = {
  SINGLE_LINE_TEXT: 'valueText',
  MULTI_LINE_TEXT: 'valueText',
  COLOR: 'valueText',
  URL: 'valueText',
  FILE_REFERENCE: 'valueText',
  NUMBER_INTEGER: 'valueNumeric',
  NUMBER_DECIMAL: 'valueNumeric',
  RATING: 'valueNumeric',
  BOOLEAN: 'valueBoolean',
  DATE: 'valueDate',
  SINGLE_SELECT: 'valueText',
  MULTI_SELECT: 'valueJson',
  DIMENSION: 'valueJson',
  WEIGHT: 'valueJson',
  VOLUME: 'valueJson',
  JSON: 'valueJson',
};

@ApiTags('Admin - Product Metafields')
@Controller({ path: 'admin/products', version: '1' })
@UseGuards(AdminAuthGuard)
export class AdminProductMetafieldsController {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly productRepo: IProductRepository,
    @Inject(METAFIELD_REPOSITORY) private readonly metafieldRepo: IMetafieldRepository,
  ) {}

  // ─── Get all metafield values for a product ───────────────────────

  @Get(':productId/metafields')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all metafield values for a product' })
  async getMetafields(@Param('productId') productId: string) {
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');

    // Fetch existing values
    const metafields = await this.metafieldRepo.findProductMetafields(productId);

    // Get available definitions for this product's category (with inheritance)
    const availableDefinitions = await this.metafieldRepo.findAvailableDefinitions(product.categoryId ?? null);

    // Merge: return all available definitions with their current value (if any)
    const existingMap = new Map(metafields.map((m: any) => [m.metafieldDefinitionId, m]));
    const merged = availableDefinitions.map((def: any) => {
      const existing = existingMap.get(def.id);
      return {
        definition: def,
        metafieldId: existing?.id || null,
        value: existing ? extractValue(def.type, existing) : null,
        hasValue: !!existing,
      };
    });

    return {
      success: true,
      message: 'Product metafields retrieved',
      data: { productId, metafields: merged, total: merged.length },
    };
  }

  // ─── Bulk upsert metafield values ────────────────────────────────

  @Put(':productId/metafields')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk upsert metafield values for a product' })
  async upsertMetafields(
    @Param('productId') productId: string,
    @Body() body: { metafields: Array<{ definitionId: string; value: any }> },
  ) {
    const product = await this.productRepo.findByIdBasic(productId);
    if (!product) throw new NotFoundAppException('Product not found');

    if (!body.metafields || !Array.isArray(body.metafields)) {
      throw new BadRequestAppException('metafields array is required');
    }

    const results = [];
    const errors = [];

    for (const { definitionId, value } of body.metafields) {
      try {
        const definition = await this.metafieldRepo.findDefinitionById(definitionId);
        if (!definition) {
          errors.push({ definitionId, error: 'Definition not found' });
          continue;
        }

        // If value is null/undefined/empty, delete the metafield
        if (value === null || value === undefined || value === '') {
          await this.metafieldRepo.deleteProductMetafieldByDefinition(productId, definitionId);
          results.push({ definitionId, action: 'deleted' });
          continue;
        }

        // Build the value columns
        const valueData = buildValueData(definition.type, value);

        const metafield = await this.metafieldRepo.upsertProductMetafield(productId, definitionId, valueData);

        results.push({ definitionId, action: 'upserted', metafieldId: metafield.id });
      } catch (err: any) {
        errors.push({ definitionId, error: err.message });
      }
    }

    return {
      success: true,
      message: `Processed ${results.length} metafields, ${errors.length} errors`,
      data: { results, errors },
    };
  }

  // ─── Delete a specific metafield value ───────────────────────────

  @Delete(':productId/metafields/:metafieldId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a specific product metafield value' })
  async deleteMetafield(
    @Param('productId') productId: string,
    @Param('metafieldId') metafieldId: string,
  ) {
    const metafield = await this.metafieldRepo.findProductMetafield(metafieldId, productId);
    if (!metafield) throw new NotFoundAppException('Product metafield not found');

    await this.metafieldRepo.deleteProductMetafield(metafieldId);

    return { success: true, message: 'Product metafield deleted' };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractValue(type: string, metafield: any): any {
  const col = TYPE_COLUMN_MAP[type];
  if (!col) return null;
  return metafield[col];
}

function buildValueData(type: string, value: any): Record<string, any> {
  // Reset all value columns
  const data: Record<string, any> = {
    valueText: null,
    valueNumeric: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
  };

  switch (type) {
    case 'SINGLE_LINE_TEXT':
    case 'MULTI_LINE_TEXT':
    case 'COLOR':
    case 'URL':
    case 'FILE_REFERENCE':
    case 'SINGLE_SELECT':
      data.valueText = String(value);
      break;
    case 'NUMBER_INTEGER':
      data.valueNumeric = parseInt(value, 10);
      if (isNaN(data.valueNumeric)) throw new Error('Invalid integer value');
      break;
    case 'NUMBER_DECIMAL':
    case 'RATING':
      data.valueNumeric = parseFloat(value);
      if (isNaN(data.valueNumeric)) throw new Error('Invalid numeric value');
      break;
    case 'BOOLEAN':
      data.valueBoolean = value === true || value === 'true';
      break;
    case 'DATE':
      data.valueDate = new Date(value);
      if (isNaN(data.valueDate.getTime())) throw new Error('Invalid date value');
      break;
    case 'MULTI_SELECT':
      data.valueJson = Array.isArray(value) ? value : [value];
      break;
    case 'DIMENSION':
    case 'WEIGHT':
    case 'VOLUME':
    case 'JSON':
      data.valueJson = typeof value === 'string' ? JSON.parse(value) : value;
      break;
    default:
      data.valueText = String(value);
  }

  return data;
}
