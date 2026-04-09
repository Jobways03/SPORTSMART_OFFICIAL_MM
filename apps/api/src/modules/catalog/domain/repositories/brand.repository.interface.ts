export const BRAND_REPOSITORY = Symbol('BrandRepository');

export interface BrandListParams {
  page: number;
  limit: number;
  search?: string;
}

export interface IBrandRepository {
  findAllPaginated(params: BrandListParams): Promise<{ brands: any[]; total: number }>;
  findById(id: string): Promise<any | null>;
  findByIdWithProducts(id: string): Promise<any | null>;
  findBySlug(slug: string): Promise<any | null>;
  findBySlugExcluding(slug: string, excludeId: string): Promise<any | null>;
  findByNameInsensitive(name: string): Promise<any | null>;

  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  delete(id: string): Promise<void>;
  deactivate(id: string): Promise<void>;

  findWithCounts(id: string): Promise<any | null>;
  addProductsToBrand(brandId: string, productIds: string[]): Promise<number>;
  removeProductFromBrand(brandId: string, productId: string): Promise<void>;
  updateLogoUrl(id: string, logoUrl: string | null): Promise<any>;

  // ── Public ──
  findAllActive(search?: string): Promise<any[]>;
}
