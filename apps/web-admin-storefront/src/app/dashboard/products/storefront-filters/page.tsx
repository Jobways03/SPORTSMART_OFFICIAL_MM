'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminMetafieldsService } from '../../../../services/admin-metafields.service';
import { adminProductsService } from '../../../../services/admin-products.service';
import { apiClient } from '../../../../lib/api-client';

const FILTER_TYPES = [
  { value: 'checkbox', label: 'Checkbox list' },
  { value: 'price_range', label: 'Price range' },
  { value: 'boolean_toggle', label: 'Boolean toggle' },
  { value: 'color_swatch', label: 'Color swatch' },
  { value: 'text_input', label: 'Text input' },
];

const SCOPE_TYPES = [
  { value: 'GLOBAL', label: 'Global (all pages)' },
  { value: 'CATEGORY', label: 'Specific category' },
  { value: 'COLLECTION', label: 'Specific collection' },
];

const BUILT_IN_ICONS: Record<string, string> = {
  brand: 'B',
  price_range: '$',
  availability: 'A',
  variant_option: 'V',
};

interface FilterConfig {
  id: string;
  metafieldDefinitionId: string | null;
  builtInType: string | null;
  label: string;
  filterType: string;
  sortOrder: number;
  isActive: boolean;
  scopeType: string | null;
  scopeId: string | null;
  collapsed: boolean;
  showCounts: boolean;
  metafieldDefinition?: {
    id: string; namespace: string; key: string; name: string; type: string;
  } | null;
}

interface MetafieldDef {
  id: string; namespace: string; key: string; name: string; type: string;
  ownerType: string; categoryId: string | null;
}

// Auto-generated filter preview item
interface AutoFilter {
  key: string;
  label: string;
  source: string;
  type: string;
  category?: string;
}

interface ScopeOption { id: string; name: string; level?: number }

export default function StorefrontFiltersPage() {
  const [filters, setFilters] = useState<FilterConfig[]>([]);
  const [definitions, setDefinitions] = useState<MetafieldDef[]>([]);
  const [autoFilters, setAutoFilters] = useState<AutoFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [categories, setCategories] = useState<ScopeOption[]>([]);
  const [collections, setCollections] = useState<ScopeOption[]>([]);
  const [editingFilter, setEditingFilter] = useState<FilterConfig | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [tab, setTab] = useState<'manual' | 'auto'>('auto');

  const [form, setForm] = useState({
    source: 'built_in' as 'built_in' | 'metafield',
    builtInType: 'brand',
    metafieldDefinitionId: '',
    label: '',
    filterType: 'checkbox',
    scopeType: 'GLOBAL',
    scopeId: '',
    collapsed: false,
    showCounts: true,
  });

  const loadFilters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminMetafieldsService.listFilters();
      if (res.data?.filters) setFilters(res.data.filters);
    } catch {}
    setLoading(false);
  }, []);

  const loadDefinitions = useCallback(async () => {
    try {
      const res = await adminMetafieldsService.listDefinitions({ isActive: 'true' } as any);
      if (res.data?.definitions) setDefinitions(res.data.definitions);
    } catch {}
  }, []);

  // Load categories and collections for scope picker
  useEffect(() => {
    adminProductsService.getCategories().then((res) => {
      const tree = Array.isArray(res.data) ? res.data : [];
      const flat: ScopeOption[] = [];
      function walk(nodes: any[]) { for (const n of nodes) { flat.push({ id: n.id, name: n.name, level: n.level ?? 0 }); if (n.children?.length) walk(n.children); } }
      walk(tree);
      setCategories(flat);
    }).catch(() => {});
    apiClient('/admin/collections?limit=100').then((res: any) => {
      setCollections((res.data?.collections || []).map((c: any) => ({ id: c.id, name: c.name })));
    }).catch(() => {});
  }, []);

  // Build auto-generated filter preview from metafield definitions
  const loadAutoPreview = useCallback(async () => {
    try {
      const res = await adminMetafieldsService.listDefinitions({ isActive: 'true' } as any);
      const defs: MetafieldDef[] = res.data?.definitions || [];

      const auto: AutoFilter[] = [
        { key: 'brand', label: 'Brand', source: 'Built-in', type: 'Checkbox list' },
        { key: 'price_range', label: 'Price', source: 'Built-in', type: 'Price range' },
        { key: 'availability', label: 'Availability', source: 'Built-in', type: 'Checkbox list' },
      ];

      // Add metafield-based filters (unique by key)
      const seenKeys = new Set<string>();
      const selectTypes = ['SINGLE_SELECT', 'MULTI_SELECT', 'BOOLEAN', 'COLOR'];
      for (const def of defs) {
        if (!selectTypes.includes(def.type)) continue;
        if (seenKeys.has(def.key)) continue;
        seenKeys.add(def.key);

        let filterType = 'Checkbox list';
        if (def.type === 'BOOLEAN') filterType = 'Boolean toggle';
        else if (def.type === 'COLOR') filterType = 'Color swatch';

        auto.push({
          key: def.key,
          label: def.name,
          source: `Metafield (${def.namespace}.${def.key})`,
          type: filterType,
        });
      }
      setAutoFilters(auto);
    } catch {}
  }, []);

  useEffect(() => {
    loadFilters();
    loadDefinitions();
    loadAutoPreview();
  }, [loadFilters, loadDefinitions, loadAutoPreview]);

  // Switch to manual tab if manual filters exist
  useEffect(() => {
    if (filters.length > 0) setTab('manual');
  }, [filters]);

  const openCreateModal = () => {
    setEditingFilter(null);
    setForm({ source: 'built_in', builtInType: 'brand', metafieldDefinitionId: '', label: '', filterType: 'checkbox', scopeType: 'GLOBAL', scopeId: '', collapsed: false, showCounts: true });
    setError('');
    setShowModal(true);
  };

  const openEditModal = (filter: FilterConfig) => {
    setEditingFilter(filter);
    setForm({
      source: filter.builtInType ? 'built_in' : 'metafield',
      builtInType: filter.builtInType || 'brand',
      metafieldDefinitionId: filter.metafieldDefinitionId || '',
      label: filter.label,
      filterType: filter.filterType,
      scopeType: filter.scopeType || 'GLOBAL',
      scopeId: filter.scopeId || '',
      collapsed: filter.collapsed,
      showCounts: filter.showCounts,
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setError('');
    if (!form.label.trim()) { setError('Label is required'); return; }
    try {
      if ((form.scopeType === 'CATEGORY' || form.scopeType === 'COLLECTION') && !form.scopeId) {
        setError(`Please select a ${form.scopeType === 'CATEGORY' ? 'category' : 'collection'}`);
        return;
      }
      const payload: any = {
        label: form.label,
        filterType: form.filterType,
        scopeType: form.scopeType,
        scopeId: form.scopeType !== 'GLOBAL' ? form.scopeId : null,
        collapsed: form.collapsed,
        showCounts: form.showCounts,
      };
      if (form.source === 'built_in') {
        payload.builtInType = form.builtInType;
      } else {
        if (!form.metafieldDefinitionId) { setError('Select a metafield definition'); return; }
        payload.metafieldDefinitionId = form.metafieldDefinitionId;
      }
      if (editingFilter) {
        await adminMetafieldsService.updateFilter(editingFilter.id, payload);
        setSuccessMsg('Filter updated');
      } else {
        await adminMetafieldsService.createFilter(payload);
        setSuccessMsg('Filter created');
      }
      setShowModal(false);
      loadFilters();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    }
  };

  const handleToggleActive = async (filter: FilterConfig) => {
    try {
      await adminMetafieldsService.updateFilter(filter.id, { isActive: !filter.isActive });
      loadFilters();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this filter configuration?')) return;
    try {
      await adminMetafieldsService.deleteFilter(id);
      setSuccessMsg('Filter deleted');
      loadFilters();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {}
  };

  const handleMoveUp = async (idx: number) => {
    if (idx === 0) return;
    const newOrder = [...filters];
    [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];
    setFilters(newOrder);
    await adminMetafieldsService.reorderFilters(newOrder.map((f) => f.id));
  };

  const handleMoveDown = async (idx: number) => {
    if (idx === filters.length - 1) return;
    const newOrder = [...filters];
    [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];
    setFilters(newOrder);
    await adminMetafieldsService.reorderFilters(newOrder.map((f) => f.id));
  };

  const isAutoMode = filters.length === 0;

  return (
    <div style={{ padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Storefront Filters</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>
            Configure which filters customers see when browsing products.
          </p>
        </div>
        <button onClick={openCreateModal} style={{
          padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
          background: '#2563eb', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          + Add Filter
        </button>
      </div>

      {successMsg && (
        <div style={{ padding: '10px 16px', borderRadius: 8, background: '#dcfce7', color: '#16a34a', fontSize: 13, fontWeight: 500, marginBottom: 16 }}>
          {successMsg}
        </div>
      )}

      {/* Status banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10,
        background: isAutoMode ? '#eff6ff' : '#f0fdf4', border: `1px solid ${isAutoMode ? '#bfdbfe' : '#bbf7d0'}`,
        marginBottom: 20,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isAutoMode ? '#2563eb' : '#16a34a', color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0,
        }}>
          {isAutoMode ? 'A' : 'M'}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: isAutoMode ? '#1e40af' : '#166534' }}>
            {isAutoMode ? 'Auto-Generated Mode' : 'Manual Mode'}
          </div>
          <div style={{ fontSize: 12, color: isAutoMode ? '#3b82f6' : '#22c55e' }}>
            {isAutoMode
              ? 'Filters are dynamically generated from category metafield definitions (Brand, Price, Availability + all SELECT/BOOLEAN attributes).'
              : `${filters.length} manual filter${filters.length !== 1 ? 's' : ''} configured. Auto-generation is overridden.`}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 0, borderBottom: '2px solid #e5e7eb' }}>
        <button
          onClick={() => setTab('auto')}
          style={{
            padding: '10px 20px', fontSize: 13, fontWeight: tab === 'auto' ? 600 : 400, cursor: 'pointer',
            border: 'none', borderBottom: tab === 'auto' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none', color: tab === 'auto' ? '#2563eb' : '#6b7280', marginBottom: -2,
          }}
        >
          Auto-Generated Preview ({autoFilters.length})
        </button>
        <button
          onClick={() => setTab('manual')}
          style={{
            padding: '10px 20px', fontSize: 13, fontWeight: tab === 'manual' ? 600 : 400, cursor: 'pointer',
            border: 'none', borderBottom: tab === 'manual' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none', color: tab === 'manual' ? '#2563eb' : '#6b7280', marginBottom: -2,
          }}
        >
          Manual Filters ({filters.length})
        </button>
      </div>

      {/* Tab content */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 10px 10px', overflow: 'hidden' }}>

        {/* AUTO TAB */}
        {tab === 'auto' && (
          <>
            {autoFilters.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af' }}>
                <p>No auto-generated filters available. Add metafield definitions to categories first.</p>
              </div>
            ) : (
              <>
                <div style={{ padding: '12px 16px', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: 12, color: '#6b7280' }}>
                  These filters are automatically shown to customers based on category metafield definitions.
                  {isAutoMode ? ' Currently active on the storefront.' : ' Currently overridden by manual filters.'}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 600, color: '#6b7280', width: 50 }}>#</th>
                      <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Label</th>
                      <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Source</th>
                      <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Filter Type</th>
                      <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoFilters.map((af, idx) => {
                      const isBuiltIn = af.source === 'Built-in';
                      return (
                        <tr key={af.key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '10px 8px', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>{idx + 1}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{
                                width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 11, fontWeight: 700,
                                background: isBuiltIn ? '#f3f4f6' : '#eff6ff',
                                color: isBuiltIn ? '#6b7280' : '#2563eb',
                              }}>
                                {isBuiltIn ? BUILT_IN_ICONS[af.key] || 'B' : af.label.charAt(0).toUpperCase()}
                              </div>
                              <span style={{ fontWeight: 500 }}>{af.label}</span>
                            </div>
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
                              background: isBuiltIn ? '#f3f4f6' : '#eff6ff',
                              color: isBuiltIn ? '#6b7280' : '#2563eb',
                            }}>
                              {af.source}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', color: '#6b7280' }}>{af.type}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                            <span style={{
                              padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                              background: isAutoMode ? '#dcfce7' : '#fef3c7',
                              color: isAutoMode ? '#16a34a' : '#d97706',
                            }}>
                              {isAutoMode ? 'Active' : 'Overridden'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}

        {/* MANUAL TAB */}
        {tab === 'manual' && (
          <>
            {loading ? (
              <p style={{ padding: 20, fontSize: 13, color: '#9ca3af' }}>Loading filters...</p>
            ) : filters.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af' }}>
                <p style={{ fontSize: 14, marginBottom: 4 }}>No manual filters configured.</p>
                <p style={{ fontSize: 12 }}>
                  Auto-generated filters are active. Click &quot;+ Add Filter&quot; to take manual control.
                </p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 600, color: '#6b7280', width: 60 }}>Order</th>
                    <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Label</th>
                    <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Source</th>
                    <th style={{ textAlign: 'left', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Type</th>
                    <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Scope</th>
                    <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Active</th>
                    <th style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 600, color: '#6b7280' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filters.map((f, idx) => (
                    <tr key={f.id} style={{ borderBottom: '1px solid #f3f4f6', opacity: f.isActive ? 1 : 0.5 }}>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <button onClick={() => handleMoveUp(idx)} disabled={idx === 0} style={{ border: 'none', background: 'none', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 11, color: idx === 0 ? '#d1d5db' : '#6b7280', padding: '1px 4px' }}>&#9650;</button>
                          <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{idx + 1}</span>
                          <button onClick={() => handleMoveDown(idx)} disabled={idx === filters.length - 1} style={{ border: 'none', background: 'none', cursor: idx === filters.length - 1 ? 'default' : 'pointer', fontSize: 11, color: idx === filters.length - 1 ? '#d1d5db' : '#6b7280', padding: '1px 4px' }}>&#9660;</button>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 500 }}>{f.label}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {f.builtInType ? (
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: '#f3f4f6', color: '#6b7280' }}>
                            Built-in: {f.builtInType}
                          </span>
                        ) : f.metafieldDefinition ? (
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: '#eff6ff', color: '#2563eb' }}>
                            {f.metafieldDefinition.namespace}.{f.metafieldDefinition.key}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#6b7280' }}>
                        {FILTER_TYPES.find((t) => t.value === f.filterType)?.label || f.filterType}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 12, color: '#6b7280' }}>
                        {f.scopeType || 'Global'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button onClick={() => handleToggleActive(f)} style={{
                          padding: '3px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                          background: f.isActive ? '#dcfce7' : '#f3f4f6', color: f.isActive ? '#16a34a' : '#9ca3af',
                        }}>
                          {f.isActive ? 'ON' : 'OFF'}
                        </button>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button onClick={() => openEditModal(f)} style={{
                            padding: '4px 10px', fontSize: 11, borderRadius: 4, border: '1px solid #d1d5db',
                            background: '#fff', cursor: 'pointer', fontWeight: 500,
                          }}>Edit</button>
                          <button onClick={() => handleDelete(f.id)} style={{
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
          </>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 0, width: 500, maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            {/* Modal Header */}
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #e5e7eb' }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
                {editingFilter ? 'Edit Filter' : 'Add Filter'}
              </h3>
              <p style={{ fontSize: 12, color: '#6b7280', margin: '4px 0 0' }}>
                {editingFilter ? 'Modify this filter configuration.' : 'Add a new filter to the storefront sidebar.'}
              </p>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '20px 24px' }}>
              {error && <div style={{ padding: '8px 12px', borderRadius: 6, background: '#fef2f2', color: '#dc2626', fontSize: 13, marginBottom: 14 }}>{error}</div>}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Source toggle */}
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Filter Source</label>
                  <div style={{ display: 'flex', gap: 0, border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden' }}>
                    <button onClick={() => setForm((f) => ({ ...f, source: 'built_in' }))} style={{
                      flex: 1, padding: '8px 16px', fontSize: 13, cursor: 'pointer', border: 'none',
                      background: form.source === 'built_in' ? '#2563eb' : '#fff',
                      color: form.source === 'built_in' ? '#fff' : '#374151',
                      fontWeight: form.source === 'built_in' ? 600 : 400,
                    }}>Built-in</button>
                    <button onClick={() => setForm((f) => ({ ...f, source: 'metafield' }))} style={{
                      flex: 1, padding: '8px 16px', fontSize: 13, cursor: 'pointer', border: 'none', borderLeft: '1px solid #d1d5db',
                      background: form.source === 'metafield' ? '#2563eb' : '#fff',
                      color: form.source === 'metafield' ? '#fff' : '#374151',
                      fontWeight: form.source === 'metafield' ? 600 : 400,
                    }}>Metafield Attribute</button>
                  </div>
                </div>

                {form.source === 'built_in' ? (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Built-in Type</label>
                    <select value={form.builtInType} onChange={(e) => {
                      const bt = e.target.value;
                      setForm((f) => ({ ...f, builtInType: bt, label: f.label || bt.charAt(0).toUpperCase() + bt.slice(1).replace('_', ' '), filterType: bt === 'price_range' ? 'price_range' : 'checkbox' }));
                    }} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
                      <option value="brand">Brand</option>
                      <option value="price_range">Price Range</option>
                      <option value="availability">Availability</option>
                      <option value="variant_option">Variant Option</option>
                    </select>
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Metafield Definition</label>
                    <select value={form.metafieldDefinitionId} onChange={(e) => {
                      const defId = e.target.value;
                      const def = definitions.find((d) => d.id === defId);
                      setForm((f) => ({
                        ...f,
                        metafieldDefinitionId: defId,
                        label: f.label || def?.name || '',
                        filterType: def?.type === 'BOOLEAN' ? 'boolean_toggle' : def?.type === 'COLOR' ? 'color_swatch' : 'checkbox',
                      }));
                    }} style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
                      <option value="">Select an attribute...</option>
                      {definitions.map((d) => (
                        <option key={d.id} value={d.id}>{d.name} ({d.namespace}.{d.key}) - {d.type}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Label (customer-facing) *</label>
                  <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g., Material"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }} />
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Filter Type</label>
                    <select value={form.filterType} onChange={(e) => setForm((f) => ({ ...f, filterType: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
                      {FILTER_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Scope</label>
                    <select value={form.scopeType} onChange={(e) => setForm((f) => ({ ...f, scopeType: e.target.value, scopeId: '' }))}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
                      {SCOPE_TYPES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Category / Collection picker */}
                {form.scopeType === 'CATEGORY' && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Select Category *</label>
                    <select value={form.scopeId} onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
                      <option value="">Choose a category...</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{'  '.repeat(c.level || 0)}{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {form.scopeType === 'COLLECTION' && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Select Collection *</label>
                    <select value={form.scopeId} onChange={(e) => setForm((f) => ({ ...f, scopeId: e.target.value }))}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}>
                      <option value="">Choose a collection...</option>
                      {collections.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 20, padding: '4px 0' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.showCounts} onChange={(e) => setForm((f) => ({ ...f, showCounts: e.target.checked }))}
                      style={{ width: 16, height: 16, accentColor: '#2563eb' }} />
                    Show counts
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.collapsed} onChange={(e) => setForm((f) => ({ ...f, collapsed: e.target.checked }))}
                      style={{ width: 16, height: 16, accentColor: '#2563eb' }} />
                    Start collapsed
                  </label>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '16px 24px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowModal(false)} style={{
                padding: '9px 20px', fontSize: 13, fontWeight: 500, borderRadius: 8, border: '1px solid #d1d5db',
                background: '#fff', cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={handleSave} style={{
                padding: '9px 24px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
                background: '#2563eb', color: '#fff', cursor: 'pointer',
              }}>
                {editingFilter ? 'Save Changes' : 'Add Filter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
