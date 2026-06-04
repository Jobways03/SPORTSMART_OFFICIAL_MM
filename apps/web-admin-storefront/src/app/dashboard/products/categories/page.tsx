'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { adminProductsService } from '../../../../services/admin-products.service';
import { useModal } from '@sportsmart/ui';

interface Category {
  id: string;
  name: string;
  slug: string;
  level: number;
  parentId: string | null;
  sortOrder?: number;
  isActive: boolean;
  parent?: { id: string; name: string; slug: string } | null;
  _count?: { products: number; children: number; metafieldDefinitions: number };
}

/**
 * Phase 34 (2026-05-21) — group categories into "drag scopes". Drag is
 * only allowed within a single (parentId, level) bucket so the reorder
 * call doesn't have to deal with cross-parent re-parenting (that path
 * stays on the edit modal which runs the cycle + level-cascade
 * machinery). The list rendering preserves the existing flat indented
 * structure so the visual contract for admins is unchanged.
 */
function groupBySiblings(categories: Category[]): Map<string, Category[]> {
  const groups = new Map<string, Category[]>();
  for (const cat of categories) {
    const key = cat.parentId ?? 'ROOT';
    const arr = groups.get(key) ?? [];
    arr.push(cat);
    groups.set(key, arr);
  }
  return groups;
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
  // Phase 33 (2026-05-21) — switched to listAdminCategories so inactive
  // categories are visible in the parent picker. Pre-Phase-33 the
  // public /catalog/categories endpoint (active-only) hid inactive
  // parents from the dropdown — admins couldn't reorganize children
  // of a deactivated parent without re-activating it first.
  const [parentOptions, setParentOptions] = useState<{ id: string; name: string; level: number; isActive: boolean }[]>([]);

  // Form state — Phase 33 surfaces description, slug, SEO and image
  // fields that the schema has always carried but the UI never exposed.
  // `description` was previously captured but silently dropped on
  // submit (audit #12).
  const [form, setForm] = useState({
    name: '',
    slug: '',
    parentId: '',
    description: '',
    imageUrl: '',
    bannerUrl: '',
    metaTitle: '',
    metaDescription: '',
    sortOrder: 0,
  });

  const loadParentOptions = useCallback(async () => {
    try {
      // Phase 33 — admin list endpoint includes inactive categories.
      const res = await adminProductsService.listAdminCategories({ page: 1, limit: 500 });
      const rows = res.data?.categories ?? [];
      setParentOptions(
        rows.map((c: { id: string; name: string; level?: number; isActive?: boolean }) => ({
          id: c.id,
          name: c.name,
          level: c.level ?? 0,
          isActive: c.isActive !== false,
        })),
      );
    } catch {}
  }, []);

  useEffect(() => {
    loadParentOptions();
  }, [loadParentOptions]);

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
    setForm({
      name: '',
      slug: '',
      parentId: '',
      description: '',
      imageUrl: '',
      bannerUrl: '',
      metaTitle: '',
      metaDescription: '',
      sortOrder: 0,
    });
    setError('');
    setShowModal(true);
  };

  const openEditModal = (cat: Category) => {
    setEditingCat(cat);
    setForm({
      name: cat.name,
      slug: cat.slug ?? '',
      parentId: cat.parentId || '',
      description: (cat as any).description ?? '',
      imageUrl: (cat as any).imageUrl ?? '',
      bannerUrl: (cat as any).bannerUrl ?? '',
      metaTitle: (cat as any).metaTitle ?? '',
      metaDescription: (cat as any).metaDescription ?? '',
      sortOrder: cat.sortOrder ?? 0,
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setError('');
    if (!form.name.trim()) { setError('Name is required'); return; }
    // Phase 33 (2026-05-21) — payload now includes every schema field
    // the modal exposes. Pre-Phase-33 the create call sent only
    // {name, parentId, sortOrder} and silently dropped description /
    // SEO inputs (audit #12).
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      parentId: form.parentId || null,
      sortOrder: form.sortOrder,
      description: form.description.trim() || null,
      imageUrl: form.imageUrl.trim() || null,
      bannerUrl: form.bannerUrl.trim() || null,
      metaTitle: form.metaTitle.trim() || null,
      metaDescription: form.metaDescription.trim() || null,
    };
    if (form.slug.trim()) payload.slug = form.slug.trim();
    try {
      if (editingCat) {
        // payload carries every Phase-33 category field (incl. SEO/image
        // fields the API accepts but the service signature predates); cast
        // to the method's declared param type rather than widen the shared
        // service here.
        await adminProductsService.updateCategory(
          editingCat.id,
          payload as Parameters<typeof adminProductsService.updateCategory>[1],
        );
        setSuccessMsg('Category updated');
      } else {
        await adminProductsService.createCategory(
          payload as Parameters<typeof adminProductsService.createCategory>[0],
        );
        setSuccessMsg('Category created');
      }
      setShowModal(false);
      loadCategories();
      await loadParentOptions();
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

  // Phase 34 (2026-05-21) — drag-reorder via @dnd-kit. The drop
  // handler restricts the move to siblings under the same parent:
  //   - If source and target share parentId, send the new sortOrder
  //     batch to the backend.
  //   - Otherwise refuse (user tried to drag across parents — that
  //     path is the edit modal's job; it runs the cycle + level
  //     cascade machinery).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const siblingGroups = useMemo(() => groupBySiblings(categories), [categories]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const sourceCat = categories.find((c) => c.id === active.id);
    const targetCat = categories.find((c) => c.id === over.id);
    if (!sourceCat || !targetCat) return;

    if ((sourceCat.parentId ?? null) !== (targetCat.parentId ?? null)) {
      notify(
        'Cannot drag across different parents. Use the Edit dialog to re-parent a category.',
      );
      return;
    }

    const siblings = siblingGroups.get(sourceCat.parentId ?? 'ROOT') ?? [];
    const oldIndex = siblings.findIndex((c) => c.id === active.id);
    const newIndex = siblings.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(siblings, oldIndex, newIndex);
    const items = reordered.map((c, i) => ({ id: c.id, sortOrder: i }));

    // Optimistic update — the list snaps to the new order even before
    // the request lands. On failure we re-fetch to revert.
    const optimistic = categories.map((c) => {
      const i = items.findIndex((x) => x.id === c.id);
      return i >= 0 ? { ...c, sortOrder: i } : c;
    });
    setCategories(optimistic);

    try {
      await adminProductsService.reorderCategories(items);
      setSuccessMsg('Categories reordered');
      setTimeout(() => setSuccessMsg(''), 2000);
    } catch (err: any) {
      notify(err?.body?.message || 'Reorder failed — reverting');
      loadCategories();
    }
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
              <th style={{ width: 30 }} aria-label="Drag handle" />
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {categories.map((cat) => (
                  <SortableCategoryRow
                    key={cat.id}
                    cat={cat}
                    onEdit={openEditModal}
                    onDelete={handleDelete}
                    onToggleActive={handleToggleActive}
                  />
                ))}
              </tbody>
            </SortableContext>
          </DndContext>
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
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              {editingCat ? 'Edit Category' : 'Add Category'}
            </h3>

            {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Name *</label>
                <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Cricket Bats"
                  maxLength={100}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  Slug <span style={{ color: '#6b7280', fontWeight: 400 }}>(URL segment — auto-generated from name if left blank)</span>
                </label>
                <input value={form.slug} onChange={(e) => setForm(f => ({ ...f, slug: e.target.value }))}
                  placeholder="cricket-bats"
                  maxLength={80}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, fontFamily: 'monospace' }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Parent Category</label>
                <select value={form.parentId} onChange={(e) => setForm(f => ({ ...f, parentId: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
                  <option value="">None (top-level)</option>
                  {parentOptions
                    .filter(p => p.id !== editingCat?.id)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {'  '.repeat(p.level)}{p.name}{p.isActive ? '' : ' (inactive)'}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Description</label>
                <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  maxLength={2000}
                  rows={3}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Image URL (thumbnail)</label>
                  <input value={form.imageUrl} onChange={(e) => setForm(f => ({ ...f, imageUrl: e.target.value }))}
                    placeholder="https://res.cloudinary.com/..."
                    maxLength={2048}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Banner URL (wide)</label>
                  <input value={form.bannerUrl} onChange={(e) => setForm(f => ({ ...f, bannerUrl: e.target.value }))}
                    placeholder="https://res.cloudinary.com/..."
                    maxLength={2048}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  Meta Title <span style={{ color: '#6b7280', fontWeight: 400 }}>({form.metaTitle.length}/60)</span>
                </label>
                <input value={form.metaTitle} onChange={(e) => setForm(f => ({ ...f, metaTitle: e.target.value.slice(0, 60) }))}
                  maxLength={60}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  Meta Description <span style={{ color: '#6b7280', fontWeight: 400 }}>({form.metaDescription.length}/160)</span>
                </label>
                <textarea value={form.metaDescription} onChange={(e) => setForm(f => ({ ...f, metaDescription: e.target.value.slice(0, 160) }))}
                  maxLength={160}
                  rows={2}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical' }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Sort Order</label>
                <input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                  style={{ width: 100, padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
              </div>
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

/**
 * Phase 34 (2026-05-21) — draggable table row. The handle column on
 * the left is the only drag-initiator (`{...listeners}` only on that
 * cell), so clicking elsewhere on the row still works normally for
 * Edit / Delete / Toggle buttons.
 */
function SortableCategoryRow({
  cat,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  cat: Category;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
  onToggleActive: (c: Category) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: cat.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: isDragging ? '#f1f5f9' : 'transparent',
    opacity: isDragging ? 0.7 : 1,
    borderBottom: '1px solid #f3f4f6',
  };

  return (
    <tr ref={setNodeRef} style={style}>
      <td
        style={{ padding: '10px 6px', textAlign: 'center', cursor: 'grab', color: '#94a3b8', userSelect: 'none' }}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        title="Drag to reorder siblings"
      >
        ⋮⋮
      </td>
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
        <button onClick={() => onToggleActive(cat)} style={{
          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
          background: cat.isActive ? '#dcfce7' : '#f3f4f6', color: cat.isActive ? '#16a34a' : '#9ca3af',
        }}>
          {cat.isActive ? 'Yes' : 'No'}
        </button>
      </td>
      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          <button onClick={() => onEdit(cat)} style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db',
            background: '#fff', cursor: 'pointer', fontWeight: 500,
          }}>Edit</button>
          {/* Phase 36 (2026-05-21) — audit log entry point */}
          <a
            href={`/dashboard/products/categories/${cat.id}/audit-log`}
            style={{
              padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db',
              background: '#fff', textDecoration: 'none', fontWeight: 500, color: '#374151',
            }}
          >Audit</a>
          <button onClick={() => onDelete(cat)} style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #fecaca',
            background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontWeight: 500,
          }}>Delete</button>
        </div>
      </td>
    </tr>
  );
}
