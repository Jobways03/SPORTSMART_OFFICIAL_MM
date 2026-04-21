'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import FilterSidebar from '@/components/FilterSidebar';
import ActiveFilterChips from '@/components/ActiveFilterChips';
import { apiClient } from '@/lib/api-client';

interface Product {
  id: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  price: number | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  primaryImageUrl: string | null;
  categoryName: string | null;
  brandName: string | null;
  totalAvailableStock: number;
  sellerCount: number;
  hasVariants: boolean;
}

interface CollectionInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function CollectionContent() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const sortBy = searchParams.get('sortBy') || '';
  const minPrice = searchParams.get('minPrice') || '';
  const maxPrice = searchParams.get('maxPrice') || '';
  const currentPage = parseInt(searchParams.get('page') || '1', 10);

  // Parse active metafield filters from URL
  const activeFilters: Record<string, string[]> = {};
  searchParams.forEach((value, key) => {
    const match = key.match(/^filter\[(\w+)\]$/);
    if (match) {
      activeFilters[match[1]] = value.split(',').filter(Boolean);
    }
  });

  const [collection, setCollection] = useState<CollectionInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);

  // Filter value labels (for active filter chips)
  const [filterLabels, setFilterLabels] = useState<Record<string, Record<string, string>>>({});

  // Fetch filter labels when collection loads
  useEffect(() => {
    if (!collection) return;
    const params = new URLSearchParams();
    params.set('collectionId', collection.id);
    apiClient<{ filters: any[] }>(`/storefront/filters?${params}`)
      .then((res) => {
        const labels: Record<string, Record<string, string>> = {};
        for (const f of res.data?.filters || []) {
          if (f.values && Array.isArray(f.values)) {
            labels[f.key] = {};
            for (const v of f.values) {
              labels[f.key][v.value] = v.label;
            }
          }
        }
        setFilterLabels(labels);
      })
      .catch(() => {});
  }, [collection]);

  // Helpers
  const getDisplayPrice = (product: Product): number | null => {
    return product.price ?? product.basePrice ?? null;
  };

  const formatPrice = (price: number | null) => {
    if (price == null) return '--';
    return `\u20B9${Number(price).toLocaleString('en-IN')}`;
  };

  const getDiscount = (price: number | null, compare: number | null) => {
    if (!price || !compare || compare <= price) return null;
    return Math.round(((compare - price) / compare) * 100);
  };

  // Build URL params helper
  const buildParams = useCallback((overrides?: {
    filters?: Record<string, string[]>;
    minP?: string; maxP?: string;
    page?: number; sort?: string;
  }) => {
    const params = new URLSearchParams();
    const s = overrides?.sort ?? sortBy;
    if (s) params.set('sortBy', s);
    const mnP = overrides?.minP ?? minPrice;
    const mxP = overrides?.maxP ?? maxPrice;
    if (mnP) params.set('minPrice', mnP);
    if (mxP) params.set('maxPrice', mxP);
    const pg = overrides?.page ?? undefined;
    if (pg && pg > 1) params.set('page', String(pg));
    const filtersToUse = overrides?.filters ?? activeFilters;
    for (const [key, values] of Object.entries(filtersToUse)) {
      if (values.length > 0) params.set(`filter[${key}]`, values.join(','));
    }
    return params;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  // Fetch collection info once
  useEffect(() => {
    apiClient<{ collection: CollectionInfo }>(`/catalog/collections/${slug}?page=1&limit=1`)
      .then((res) => { if (res.data?.collection) setCollection(res.data.collection); })
      .catch(() => {});
  }, [slug]);

  // Fetch products with filters
  useEffect(() => {
    if (!collection) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set('limit', '20');
    params.set('page', String(currentPage));
    params.set('collectionId', collection.id);
    if (sortBy) params.set('sortBy', sortBy);
    if (minPrice) params.set('minPrice', minPrice);
    if (maxPrice) params.set('maxPrice', maxPrice);
    for (const [key, values] of Object.entries(activeFilters)) {
      if (values.length > 0) params.set(`filter[${key}]`, values.join(','));
    }

    apiClient<{ products: Product[]; pagination: Pagination }>(`/storefront/products?${params}`)
      .then((res) => {
        setProducts(res.data?.products || []);
        setPagination(res.data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      })
      .catch(() => { setProducts([]); })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, searchParams.toString()]);

  // Filter handlers
  const handleFilterChange = (key: string, values: string[]) => {
    const newFilters = { ...activeFilters, [key]: values };
    if (values.length === 0) delete newFilters[key];
    const params = buildParams({ filters: newFilters, page: 1 });
    router.push(`/collections/${slug}?${params}`);
  };

  const handlePriceChange = (min: string, max: string) => {
    const params = buildParams({ minP: min, maxP: max, page: 1 });
    router.push(`/collections/${slug}?${params}`);
  };

  const handleClearAll = () => {
    router.push(`/collections/${slug}`);
  };

  const handleRemoveFilter = (key: string, value: string) => {
    if (key === '_price') {
      const params = buildParams({ minP: '', maxP: '', page: 1 });
      router.push(`/collections/${slug}?${params}`);
      return;
    }
    const current = activeFilters[key] || [];
    const next = current.filter((v) => v !== value);
    handleFilterChange(key, next);
  };

  const handleSortChange = (newSort: string) => {
    const params = buildParams({ sort: newSort, page: 1 });
    router.push(`/collections/${slug}?${params}`);
  };

  const goToPage = (page: number) => {
    const params = buildParams({ page });
    router.push(`/collections/${slug}?${params}`);
  };

  const hasActiveFilters = Object.values(activeFilters).some((v) => v.length > 0) || !!minPrice || !!maxPrice;

  // Pagination renderer
  const renderPagination = () => {
    if (pagination.totalPages <= 1) return null;
    const pages: (number | string)[] = [];
    const total = pagination.totalPages;
    const current = pagination.page;
    pages.push(1);
    if (current > 3) pages.push('...');
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
      pages.push(i);
    }
    if (current < total - 2) pages.push('...');
    if (total > 1) pages.push(total);

    return (
      <div className="pagination">
        <button className="pagination-btn" disabled={current <= 1} onClick={() => goToPage(current - 1)}>
          Previous
        </button>
        {pages.map((p, i) =>
          typeof p === 'string' ? (
            <span key={`e${i}`} className="pagination-ellipsis">{p}</span>
          ) : (
            <button
              key={p}
              className={`pagination-btn${p === current ? ' active' : ''}`}
              onClick={() => goToPage(p)}
            >
              {p}
            </button>
          ),
        )}
        <button className="pagination-btn" disabled={current >= total} onClick={() => goToPage(current + 1)}>
          Next
        </button>
      </div>
    );
  };

  if (!collection && loading) {
    return (
      <>
        <Navbar />
        <main className="storefront-main">
          <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Loading collection...</div>
        </main>
      </>
    );
  }

  if (!collection) {
    return (
      <>
        <Navbar />
        <main className="storefront-main" style={{ textAlign: 'center' }}>
          <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Collection not found</h2>
          <Link href="/" style={{ color: '#2563eb' }}>Back to shop</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div id="products" className="products-section">
        {/* Active filter chips */}
        {hasActiveFilters && (
          <div style={{ padding: '0 0 8px' }}>
            <ActiveFilterChips
              activeFilters={activeFilters}
              minPrice={minPrice}
              maxPrice={maxPrice}
              filterLabels={filterLabels}
              onRemoveFilter={handleRemoveFilter}
              onRemovePrice={() => handlePriceChange('', '')}
              onClearAll={handleClearAll}
            />
          </div>
        )}

        <div className="products-layout">
          {/* Filter Sidebar */}
          <FilterSidebar
            collectionId={collection.id}
            activeFilters={activeFilters}
            minPrice={minPrice}
            maxPrice={maxPrice}
            onFilterChange={handleFilterChange}
            onPriceChange={handlePriceChange}
            onClearAll={handleClearAll}
          />

          {/* Products */}
          <div className="products-main">
            <div className="products-section-header">
              <h2 style={{ textTransform: 'capitalize' }}>{collection.name}</h2>
              <div className="products-header-right">
                {!loading && (
                  <span className="products-count">
                    {pagination.total} product{pagination.total !== 1 ? 's' : ''}
                  </span>
                )}
                <select
                  className="products-sort"
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value)}
                >
                  <option value="">Sort: Relevance</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="newest">Newest First</option>
                  <option value="title_asc">Name: A to Z</option>
                </select>
              </div>
            </div>

            {loading ? (
              <div className="products-loading">
                <span>Loading products...</span>
              </div>
            ) : products.length === 0 ? (
              <div className="products-empty">
                <span className="products-empty-icon">&#128722;</span>
                <h3>No products found</h3>
                <p>Try adjusting your filters or browse all products.</p>
                {hasActiveFilters && (
                  <button onClick={handleClearAll} style={{
                    marginTop: 12, padding: '8px 20px', border: '1px solid #d1d5db',
                    borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13,
                  }}>
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="products-grid">
                  {products.map((product) => {
                    const displayPrice = getDisplayPrice(product);
                    const discount = getDiscount(displayPrice, product.compareAtPrice);
                    return (
                      <Link
                        key={product.id}
                        href={`/products/${product.slug}`}
                        className="product-card"
                      >
                        <div className="product-card-image">
                          {product.primaryImageUrl ? (
                            <img src={product.primaryImageUrl} alt={product.title} />
                          ) : (
                            <span className="product-card-placeholder">&#128722;</span>
                          )}
                          {discount && (
                            <span className="product-card-badge">{discount}% OFF</span>
                          )}
                        </div>
                        <div className="product-card-body">
                          {product.categoryName && (
                            <div className="product-card-category">{product.categoryName}</div>
                          )}
                          <div className="product-card-title">{product.title}</div>
                          {product.brandName && (
                            <div className="product-card-brand">{product.brandName}</div>
                          )}
                          <div className="product-card-price">
                            {product.compareAtPrice && Number(product.compareAtPrice) > Number(displayPrice) && (
                              <span className="compare">{formatPrice(product.compareAtPrice)}</span>
                            )}
                            <span className="current">{formatPrice(displayPrice)}</span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
                {renderPagination()}
              </>
            )}
          </div>{/* .products-main */}
        </div>{/* .products-layout */}
      </div>
    </>
  );
}

export default function CollectionPage() {
  return (
    <Suspense fallback={
      <>
        <Navbar />
        <div className="products-section">
          <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Loading collection...</div>
        </div>
      </>
    }>
      <CollectionContent />
    </Suspense>
  );
}
