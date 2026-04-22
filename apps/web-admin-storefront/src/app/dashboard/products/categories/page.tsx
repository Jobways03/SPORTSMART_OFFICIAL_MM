'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminProductsService } from '../../../../services/admin-products.service';
import { useModal } from '@sportsmart/ui';

interface Category {
  id: string;
  name: string;
  slug: string;
  level: number;
  parentId: string | null;
  isActive: boolean;
  parent?: { id: string; name: string; slug: string } | null;
  _count?: { products: number; children: number; metafieldDefinitions: number };
}

export default function CategoriesPage() {
  const { notify, confirmDialog } = useModal();
const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Parent category options for dropdown
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string; level: number }[]>([]);

  // Form state
  const [form, setForm] = useState({ name: '', parentId: '', description: '', sortOrder: 0 });

  // Load parent options from public categories API (tree)
  useEffect(() => {
    (async () => {
      try {
        const res = await adminProductsService.getCategories();
        const tree = Array.isArray(res.data) ? res.data : [];
        const flat: { id: string; name: string; level: number }[] = [];
        function walk(nodes: any[]) {
          for (const n of nodes) {
            flat.push({ id: n.id, name: n.name, level: n.level ?? 0 });
            if (n.children?.length) walk(n.children);
          }
        }
        walk(tree);
        setParentOptions(flat);
      } catch {}
    })();
  }, []);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminProductsService.listAdminCategories({ page, limit: 50, search: search || undefined });
      if (res.data?.categories) {
        setCategories(res.data.categories);
        setTotal(res.data.pagination?.total || 0);
        setTotalPages(res.data.pagination?.totalPages || 1);
      }
    } catch {}
    setLoading(false);
  }, [page, search]);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const openCreateModal = () => {
    setEditingCat(null);
    setForm({ name: '', parentId: '', description: '', sortOrder: 0 });
    setError('');
    setShowModal(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingCat(cat);
    setForm({
      name: cat.name,
      parentId: cat.parentId || '',
      description: '',
      sortOrder: 0,
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setError('');
    if (!form.name.trim()) { setError('Name is required'); return; }
    try {
      if (editingCat) {
        await adminProductsService.updateCategory(editingCat.id, {
          name: form.name.trim(),
          parentId: form.parentId || null,
        });
        setSuccessMsg('Category updated');
      } else {
        await adminProductsService.createCategory({
          name: form.name.trim(),
          parentId: form.parentId || undefined,
          sortOrder: form.sortOrder,
        });
        setSuccessMsg('Category created');
      }
      setShowModal(false);
      loadCategories();
      // Refresh parent options
      const res = await adminProductsService.getCategories();
      const tree = Array.isArray(res.data) ? res.data : [];
      const flat: { id: string; name: string; level: number }[] = [];
      function walk(nodes: any[]) { for (const n of nodes) { flat.push({ id: n.id, name: n.name, level: n.level ?? 0 }); if (n.children?.length) walk(n.children); } }
      walk(tree);
      setParentOptions(flat);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      setError(err?.body?.message || err.message || 'Failed to save');
    }
  };

  const handleDelete = async (cat: Category) => {const msg = cat._count && (cat._count.products > 0 || cat._count.children > 0)
      ? `This category has ${cat._count.products} product(s) and ${cat._count.children} subcategorie(s). It will be deactivated instead of deleted. Continue?`
      : `Delete category "${cat.name}"?`;
    if (!(await confirmDialog(msg))) return;
    try {
      await adminProductsService.deleteCategory(cat.id);
      setSuccessMsg('Category removed');
      loadCategories();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {}
  };

  const handleToggleActive = async (cat: Category) => {
    try {
      await adminProductsService.updateCategory(cat.id, { isActive: !cat.isActive });
      loadCategories();
    } catch {}
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Categories</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            Manage product categories. {total} total.
          </p>
        </div>
        <button onClick={openCreateModal} style={{
          padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none',
          background: '#2563eb', color: '#fff', cursor: 'pointer',
        }}>
          + Add Category
        </button>
      </div>

      {successMsg && (
        <div style={{ padding: '10px 16px', borderRadius: 8, background: '#dcfce7', color: '#16a34a', fontSize: 13, fontWeight: 500, marginBottom: 16 }}>
          {successMsg}
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search categories..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, width: 300 }}
        />
      </div>

      {/* Table */}
      {loading ? (
        <p style={{ fontSize: 13, color: '#9ca3af' }}>Loading...</p>
      ) : categories.length === 0 ? (
        <p style={{ fontSize: 13, color: '#9ca3af' }}>No categories found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f9fafb' }}>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Slug</th>
              <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Parent</th>
              <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Products</th>
              <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Children</th>
              <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Attributes</th>
              <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Active</th>
              <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '10px 14px', fontWeight: 500, paddingLeft: 14 + cat.level * 20 }}>
                  {cat.level > 0 && <span style={{ color: '#d1d5db', marginRight: 6 }}>{'└'}</span>}
                  {cat.name}
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>{cat.slug}</td>
                <td style={{ padding: '10px 14px', color: '#6b7280' }}>{cat.parent?.name || '—'}</td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>{cat._count?.products ?? 0}</td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>{cat._count?.children ?? 0}</td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>{cat._count?.metafieldDefinitions ?? 0}</td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <button onClick={() => handleToggleActive(cat)} style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: cat.isActive ? '#dcfce7' : '#f3f4f6', color: cat.isActive ? '#16a34a' : '#9ca3af',
                  }}>
                    {cat.isActive ? 'Yes' : 'No'}
                  </button>
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    <button onClick={() => openEditModal(cat)} style={{
                      padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db',
                      background: '#fff', cursor: 'pointer', fontWeight: 500,
                    }}>Edit</button>
                    <button onClick={() => handleDelete(cat)} style={{
                      padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #fecaca',
                      background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontWeight: 500,
                    }}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}>Previous</button>
          <span style={{ padding: '6px 12px', fontSize: 12 }}>Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}>Next</button>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 480 }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              {editingCat ? 'Edit Category' : 'Add Category'}
            </h3>

            {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Name *</label>
                <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Cricket Bats"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Parent Category</label>
                <select value={form.parentId} onChange={(e) => setForm(f => ({ ...f, parentId: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
                  <option value="">None (top-level)</option>
                  {parentOptions
                    .filter(p => p.id !== editingCat?.id)
                    .map(p => (
                      <option key={p.id} value={p.id}>{'  '.repeat(p.level)}{p.name}</option>
                    ))}
                </select>
              </div>

              {!editingCat && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Sort Order</label>
                  <input type="number" value={form.sortOrder} onChange={(e) => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                    style={{ width: 80, padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <button onClick={() => setShowModal(false)} style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 500, borderRadius: 6, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={handleSave} style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none',
                background: '#2563eb', color: '#fff', cursor: 'pointer',
              }}>
                {editingCat ? 'Save Changes' : 'Create Category'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
