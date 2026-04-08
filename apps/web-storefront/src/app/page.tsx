'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  platformPrice: number | null;
  basePrice: number | null;
  compareAtPrice: number | null;
  primaryImageUrl: string | null;
  categoryName: string | null;
  brandName: string | null;
  totalAvailableStock: number;
  sellerCount: number;
  hasVariants: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const searchQuery = searchParams.get('search') || '';
  const categoryId = searchParams.get('categoryId') || '';
  const brandId = searchParams.get('brandId') || '';
  const sortBy = searchParams.get('sortBy') || '';
  const minPrice = searchParams.get('minPrice') || '';
  const maxPrice = searchParams.get('maxPrice') || '';
  const currentPage = parseInt(searchParams.get('page') || '1', 10);
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);

  // Parse active metafield filters from URL: filter[material]=cotton,polyester
  const activeFilters: Record<string, string[]> = {};
  searchParams.forEach((value, key) => {
    const match = key.match(/^filter\[(\w+)\]$/);
    if (match) {
      activeFilters[match[1]] = value.split(',').filter(Boolean);
    }
  });

  // Build URL params helper
  const buildParams = (overrides?: {
    filters?: Record<string, string[]>;
    minP?: string; maxP?: string;
    page?: number; sort?: string;
  }) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (categoryId) params.set('categoryId', categoryId);
    if (brandId) params.set('brandId', brandId);
    const s = overrides?.sort ?? sortBy;
    if (s) params.set('sortBy', s);
    const mnP = overrides?.minP ?? minPrice;
    const mxP = overrides?.maxP ?? maxPrice;
    if (mnP) params.set('minPrice', mnP);
    if (mxP) params.set('maxPrice', mxP);
    const pg = overrides?.page ?? undefined;
    if (pg && pg > 1) params.set('page', String(pg));
    // Metafield filters
    const filtersToUse = overrides?.filters ?? activeFilters;
    for (const [key, values] of Object.entries(filtersToUse)) {
      if (values.length > 0) params.set(`filter[${key}]`, values.join(','));
    }
    return params;
  };

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '20');
    params.set('page', String(currentPage));
    if (searchQuery) params.set('search', searchQuery);
    if (categoryId) params.set('categoryId', categoryId);
    if (brandId) params.set('brandId', brandId);
    if (sortBy) params.set('sortBy', sortBy);
    if (minPrice) params.set('minPrice', minPrice);
    if (maxPrice) params.set('maxPrice', maxPrice);
    // Include metafield filters
    for (const [key, values] of Object.entries(activeFilters)) {
      if (values.length > 0) params.set(`filter[${key}]`, values.join(','));
    }

    apiClient<{ products: Product[]; pagination: Pagination }>(`/storefront/products?${params}`)
      .then((res) => {
        setProducts(res.data?.products || []);
        setPagination(res.data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      })
      .catch(() => {
        setProducts([]);
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  // Filter handlers
  const handleFilterChange = (key: string, values: string[]) => {
    const newFilters = { ...activeFilters, [key]: values };
    if (values.length === 0) delete newFilters[key];
    const params = buildParams({ filters: newFilters, page: 1 });
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : '/');
  };

  const handlePriceChange = (min: string, max: string) => {
    const params = buildParams({ minP: min, maxP: max, page: 1 });
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : '/');
  };

  const handleRemoveFilter = (key: string, value: string) => {
    const current = activeFilters[key] || [];
    const next = current.filter((v) => v !== value);
    handleFilterChange(key, next);
  };

  const handleRemovePrice = () => {
    handlePriceChange('', '');
  };

  const handleClearAll = () => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (categoryId) params.set('categoryId', categoryId);
    if (brandId) params.set('brandId', brandId);
    if (sortBy) params.set('sortBy', sortBy);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : '/');
  };

  const getDisplayPrice = (product: Product): number | null => {
    return product.platformPrice ?? product.basePrice ?? null;
  };

  const formatPrice = (price: number | null) => {
    if (price == null) return '--';
    return `\u20B9${Number(price).toLocaleString('en-IN')}`;
  };

  const getDiscount = (price: number | null, compare: number | null) => {
    if (!price || !compare || compare <= price) return null;
    return Math.round(((compare - price) / compare) * 100);
  };

  const goToPage = (page: number) => {
    const params = buildParams({ page });
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : '/');
  };

  const renderPagination = () => {
    if (pagination.totalPages <= 1) return null;
    const pages: (number | string)[] = [];
    const total = pagination.totalPages;
    const current = pagination.page;

    // Always show first page
    pages.push(1);

    if (current > 3) {
      pages.push('...');
    }

    // Show pages around current
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
      pages.push(i);
    }

    if (current < total - 2) {
      pages.push('...');
    }

    // Always show last page
    if (total > 1) {
      pages.push(total);
    }

    return (
      <div className="pagination">
        <button
          className="pagination-btn"
          disabled={current <= 1}
          onClick={() => goToPage(current - 1)}
        >
          &laquo; Prev
        </button>
        {pages.map((p, idx) =>
          typeof p === 'string' ? (
            <span key={`ellipsis-${idx}`} className="pagination-ellipsis">{p}</span>
          ) : (
            <button
              key={p}
              className={`pagination-btn${p === current ? ' active' : ''}`}
              onClick={() => goToPage(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          className="pagination-btn"
          disabled={current >= total}
          onClick={() => goToPage(current + 1)}
        >
          Next &raquo;
        </button>
      </div>
    );
  };

  return (
    <>
      <Navbar />

      {!searchQuery && !categoryId && !brandId && (
        <div className="hero">
          <div className="hero-inner">
            <span className="hero-tagline">India&#39;s Sports Marketplace</span>
            <h1>Your Sports, Your Gear</h1>
            <p>Shop the best sports equipment, apparel, and accessories — all in one place.</p>
            <a href="#products" className="hero-cta">
              Browse Products &#8595;
            </a>
          </div>
        </div>
      )}

      <div id="products" className="products-section">
        <div className="products-layout">
          {/* Filter Sidebar */}
          <FilterSidebar
            categoryId={categoryId || undefined}
            search={searchQuery || undefined}
            activeFilters={activeFilters}
            minPrice={minPrice || undefined}
            maxPrice={maxPrice || undefined}
            brandId={brandId || undefined}
            onFilterChange={handleFilterChange}
            onPriceChange={handlePriceChange}
            onClearAll={handleClearAll}
          />

          {/* Main content area */}
          <div className="products-main">
        <div className="products-section-header">
          <h2>{searchQuery ? `Results for "${searchQuery}"` : 'All Products'}</h2>
          <div className="products-header-right">
            {!loading && (
              <span className="products-count">{pagination.total} product{pagination.total !== 1 ? 's' : ''}</span>
            )}
            <select
              className="products-sort"
              value={sortBy}
              onChange={(e) => {
                const params = buildParams({ sort: e.target.value, page: 1 });
                const qs = params.toString();
                router.push(qs ? `/?${qs}` : '/');
              }}
            >
              <option value="">Sort by</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="name_asc">Name: A-Z</option>
              <option value="name_desc">Name: Z-A</option>
            </select>
          </div>
        </div>

        {/* Active filter chips */}
        <ActiveFilterChips
          activeFilters={activeFilters}
          minPrice={minPrice || undefined}
          maxPrice={maxPrice || undefined}
          onRemoveFilter={handleRemoveFilter}
          onRemovePrice={handleRemovePrice}
          onClearAll={handleClearAll}
        />

        {loading ? (
          <div className="products-loading">
            <div className="loading-spinner"></div>
            <span>Loading products...</span>
          </div>
        ) : products.length === 0 ? (
          <div className="products-empty">
            <span className="products-empty-icon">{searchQuery ? '\uD83D\uDD0D' : '\uD83C\uDFBE'}</span>
            <h3>{searchQuery ? 'No products found' : 'No products available yet'}</h3>
            <p>{searchQuery ? 'Try a different search term or browse all products.' : 'Check back soon for new arrivals!'}</p>
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

export default function HomePage() {
  return (
    <Suspense fallback={
      <>
        <Navbar />
        <div className="products-loading">
          <div className="loading-spinner"></div>
          <span>Loading...</span>
        </div>
      </>
    }>
      <HomeContent />
    </Suspense>
  );
}
