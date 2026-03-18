'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Product {
  id: string;
  title: string;
  status: string;
  moderationStatus: string;
  hasVariants: boolean;
  basePrice: string | null;
  totalStock: number;
  primaryImageUrl: string | null;
  seller: { sellerName: string; sellerShopName: string } | null;
  category: { name: string } | null;
}

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    apiClient('/admin/products?limit=50&status=ACTIVE')
      .then((res) => {
        setProducts(res.data?.products || []);
        setTotal(res.data?.pagination?.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const formatPrice = (price: string | null) => {
    if (!price) return '--';
    const num = parseFloat(price);
    if (isNaN(num)) return price;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(num);
  };

  return (
    <div className="placeholder-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Products ({total})</h1>
      </div>

      {loading ? (
        <p>Loading products...</p>
      ) : products.length === 0 ? (
        <div className="placeholder-empty">
          <div className="empty-icon">📦</div>
          <h3>No active products</h3>
          <p>Products will appear here once they are approved and set to Active.</p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e3e3e3', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500, color: '#616161', fontSize: 13, borderBottom: '1px solid #e3e3e3' }}>Product</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500, color: '#616161', fontSize: 13, borderBottom: '1px solid #e3e3e3' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 500, color: '#616161', fontSize: 13, borderBottom: '1px solid #e3e3e3' }}>Seller</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500, color: '#616161', fontSize: 13, borderBottom: '1px solid #e3e3e3' }}>Stock</th>
                <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500, color: '#616161', fontSize: 13, borderBottom: '1px solid #e3e3e3' }}>Price</th>
                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 500, color: '#616161', fontSize: 13, borderBottom: '1px solid #e3e3e3', width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }} onClick={() => router.push(`/dashboard/products/${p.id}/edit`)}>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {p.primaryImageUrl ? (
                        <img src={p.primaryImageUrl} alt={p.title} style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', border: '1px solid #e3e3e3' }} />
                      ) : (
                        <div style={{ width: 40, height: 40, borderRadius: 6, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📷</div>
                      )}
                      <div>
                        <div style={{ fontWeight: 500 }}>{p.title}</div>
                        {p.category && <div style={{ fontSize: 12, color: '#8c8c8c' }}>{p.category.name}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: 12, fontWeight: 500, borderRadius: 20, background: '#16a34a15', color: '#16a34a' }}>
                      ACTIVE
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#616161' }}>{p.seller?.sellerName || '--'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>{p.totalStock ?? 0}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>{p.hasVariants ? 'Multiple' : formatPrice(p.basePrice)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/products/${p.id}/edit`); }}
                      style={{ padding: '5px 14px', fontSize: 13, fontWeight: 500, background: '#008060', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
