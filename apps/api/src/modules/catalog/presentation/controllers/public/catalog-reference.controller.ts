import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { CATEGORY_REPOSITORY, ICategoryRepository } from '../../../domain/repositories/category.repository.interface';
import { BRAND_REPOSITORY, IBrandRepository } from '../../../domain/repositories/brand.repository.interface';
import { STOREFRONT_REPOSITORY, IStorefrontRepository } from '../../../domain/repositories/storefront.repository.interface';

@ApiTags('Catalog')
@Controller('catalog')
export class CatalogReferenceController {
  constructor(
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepo: ICategoryRepository,
    @Inject(BRAND_REPOSITORY) private readonly brandRepo: IBrandRepository,
    @Inject(STOREFRONT_REPOSITORY) private readonly storefrontRepo: IStorefrontRepository,
  ) {}

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  async getCategories() {
    const categories = await this.categoryRepo.findActiveTree();
    return { success: true, message: 'Categories retrieved successfully', data: categories };
  }

  @Get('categories/:categoryId/options')
  @HttpCode(HttpStatus.OK)
  async getCategoryOptions(@Param('categoryId') categoryId: string) {
    const templates = await this.categoryRepo.findCategoryOptions(categoryId);
    return { success: true, message: 'Category options retrieved successfully', data: templates };
  }

  @Get('brands')
  @HttpCode(HttpStatus.OK)
  async getBrands(@Query('search') search?: string) {
    const brands = await this.brandRepo.findAllActive(search);
    return { success: true, message: 'Brands retrieved successfully', data: brands };
  }

  @Get('options')
  @HttpCode(HttpStatus.OK)
  async getOptions() {
    const options = await this.storefrontRepo.findAllOptionDefinitions();
    return { success: true, message: 'Options retrieved successfully', data: options };
  }
}
