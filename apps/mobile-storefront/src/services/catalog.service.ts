import {apiClient, ApiResponse} from '../lib/api-client';

// Mirrors the response shapes used by the web storefront so the mobile app
// speaks the exact same protocol against /api/v1/storefront/*.

export interface ProductImage {
  id: string;
  url: string;
  altText: string | null;
}

export interface OptionValue {
  optionName: string;
  optionType: string;
  value: string;
  displayValue: string;
}

export interface Variant {
  id: string;
  masterSku: string;
  title: string;
  price: number;
  compareAtPrice: number | null;
  sku: string;
  totalAvailableStock: number;
  totalStock: number;
  inStock: boolean;
  optionValues: OptionValue[];
  images: ProductImage[];
}

export interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  productCode: string | null;
  shortDescription: string | null;
  description: string | null;
  price: number | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  hasVariants: boolean;
  totalStock: number;
  totalAvailableStock: number;
  inStock: boolean;
  baseSku: string | null;
  category: {id: string; name: string} | null;
  brand: {id: string; name: string} | null;
  images: ProductImage[];
  variants: Variant[];
  tags: {tag: string}[];
  /** Populated by the storefront-filters / metafields migration.
   *  Optional because older API versions don't include it. */
  metafields?: ProductMetafield[];
  /** Aggregate review stats — surfaced inline so we don't need a
   *  second request just to render the PDP header. */
  averageRating?: number;
  reviewCount?: number;
}

export interface ProductCardData {
  id: string;
  title: string;
  slug: string;
  primaryImageUrl: string | null;
  imageUrls?: string[];
  categoryName: string | null;
  brandName: string | null;
  price: number | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  totalAvailableStock: number;
  sellerCount: number;
  /** Whether the product has selectable variants (size/colour). Drives
   *  quick-add: simple products add to cart directly; variant products
   *  route to the detail screen so the shopper can choose first. */
  hasVariants?: boolean;
  variantCount?: number;
  /** Distinct color-option hex values found across this product's
   *  variants (capped server-side at 6). Empty when the product has
   *  no COLOR-typed option — the card hides the swatch row. */
  swatches?: string[];
  /** Total distinct count, including any beyond the 6 sent in swatches.
   *  Used to render "+N" on the card without making the swatch row wider. */
  swatchCount?: number;
  /** Approved-review aggregate. null/undefined when no approved
   *  reviews exist yet — card hides the rating row. */
  averageRating?: number | null;
  reviewCount?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ProductsQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  minPrice?: number;
  maxPrice?: number;
  collection?: string;
  category?: string;
  q?: string;
  /** Facet filters keyed by filter group (e.g. brand → ['nike','puma']).
   *  Encoded as filter[key]=v1,v2,... to match the backend. */
  filters?: Record<string, string[]>;
}

function buildQs(query: ProductsQuery): string {
  const params = new URLSearchParams();
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.minPrice != null) params.set('minPrice', String(query.minPrice));
  if (query.maxPrice != null) params.set('maxPrice', String(query.maxPrice));
  if (query.collection) params.set('collection', query.collection);
  if (query.category) params.set('category', query.category);
  // The list endpoint reads the free-text term from `search`; `q` is
  // only the autocomplete/suggestions param. Sending `q` here is silently
  // ignored by the backend, so search never filtered.
  if (query.q) params.set('search', query.q);
  if (query.filters) {
    for (const [k, vs] of Object.entries(query.filters)) {
      if (vs.length > 0) params.set(`filter[${k}]`, vs.join(','));
    }
  }
  return params.toString();
}

// Reference data shapes — categories, brands, collections — used by
// HomeScreen rails and BrowseScreen pills. These come from the
// `/catalog/*` endpoints (CatalogReferenceController + the
// StorefrontCollectionsController), not `/storefront/*` — the
// catalog module owns reference data.

export interface CategoryRef {
  id: string;
  slug: string;
  name: string;
  /** Backend may not carry icons; if missing we fall back to a UI map. */
  iconUrl?: string | null;
  productCount?: number;
  /** Tree response — children are nested categories. Flattened by the
   *  hook before consumers see it, so screens render a single list. */
  children?: CategoryRef[];
}

export interface BrandRef {
  id: string;
  slug: string;
  name: string;
  logoUrl?: string | null;
  productCount?: number;
}

export interface CollectionRef {
  id: string;
  slug: string;
  /** Backend exposes `name`; we mirror it directly so the type matches
   *  the wire format. UI labels read from `name`. */
  name: string;
  description?: string | null;
  bannerUrl?: string | null;
  productCount?: number;
}

// Product detail extends to carry metafields populated by the recent
// "add_metafields_and_storefront_filters" migration. Keys are
// namespace.key strings (e.g. "spec.material"), values are typed by
// the metafield definition. We treat them all as displayable strings
// here — the UI layer handles formatting.
export interface ProductMetafield {
  namespace: string;
  key: string;
  label: string;
  value: string;
  type?: string;
}

export const catalogService = {
  listProducts(
    query: ProductsQuery = {},
  ): Promise<ApiResponse<{products: ProductCardData[]; pagination: Pagination}>> {
    const qs = buildQs(query);
    return apiClient<{products: ProductCardData[]; pagination: Pagination}>(
      `/storefront/products${qs ? `?${qs}` : ''}`,
    );
  },

  getProductBySlug(slug: string): Promise<ApiResponse<ProductDetail>> {
    return apiClient<ProductDetail>(`/storefront/products/${slug}`);
  },

  // Backend returns the array directly as `data` — no nested
  // {categories: [...]} wrapper. Mirrors the public catalog-reference
  // controller (apps/api/.../catalog-reference.controller.ts).
  listCategories(): Promise<ApiResponse<CategoryRef[]>> {
    return apiClient<CategoryRef[]>('/catalog/categories');
  },

  listBrands(): Promise<ApiResponse<BrandRef[]>> {
    return apiClient<BrandRef[]>('/catalog/brands');
  },

  listCollections(): Promise<ApiResponse<CollectionRef[]>> {
    return apiClient<CollectionRef[]>('/catalog/collections');
  },
};
