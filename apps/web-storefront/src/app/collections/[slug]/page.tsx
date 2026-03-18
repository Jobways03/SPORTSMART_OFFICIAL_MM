'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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

interface CollectionResponse {
  collection: CollectionInfo;
  products: Product[];
  pagination: Pagination;
}

const fmt = (n: number) =>
  `\u20B9${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function CollectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    apiClient<CollectionResponse>(`/catalog/collections/${slug}?page=${page}&limit=24`)
      .then((res) => { if (res.data) setData(res.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug, page]);

  return (
    <>
      <Navbar />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        {loading && !data ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>Loading collection...</div>
        ) : !data ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <h2 style={{ fontWeight: 700, marginBottom: 8 }}>Collection not found</h2>
            <Link href="/" style={{ color: '#2563eb' }}>Back to shop</Link>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 6px 0' }}>{data.collection.name}</h1>
              {data.collection.description && (
                <p style={{ fontSize: 15, color: '#6b7280', margin: 0 }}>{data.collection.description}</p>
              )}
              <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 6 }}>
                {data.pagination.total} product{data.pagination.total !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Product Grid */}
            {data.products.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>&#128722;</div>
                <p>No products in this collection yet.</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 20,
              }}>
                {data.products.map((p) => {
                  const discount = p.compareAtPrice && p.price
                    ? Math.round((1 - p.price / p.compareAtPrice) * 100)
                    : 0;
                  return (
                    <Link
                      key={p.id}
                      href={`/products/${p.slug}`}
                      style={{
                        textDecoration: 'none', color: 'inherit',
                        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
                        overflow: 'hidden', transition: 'box-shadow 0.2s',
                      }}
                    >
                      <div style={{
                        width: '100%', aspectRatio: '1', background: '#f9fafb',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                      }}>
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.imageAlt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <span style={{ fontSize: 48, color: '#e5e7eb' }}>&#128722;</span>
                        )}
                      </div>
                      <div style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 4, lineHeight: 1.3 }}>
                          {p.title}
                        </div>
                        {p.brand && (
                          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{p.brand}</div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {p.price !== null ? (
                            <span style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>{fmt(p.price)}</span>
                          ) : (
                            <span style={{ fontSize: 14, color: '#9ca3af' }}>Price unavailable</span>
                          )}
                          {p.compareAtPrice && p.price && p.compareAtPrice > p.price && (
                            <>
                              <span style={{ fontSize: 13, color: '#9ca3af', textDecoration: 'line-through' }}>{fmt(p.compareAtPrice)}</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fee2e2', padding: '1px 6px', borderRadius: 4 }}>
                                -{discount}%
                              </span>
                            </>
                          )}
                        </div>
                        {!p.inStock && (
                          <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, marginTop: 6 }}>Out of stock</div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {data.pagination.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 28 }}>
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={pageBtnStyle}>Previous</button>
                <span style={{ padding: '8px 12px', fontSize: 14 }}>
                  Page {page} of {data.pagination.totalPages}
                </span>
                <button disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)} style={pageBtnStyle}>Next</button>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

const pageBtnStyle: React.CSSProperties = {
  padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6,
  background: '#fff', fontSize: 13, cursor: 'pointer',
};
