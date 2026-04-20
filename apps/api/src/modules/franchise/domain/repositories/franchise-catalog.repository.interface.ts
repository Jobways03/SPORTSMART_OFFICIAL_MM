export const FRANCHISE_CATALOG_REPOSITORY = Symbol('FranchiseCatalogRepository');

export interface FranchiseCatalogRepository {
  findByFranchiseId(
    franchiseId: string,
    params: {
      page: number;
      limit: number;
      search?: string;
      isActive?: boolean;
      approvalStatus?: string;
    },
  ): Promise<{ mappings: any[]; total: number }>;

  findById(id: string): Promise<any | null>;

  findByFranchiseAndProduct(
    franchiseId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null>;

  create(data: {
    franchiseId: string;
    productId: string;
    variantId?: string;
    globalSku: string;
    franchiseSku?: string;
    barcode?: string;
    isListedForOnlineFulfillment?: boolean;
  }): Promise<any>;

  createMany(
    data: Array<{
      franchiseId: string;
      productId: string;
      variantId?: string;
      globalSku: string;
      franchiseSku?: string;
      barcode?: string;
    }>,
  ): Promise<number>;

  update(id: string, data: Record<string, unknown>): Promise<any>;

  delete(id: string): Promise<void>;

  findAvailableProducts(params: {
    page: number;
    limit: number;
    search?: string;
    categoryId?: string;
    brandId?: string;
    excludeFranchiseId?: string;
  }): Promise<{ products: any[]; total: number }>;

  approve(id: string): Promise<any>;

  stop(id: string): Promise<any>;

  findAllPaginated(params: {
    page: number;
    limit: number;
    franchiseId?: string;
    approvalStatus?: string;
    search?: string;
  }): Promise<{ mappings: any[]; total: number }>;
}
