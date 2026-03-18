import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../../../bootstrap/database/prisma.service';

@ApiTags('Catalog')
@Controller('catalog')
export class CatalogReferenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  async getCategories() {
    const categories = await this.prisma.category.findMany({
      where: { parentId: null, isActive: true },
      include: {
        children: {
          where: { isActive: true },
          include: {
            children: {
              where: { isActive: true },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      success: true,
      message: 'Categories retrieved successfully',
      data: categories,
    };
  }

  @Get('categories/:categoryId/options')
  @HttpCode(HttpStatus.OK)
  async getCategoryOptions(@Param('categoryId') categoryId: string) {
    const templates = await this.prisma.categoryOptionTemplate.findMany({
      where: { categoryId },
      include: {
        optionDefinition: {
          include: {
            values: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      success: true,
      message: 'Category options retrieved successfully',
      data: templates,
    };
  }

  @Get('brands')
  @HttpCode(HttpStatus.OK)
  async getBrands(@Query('search') search?: string) {
    const brands = await this.prisma.brand.findMany({
      where: {
        isActive: true,
        ...(search
          ? { name: { contains: search, mode: 'insensitive' as const } }
          : {}),
      },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      message: 'Brands retrieved successfully',
      data: brands,
    };
  }

  @Get('options')
  @HttpCode(HttpStatus.OK)
  async getOptions() {
    const options = await this.prisma.optionDefinition.findMany({
      include: {
        values: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return {
      success: true,
      message: 'Options retrieved successfully',
      data: options,
    };
  }
}
