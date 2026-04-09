export const COLLECTION_REPOSITORY = Symbol('CollectionRepository');

export interface CollectionListParams {
  page: number;
  limit: number;
  search?: string;
}

export interface ICollectionRepository {
  // ── Admin CRUD ──
  findAllPaginated(params: CollectionListParams): Promise<{ collections: any[]; total: number }>;
  findById(id: string): Promise<any | null>;
  findBySlug(slug: string): Promise<any | null>;
  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  delete(id: string): Promise<void>;

  // ── Products ──
  addProducts(collectionId: string, productIds: string[]): Promise<number>;
  removeProduct(collectionId: string, productId: string): Promise<void>;
  updateImageUrl(id: string, imageUrl: string | null): Promise<any>;

  // ── Public (storefront) ──
  findAllActive(): Promise<any[]>;
  findBySlugWithProducts(slug: string, page: number, limit: number): Promise<any | null>;
}
