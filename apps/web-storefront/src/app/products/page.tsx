'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from 'lucide-react';
import { StorefrontShell } from '@/components/layout/StorefrontShell';
import {
  ProductCard,
  ProductCardSkeleton,
  type ProductCardData,
} from '@/components/ui/ProductCard';
import FilterSidebar from '@/components/FilterSidebar';
import ActiveFilterChips from '@/components/ActiveFilterChips';
import { apiClient } from '@/lib/api-client';

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function ProductsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const searchQuery = searchParams.get('search') || '';
  const categoryId = searchParams.get('categoryId') || '';
  const brandId = searchParams.get('brandId') || '';
  const sortBy = searchParams.get('sortBy') || '';
  const minPrice = searchParams.get('minPrice') || '';
  const maxPrice = searchParams.get('maxPrice') || '';
  const currentPage = parseInt(searchParams.get('page') || '1', 10);

  const [products, setProducts] = useState<ProductCardData[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterLabels, setFilterLabels] = useState<Record<string, Record<string, string>>>({});

  const activeFilters: Record<string, string[]> = {};
  searchParams.forEach((value, key) => {
    const m = key.match(/^filter\[(\w+)\]$/);
    if (m) activeFilters[m[1]] = value.split(',').filter(Boolean);
  });

  const buildParams = (overrides?: {
    filters?: Record<string, string[]>;
    minP?: string;
    maxP?: string;
    page?: number;
    sort?: string;
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
    for (const [key, values] of Object.entries(activeFilters)) {
      if (values.length > 0) params.set(`filter[${key}]`, values.join(','));
    }

    apiClient<{ products: ProductCardData[]; pagination: Pagination }>(
      `/storefront/products?${params}`,
    )
      .then((res) => {
        setProducts(res.data?.products || []);
        setPagination(
          res.data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 },
        );
      })
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  const navigate = (params: URLSearchParams) => {
    const qs = params.toString();
    router.push(qs ? `/products?${qs}` : '/products');
  };

  const handleFilterChange = (key: string, values: string[]) => {
    const newFilters = { ...activeFilters, [key]: values };
    if (values.length === 0) delete newFilters[key];
    navigate(buildParams({ filters: newFilters, page: 1 }));
  };

  const handlePriceChange = (min: string, max: string) =>
    navigate(buildParams({ minP: min, maxP: max, page: 1 }));

  const handleRemoveFilter = (key: string, value: string) => {
    const current = activeFilters[key] || [];
    handleFilterChange(key, current.filter((v) => v !== value));
  };

  const handleClearAll = () => {
    const params = new URLSearchParams();
    if (searchQuery) params.set('search', searchQuery);
    if (categoryId) params.set('categoryId', categoryId);
    if (brandId) params.set('brandId', brandId);
    if (sortBy) params.set('sortBy', sortBy);
    navigate(params);
  };

  const goToPage = (page: number) => navigate(buildParams({ page }));

  const renderPagination = () => {
    if (pagination.totalPages <= 1) return null;
    const pages: (number | string)[] = [];
    const total = pagination.totalPages;
    const current = pagination.page;
    pages.push(1);
    if (current > 3) pages.push('...');
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++)
      pages.push(i);
    if (current < total - 2) pages.push('...');
    if (total > 1) pages.push(total);

    return (
      <nav
        aria-label="Pagination"
        className="mt-12 flex items-center justify-center gap-1"
      >
        <button
          disabled={current <= 1}
          onClick={() => goToPage(current - 1)}
          className="size-10 grid place-items-center border border-ink-300 hover:border-ink-900 disabled:opacity-40 disabled:hover:border-ink-300"
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>
        {pages.map((p, idx) =>
          typeof p === 'string' ? (
            <span key={`e-${idx}`} className="px-2 text-ink-500">
              {p}
            </span>
          ) : (
            <button
              key={p}
              onClick={() => goToPage(p)}
              className={`min-w-10 h-10 px-3 grid place-items-center border tabular ${
                p === current
                  ? 'bg-ink-900 text-white border-ink-900'
                  : 'border-ink-300 hover:border-ink-900'
              }`}
              aria-current={p === current ? 'page' : undefined}
            >
              {p}
            </button>
          ),
        )}
        <button
          disabled={current >= total}
          onClick={() => goToPage(current + 1)}
          className="size-10 grid place-items-center border border-ink-300 hover:border-ink-900 disabled:opacity-40 disabled:hover:border-ink-300"
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
      </nav>
    );
  };

  const headerTitle = searchQuery
    ? `Results for "${searchQuery}"`
    : categoryId
      ? 'Category'
      : brandId
        ? 'Brand'
        : 'All products';

  return (
    <StorefrontShell>
      <div className="container-wide py-8 sm:py-12">
        <div className="text-caption uppercase tracking-wider text-ink-600 mb-3">
          <Link href="/" className="hover:text-ink-900">
            Home
          </Link>
          {' / '}
          <span>Products</span>
        </div>

        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="font-semibold text-2xl sm:text-3xl text-ink-900 leading-tight tracking-tight">
            {headerTitle}
          </h1>
          {!loading && (
            <span className="text-body text-ink-600 tabular">
              — {pagination.total.toLocaleString('en-IN')} item
              {pagination.total !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-3 py-3 border-y border-ink-200">
          <button
            onClick={() => setFiltersOpen(true)}
            className="lg:hidden mr-auto inline-flex items-center gap-2 h-9 px-3 border border-ink-300 hover:border-ink-900 text-body font-medium rounded-full"
          >
            <SlidersHorizontal className="size-4" />
            Filters
          </button>
          <label className="inline-flex items-center gap-2">
            <span className="text-caption uppercase tracking-wider text-ink-600 hidden sm:inline">
              Sort by:
            </span>
            <select
              value={sortBy}
              onChange={(e) => navigate(buildParams({ sort: e.target.value, page: 1 }))}
              className="h-9 pl-3 pr-9 border border-ink-300 hover:border-ink-900 text-body bg-white focus:outline-none focus:border-ink-900 cursor-pointer rounded-full"
            >
              <option value="">Recommended</option>
              <option value="newest">Newest first</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="name_asc">Name: A–Z</option>
              <option value="name_desc">Name: Z–A</option>
            </select>
          </label>
        </div>

        <div className="flex gap-8 mt-4 items-start">
          <aside
            className={
              filtersOpen
                ? 'fixed inset-0 z-50 bg-white p-6 overflow-y-auto'
                : 'hidden lg:block w-64 shrink-0 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-2 [scrollbar-width:thin]'
            }
          >
            {filtersOpen && (
              <div className="flex items-center justify-between mb-4 lg:hidden">
                <h2 className="font-semibold text-h3">Filters</h2>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="size-10 grid place-items-center hover:bg-ink-100"
                  aria-label="Close filters"
                >
                  <X className="size-5" />
                </button>
              </div>
            )}
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
              onLabelsChange={setFilterLabels}
            />
          </aside>

          <div className="flex-1 min-w-0">
            <ActiveFilterChips
              activeFilters={activeFilters}
              minPrice={minPrice || undefined}
              maxPrice={maxPrice || undefined}
              filterLabels={filterLabels}
              onRemoveFilter={handleRemoveFilter}
              onRemovePrice={() => handlePriceChange('', '')}
              onClearAll={handleClearAll}
            />

            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-10">
                {Array.from({ length: 9 }).map((_, i) => (
                  <ProductCardSkeleton key={i} />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="py-24 text-center border border-ink-200 rounded-2xl bg-white">
                <h3 className="font-display text-h2 text-ink-900">
                  {searchQuery ? 'No matches found' : 'No products yet'}
                </h3>
                <p className="mt-3 text-body-lg text-ink-600 max-w-md mx-auto">
                  {searchQuery
                    ? 'Try a different search or remove some filters.'
                    : 'Check back soon for new arrivals.'}
                </p>
                {searchQuery && (
                  <button
                    onClick={handleClearAll}
                    className="mt-6 inline-flex items-center h-11 px-5 bg-ink-900 text-white font-medium hover:bg-ink-800 rounded-full"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-10">
                  {products.map((p) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>
                {renderPagination()}
              </>
            )}
          </div>
        </div>
      </div>
    </StorefrontShell>
  );
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <StorefrontShell>
          <div className="container-x py-12">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-10">
              {Array.from({ length: 9 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          </div>
        </StorefrontShell>
      }
    >
      <ProductsContent />
    </Suspense>
  );
}
