export const CATEGORY_REPOSITORY = Symbol('CategoryRepository');

export interface CategoryListParams {
  page: number;
  limit: number;
  search?: string;
  parentId?: string;
  level?: number;
}

export interface ICategoryRepository {
  findAllPaginated(params: CategoryListParams): Promise<{ categories: any[]; total: number }>;
  findById(id: string): Promise<any | null>;
  findBySlug(slug: string): Promise<any | null>;
  findBySlugExcluding(slug: string, excludeId: string): Promise<any | null>;

  create(data: any): Promise<any>;
  update(id: string, data: any): Promise<any>;
  delete(id: string): Promise<void>;
  deactivate(id: string): Promise<void>;

  findWithCounts(id: string): Promise<any | null>;

  // ── Public (storefront) ──
  findActiveTree(): Promise<any[]>;
  findCategoryOptions(categoryId: string): Promise<any[]>;

  // ── Hierarchy walk ──
  findAncestorIds(categoryId: string): Promise<string[]>;
}
