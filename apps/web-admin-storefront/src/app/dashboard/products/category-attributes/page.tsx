'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminMetafieldsService } from '../../../../services/admin-metafields.service';
import { adminProductsService } from '../../../../services/admin-products.service';

const METAFIELD_TYPES = [
  { value: 'SINGLE_LINE_TEXT', label: 'Single line text' },
  { value: 'MULTI_LINE_TEXT', label: 'Multi-line text' },
  { value: 'NUMBER_INTEGER', label: 'Integer number' },
  { value: 'NUMBER_DECIMAL', label: 'Decimal number' },
  { value: 'BOOLEAN', label: 'True / False' },
  { value: 'DATE', label: 'Date' },
  { value: 'COLOR', label: 'Color' },
  { value: 'URL', label: 'URL' },
  { value: 'RATING', label: 'Rating' },
  { value: 'SINGLE_SELECT', label: 'Single select (dropdown)' },
  { value: 'MULTI_SELECT', label: 'Multi-select (checkboxes)' },
  { value: 'DIMENSION', label: 'Dimension' },
  { value: 'WEIGHT', label: 'Weight' },
  { value: 'VOLUME', label: 'Volume' },
  { value: 'JSON', label: 'JSON' },
  { value: 'FILE_REFERENCE', label: 'File reference' },
];

interface Category { id: string; name: string; slug: string; parentId?: string | null; level: number }
interface MetafieldDef {
  id: string; namespace: string; key: string; name: string; description: string | null;
  type: string; choices: any[] | null; validations: any; ownerType: string;
  categoryId: string | null; pinned: boolean; sortOrder: number; isRequired: boolean;
  isActive: boolean; source?: string; inherited?: boolean;
  category?: { id: string; name: string } | null;
}

export default function CategoryAttributesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [definitions, setDefinitions] = useState<MetafieldDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingDef, setEditingDef] = useState<MetafieldDef | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Form state
  const [form, setForm] = useState({
    namespace: 'taxonomy',
    key: '',
    name: '',
    description: '',
    type: 'SINGLE_LINE_TEXT',
    isRequired: false,
    sortOrder: 0,
    choices: [{ value: '', label: '' }],
  });

  // Load categories (flatten nested tree from API)
  useEffect(() => {
    (async () => {
      try {
        const res = await adminProductsService.getCategories();
        const tree = Array.isArray(res.data) ? res.data : res.data?.categories || [];
        // Flatten the nested tree into a flat list with level property
        function flattenTree(nodes: any[], result: Category[] = []): Category[] {
          for (const node of nodes) {
            result.push({ id: node.id, name: node.name, slug: node.slug, parentId: node.parentId, level: node.level ?? 0 });
            if (node.children?.length) flattenTree(node.children, result);
          }
          return result;
        }
        setCategories(flattenTree(tree));
      } catch {}
    })();
  }, []);

  // Load definitions for selected category
  const loadDefinitions = useCallback(async () => {
    if (!selectedCategoryId) { setDefinitions([]); return; }
    setLoading(true);
    try {
      const res = await adminMetafieldsService.getDefinitionsForCategory(selectedCategoryId);
      if (res.data?.definitions) setDefinitions(res.data.definitions);
    } catch { setDefinitions([]); }
    setLoading(false);
  }, [selectedCategoryId]);

  useEffect(() => { loadDefinitions(); }, [loadDefinitions]);

  const openCreateModal = () => {
    setEditingDef(null);
    setForm({ namespace: 'taxonomy', key: '', name: '', description: '', type: 'SINGLE_LINE_TEXT', isRequired: false, sortOrder: 0, choices: [{ value: '', label: '' }] });
    setError('');
    setShowModal(true);
  };

  const openEditModal = (def: MetafieldDef) => {
    setEditingDef(def);
    setForm({
      namespace: def.namespace,
      key: def.key,
      name: def.name,
      description: def.description || '',
      type: def.type,
      isRequired: def.isRequired,
      sortOrder: def.sortOrder,
      choices: def.choices && Array.isArray(def.choices) && def.choices.length > 0
        ? def.choices.map((c: any) => ({ value: c.value || '', label: c.label || '' }))
        : [{ value: '', label: '' }],
    });
    setError('');
    setShowModal(true);
  };

  const handleNameChange = (name: string) => {
    setForm((f) => ({
      ...f,
      name,
      key: editingDef ? f.key : name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    }));
  };

  const addChoice = () => setForm((f) => ({ ...f, choices: [...f.choices, { value: '', label: '' }] }));
  const removeChoice = (idx: number) => setForm((f) => ({ ...f, choices: f.choices.filter((_, i) => i !== idx) }));
  const updateChoice = (idx: number, field: 'value' | 'label', val: string) => {
    setForm((f) => {
      const choices = [...f.choices];
      choices[idx] = { ...choices[idx], [field]: val };
      // Auto-fill value from label if value is empty
      if (field === 'label' && !choices[idx].value) {
        choices[idx].value = val.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      }
      return { ...f, choices };
    });
  };

  const handleSave = async () => {
    setError('');
    try {
      const isSelect = form.type === 'SINGLE_SELECT' || form.type === 'MULTI_SELECT';
      const validChoices = form.choices.filter((c) => c.value.trim() && c.label.trim());

      const payload: any = {
        namespace: form.namespace,
        key: form.key,
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        isRequired: form.isRequired,
        sortOrder: form.sortOrder,
        ownerType: 'CATEGORY',
        categoryId: selectedCategoryId,
        choices: isSelect ? validChoices : undefined,
      };

      if (editingDef) {
        await adminMetafieldsService.updateDefinition(editingDef.id, payload);
        setSuccessMsg('Definition updated');
      } else {
        await adminMetafieldsService.createDefinition(payload);
        setSuccessMsg('Definition created');
      }
      setShowModal(false);
      loadDefinitions();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this attribute definition?')) return;
    try {
      await adminMetafieldsService.deleteDefinition(id);
      setSuccessMsg('Definition deactivated');
      loadDefinitions();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {}
  };

  const isSelect = form.type === 'SINGLE_SELECT' || form.type === 'MULTI_SELECT';
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Category Attributes</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            Define product attributes (metafields) for each category. Child categories inherit parent attributes.
          </p>
        </div>
      </div>

      {successMsg && (
        <div style={{ padding: '10px 16px', borderRadius: 8, background: '#dcfce7', color: '#16a34a', fontSize: 13, fontWeight: 500, marginBottom: 16 }}>
          {successMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Left panel: Category tree */}
        <div style={{ width: 280, flexShrink: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#374151' }}>Categories</h3>
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                  paddingLeft: 12 + (cat.level || 0) * 16, borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: cat.id === selectedCategoryId ? 600 : 400,
                  background: cat.id === selectedCategoryId ? '#eff6ff' : 'transparent',
                  color: cat.id === selectedCategoryId ? '#2563eb' : '#374151',
                  marginBottom: 2,
                }}
              >
                {cat.level > 0 && <span style={{ color: '#d1d5db', marginRight: 4 }}>└</span>}
                {cat.name}
              </button>
            ))}
            {categories.length === 0 && <p style={{ fontSize: 12, color: '#9ca3af' }}>No categories found</p>}
          </div>
        </div>

        {/* Right panel: Definitions */}
        <div style={{ flex: 1, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          {!selectedCategoryId ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
              <p style={{ fontSize: 15 }}>Select a category to manage its attributes</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
                  {selectedCategory?.name} — Attributes ({definitions.length})
                </h3>
                <button onClick={openCreateModal} style={{
                  padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 6, border: 'none',
                  background: '#2563eb', color: '#fff', cursor: 'pointer',
                }}>
                  + Add Attribute
                </button>
              </div>

              {loading ? (
                <p style={{ fontSize: 13, color: '#9ca3af' }}>Loading...</p>
              ) : definitions.length === 0 ? (
                <p style={{ fontSize: 13, color: '#9ca3af', padding: '20px 0' }}>
                  No attributes defined for this category yet. Click "Add Attribute" to create one.
                </p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#6b7280' }}>Name</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#6b7280' }}>Key</th>
                      <th style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#6b7280' }}>Type</th>
                      <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 600, color: '#6b7280' }}>Required</th>
                      <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 600, color: '#6b7280' }}>Source</th>
                      <th style={{ textAlign: 'center', padding: '8px 10px', fontWeight: 600, color: '#6b7280' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {definitions.map((def) => (
                      <tr key={def.id} style={{ borderBottom: '1px solid #f3f4f6', opacity: def.inherited ? 0.7 : 1 }}>
                        <td style={{ padding: '8px 10px', fontWeight: 500 }}>{def.name}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>
                          {def.namespace}.{def.key}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#6b7280' }}>
                          {METAFIELD_TYPES.find((t) => t.value === def.type)?.label || def.type}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {def.isRequired ? <span style={{ color: '#dc2626', fontWeight: 600 }}>Yes</span> : <span style={{ color: '#9ca3af' }}>No</span>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: def.source === 'own' ? '#dbeafe' : def.source === 'inherited' ? '#f3f4f6' : '#fef3c7',
                            color: def.source === 'own' ? '#2563eb' : def.source === 'inherited' ? '#6b7280' : '#d97706',
                          }}>
                            {def.source === 'own' ? 'Own' : def.source === 'inherited' ? `From ${def.category?.name || 'parent'}` : 'Custom'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {!def.inherited && (
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                              <button onClick={() => openEditModal(def)} style={{
                                padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db',
                                background: '#fff', cursor: 'pointer', fontWeight: 500,
                              }}>
                                Edit
                              </button>
                              <button onClick={() => handleDelete(def.id)} style={{
                                padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #fecaca',
                                background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontWeight: 500,
                              }}>
                                Remove
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 520, maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              {editingDef ? 'Edit Attribute' : 'Add Attribute'}
            </h3>

            {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Name *</label>
                <input value={form.name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g., Material"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Key (auto-generated)</label>
                <input value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} readOnly={!!editingDef}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, fontFamily: 'monospace', background: editingDef ? '#f9fafb' : '#fff' }} />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Namespace</label>
                <select value={form.namespace} onChange={(e) => setForm((f) => ({ ...f, namespace: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
                  <option value="taxonomy">taxonomy (category standard)</option>
                  <option value="custom">custom (merchant-defined)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Type *</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  disabled={false}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, background: editingDef ? '#f9fafb' : '#fff' }}>
                  {METAFIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Description</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional description"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.isRequired} onChange={(e) => setForm((f) => ({ ...f, isRequired: e.target.checked }))} />
                  Required
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Sort order:</label>
                  <input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))}
                    style={{ width: 60, padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }} />
                </div>
              </div>

              {/* Choices for select types */}
              {isSelect && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8 }}>Choices *</label>
                  {form.choices.map((choice, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <input value={choice.label} onChange={(e) => updateChoice(idx, 'label', e.target.value)}
                        placeholder="Label (e.g., Cotton)" style={{ flex: 1, padding: '6px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }} />
                      <input value={choice.value} onChange={(e) => updateChoice(idx, 'value', e.target.value)}
                        placeholder="Value (auto)" style={{ width: 140, padding: '6px 10px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12, fontFamily: 'monospace' }} />
                      {form.choices.length > 1 && (
                        <button onClick={() => removeChoice(idx)} style={{
                          padding: '4px 8px', borderRadius: 4, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626',
                          cursor: 'pointer', fontSize: 12,
                        }}>✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={addChoice} style={{
                    padding: '4px 12px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db',
                    background: '#f9fafb', cursor: 'pointer', marginTop: 4,
                  }}>+ Add choice</button>
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
                {editingDef ? 'Save Changes' : 'Create Attribute'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
