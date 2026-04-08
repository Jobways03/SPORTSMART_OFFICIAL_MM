import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';
import {
  NotFoundAppException,
  BadRequestAppException,
} from '../../../../../core/exceptions';
import { AdminAuthGuard } from '../../../../../core/guards';

// Maps MetafieldType → which value column to use
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
  constructor(private readonly prisma: PrismaService) {}

  // ─── Get all metafield values for a product ───────────────────────

  @Get(':productId/metafields')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get all metafield values for a product' })
  async getMetafields(@Param('productId') productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
      select: { id: true, categoryId: true },
    });
    if (!product) throw new NotFoundAppException('Product not found');

    // Fetch existing values
    const metafields = await this.prisma.productMetafield.findMany({
      where: { productId },
      include: {
        metafieldDefinition: {
          select: {
            id: true, namespace: true, key: true, name: true, description: true,
            type: true, choices: true, validations: true, ownerType: true,
            categoryId: true, pinned: true, sortOrder: true, isRequired: true,
          },
        },
      },
      orderBy: { metafieldDefinition: { sortOrder: 'asc' } },
    });

    // Get available definitions for this product's category (with inheritance)
    let availableDefinitions: any[] = [];
    if (product.categoryId) {
      const categoryIds: string[] = [];
      let current: any = await this.prisma.category.findUnique({ where: { id: product.categoryId } });
      while (current) {
        categoryIds.push(current.id);
        current = current.parentId
          ? await this.prisma.category.findUnique({ where: { id: current.parentId } })
          : null;
      }

      availableDefinitions = await this.prisma.metafieldDefinition.findMany({
        where: {
          isActive: true,
          OR: [
            { categoryId: { in: categoryIds }, ownerType: 'CATEGORY' },
            { ownerType: 'CUSTOM' },
          ],
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
    } else {
      // No category — only show custom definitions
      availableDefinitions = await this.prisma.metafieldDefinition.findMany({
        where: { isActive: true, ownerType: 'CUSTOM' },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
    }

    // Merge: return all available definitions with their current value (if any)
    const existingMap = new Map(metafields.map((m) => [m.metafieldDefinitionId, m]));
    const merged = availableDefinitions.map((def) => {
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
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isDeleted: false },
    });
    if (!product) throw new NotFoundAppException('Product not found');

    if (!body.metafields || !Array.isArray(body.metafields)) {
      throw new BadRequestAppException('metafields array is required');
    }

    const results = [];
    const errors = [];

    for (const { definitionId, value } of body.metafields) {
      try {
        const definition = await this.prisma.metafieldDefinition.findUnique({
          where: { id: definitionId },
        });
        if (!definition) {
          errors.push({ definitionId, error: 'Definition not found' });
          continue;
        }

        // If value is null/undefined/empty, delete the metafield
        if (value === null || value === undefined || value === '') {
          await this.prisma.productMetafield.deleteMany({
            where: { productId, metafieldDefinitionId: definitionId },
          });
          results.push({ definitionId, action: 'deleted' });
          continue;
        }

        // Build the value columns
        const valueData = buildValueData(definition.type, value);

        const metafield = await this.prisma.productMetafield.upsert({
          where: {
            productId_metafieldDefinitionId: { productId, metafieldDefinitionId: definitionId },
          },
          create: {
            productId,
            metafieldDefinitionId: definitionId,
            ...valueData,
          },
          update: {
            ...valueData,
          },
        });

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
    const metafield = await this.prisma.productMetafield.findFirst({
      where: { id: metafieldId, productId },
    });
    if (!metafield) throw new NotFoundAppException('Product metafield not found');

    await this.prisma.productMetafield.delete({ where: { id: metafieldId } });

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
