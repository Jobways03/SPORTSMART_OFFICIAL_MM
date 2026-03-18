'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { apiClient } from '@/lib/api-client';

interface Product {
  id: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  price: number | null;
  compareAtPrice: number | null;
  imageUrl: string | null;
  imageAlt: string;
  category: string | null;
  brand: string | null;
  shopName: string | null;
  inStock: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function HomePage() {
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('search') || '';
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '20');
    if (searchQuery) params.set('search', searchQuery);

    apiClient<{ products: Product[]; pagination: Pagination }>(`/catalog/products?${params}`)
      .then((res) => {
        setProducts(res.data?.products || []);
        setPagination(res.data?.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      })
      .catch(() => {
        setProducts([]);
      })
      .finally(() => setLoading(false));
  }, [searchQuery]);

  const formatPrice = (price: number | null) => {
    if (price == null) return '--';
    return `₹${Number(price).toLocaleString('en-IN')}`;
  };

  const getDiscount = (price: number | null, compare: number | null) => {
    if (!price || !compare || compare <= price) return null;
    return Math.round(((compare - price) / compare) * 100);
  };

  return (
    <>
      <Navbar />

      {!searchQuery && (
        <div className="hero">
          <h1>Your Sports, Your Gear</h1>
          <p>Shop from multiple sellers for the best sports equipment, apparel, and accessories.</p>
        </div>
      )}

      <div className="products-section">
        <div className="products-section-header">
          <h2>{searchQuery ? `Results for "${searchQuery}"` : 'All Products'}</h2>
          {!loading && (
            <span className="products-count">{pagination.total} product{pagination.total !== 1 ? 's' : ''}</span>
          )}
        </div>

        {loading ? (
          <div className="products-loading">Loading products...</div>
        ) : products.length === 0 ? (
          <div className="products-empty">
            <h3>{searchQuery ? 'No products found' : 'No products available yet'}</h3>
            <p>{searchQuery ? 'Try a different search term.' : 'Check back soon for new arrivals!'}</p>
          </div>
        ) : (
          <div className="products-grid">
            {products.map((product) => {
              const discount = getDiscount(product.price, product.compareAtPrice);
              return (
                <Link
                  key={product.id}
                  href={`/products/${product.slug}`}
                  className="product-card"
                >
                  <div className="product-card-image">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.imageAlt} />
                    ) : (
                      <span className="product-card-placeholder">&#128722;</span>
                    )}
                    {discount && (
                      <span className="product-card-badge">{discount}% OFF</span>
                    )}
                  </div>
                  <div className="product-card-body">
                    {product.category && (
                      <div className="product-card-category">{product.category}</div>
                    )}
                    <div className="product-card-title">{product.title}</div>
                    {product.shopName && (
                      <div className="product-card-shop">by {product.shopName}</div>
                    )}
                    <div className="product-card-price">
                      <span className="current">{formatPrice(product.price)}</span>
                      {product.compareAtPrice && Number(product.compareAtPrice) > Number(product.price) && (
                        <span className="compare">{formatPrice(product.compareAtPrice)}</span>
                      )}
                      {discount && (
                        <span className="discount">{discount}% off</span>
                      )}
                    </div>
                    {!product.inStock && (
                      <div className="product-card-stock">Out of stock</div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
