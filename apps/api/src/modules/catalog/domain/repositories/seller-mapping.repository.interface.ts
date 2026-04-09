export const SELLER_MAPPING_REPOSITORY = Symbol('SellerMappingRepository');

export interface SellerMappingListParams {
  page: number;
  limit: number;
  sellerId?: string;
  productId?: string;
  isActive?: boolean;
  approvalStatus?: string;
  search?: string;
}

export interface ISellerMappingRepository {
  // ── Admin queries ──
  findByProduct(productId: string): Promise<any[]>;
  findAllPaginated(params: SellerMappingListParams): Promise<{ mappings: any[]; total: number }>;
  findPendingPaginated(page: number, limit: number): Promise<{ mappings: any[]; total: number }>;
  findById(mappingId: string): Promise<any | null>;
  update(mappingId: string, data: any): Promise<any>;
  approve(mappingId: string): Promise<any>;
  stop(mappingId: string): Promise<any>;

  // ── Seller queries ──
  findBySeller(sellerId: string): Promise<any[]>;
  findDistinctProductIdsBySeller(sellerId: string): Promise<string[]>;
  findBySellerAndProduct(sellerId: string, productId: string, variantId?: string | null): Promise<any | null>;
  findBySellerForProduct(sellerId: string, productId: string): Promise<any[]>;
  create(data: any): Promise<any>;
  createMany(data: any[]): Promise<any[]>;
  delete(mappingId: string): Promise<void>;
  bulkUpdateStock(updates: Array<{ mappingId: string; stockQty: number }>): Promise<any[]>;
  deleteBySellerProductVariantNull(sellerId: string, productId: string): Promise<void>;

  // ── My products (seller) ──
  findMyProductsPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ products: any[]; total: number }>;

  // ── Service area ──
  findServiceAreasPaginated(sellerId: string, page: number, limit: number, search?: string): Promise<{ serviceAreas: any[]; total: number }>;
  addServiceAreas(sellerId: string, pincodes: string[]): Promise<number>;
  removeServiceArea(sellerId: string, pincode: string): Promise<void>;
  removeServiceAreas(sellerId: string, pincodes: string[]): Promise<number>;
  findServiceArea(sellerId: string, pincode: string): Promise<any | null>;

  // ── Product validation for mapping ──
  findProductForMapping(productId: string): Promise<any | null>;
  findVariantForMapping(variantId: string, productId: string): Promise<any | null>;
  findPostOfficeByPincode(pincode: string): Promise<any | null>;
}
