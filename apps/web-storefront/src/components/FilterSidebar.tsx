'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

interface FilterValue {
  value: string;
  label: string;
  count: number;
  colorHex?: string;
}

interface FilterGroup {
  key: string;
  label: string;
  type: string; // checkbox, price_range, boolean_toggle, color_swatch
  builtIn: boolean;
  definitionId?: string;
  collapsed: boolean;
  showCounts: boolean;
  values?: FilterValue[];
  range?: { min: number; max: number };
  counts?: { true: number; false: number };
}

interface FilterSidebarProps {
  categoryId?: string;
  collectionId?: string;
  search?: string;
  activeFilters: Record<string, string[]>;
  minPrice?: string;
  maxPrice?: string;
  brandId?: string;
  onFilterChange: (key: string, values: string[]) => void;
  onPriceChange: (min: string, max: string) => void;
  onClearAll: () => void;
}

export default function FilterSidebar({
  categoryId, collectionId, search, activeFilters, minPrice, maxPrice, brandId,
  onFilterChange, onPriceChange, onClearAll,
}: FilterSidebarProps) {
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [priceMin, setPriceMin] = useState(minPrice || '');
  const [priceMax, setPriceMax] = useState(maxPrice || '');

  // Load filter groups ONCE based on context (category/collection/search)
  // Do NOT include activeFilters — groups should remain stable when user selects filters
  const loadFilters = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (categoryId) params.set('categoryId', categoryId);
      if (collectionId) params.set('collectionId', collectionId);
      if (search) params.set('search', search);

      const res = await apiClient<{ filters: FilterGroup[] }>(`/storefront/filters?${params}`);
      const groups = res.data?.filters || [];
      setFilterGroups(groups);

      // Start all groups collapsed by default
      setExpandedGroups(new Set<string>());
    } catch {
      setFilterGroups([]);
    }
    setLoading(false);
  }, [categoryId, collectionId, search]);

  useEffect(() => { loadFilters(); }, [loadFilters]);

  useEffect(() => {
    setPriceMin(minPrice || '');
    setPriceMax(maxPrice || '');
  }, [minPrice, maxPrice]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleCheckboxChange = (groupKey: string, value: string) => {
    const current = activeFilters[groupKey] || [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onFilterChange(groupKey, next);
  };

  const handleBooleanToggle = (groupKey: string) => {
    const current = activeFilters[groupKey] || [];
    const next = current.includes('true') ? [] : ['true'];
    onFilterChange(groupKey, next);
  };

  const handlePriceApply = () => {
    onPriceChange(priceMin, priceMax);
  };

  const hasActiveFilters = Object.values(activeFilters).some((v) => v.length > 0) || !!minPrice || !!maxPrice;

  if (loading) {
    return (
      <div className="filter-sidebar">
        <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading filters...</div>
      </div>
    );
  }

  return (
    <div className="filter-sidebar">
      <div className="filter-sidebar-header">
        <h3>Filters</h3>
        {hasActiveFilters && (
          <button onClick={onClearAll} className="filter-clear-all">Clear all</button>
        )}
      </div>

      {filterGroups.map((group) => {
        const isExpanded = expandedGroups.has(group.key);

        return (
          <div key={group.key} className="filter-group">
            <button className="filter-group-header" onClick={() => toggleGroup(group.key)}>
              <span>{group.label}</span>
              <span className="filter-group-chevron">{isExpanded ? '−' : '+'}</span>
            </button>

            {isExpanded && (
              <div className="filter-group-body">
                {/* Checkbox / Color Swatch filter */}
                {(group.type === 'checkbox' || group.type === 'color_swatch') && group.values && (
                  <div className="filter-values">
                    {group.values.map((val) => {
                      const checked = (activeFilters[group.key] || []).includes(val.value);
                      return (
                        <label key={val.value} className={`filter-value${checked ? ' active' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleCheckboxChange(group.key, val.value)}
                            style={{ display: 'none' }}
                          />
                          {group.type === 'color_swatch' && val.colorHex && (
                            <span
                              className="filter-color-swatch"
                              style={{ background: val.colorHex, border: checked ? '2px solid #2563eb' : '1px solid #d1d5db' }}
                            />
                          )}
                          <span className="filter-value-checkbox">
                            {checked && <span className="filter-check-mark">✓</span>}
                          </span>
                          <span className="filter-value-label">{val.label}</span>
                          {group.showCounts && (
                            <span className="filter-value-count">({val.count})</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Price Range filter */}
                {group.type === 'price_range' && group.range && (
                  <div className="filter-price-range">
                    <div className="filter-price-inputs">
                      <input
                        type="number"
                        placeholder={`Min (${group.range.min})`}
                        value={priceMin}
                        onChange={(e) => setPriceMin(e.target.value)}
                        className="filter-price-input"
                      />
                      <span className="filter-price-sep">—</span>
                      <input
                        type="number"
                        placeholder={`Max (${group.range.max})`}
                        value={priceMax}
                        onChange={(e) => setPriceMax(e.target.value)}
                        className="filter-price-input"
                      />
                    </div>
                    <button onClick={handlePriceApply} className="filter-price-apply">Apply</button>
                  </div>
                )}

                {/* Boolean toggle filter */}
                {group.type === 'boolean_toggle' && (
                  <label className="filter-toggle">
                    <input
                      type="checkbox"
                      checked={(activeFilters[group.key] || []).includes('true')}
                      onChange={() => handleBooleanToggle(group.key)}
                    />
                    <span className="filter-toggle-label">
                      {group.label}
                      {group.showCounts && group.counts && (
                        <span className="filter-value-count"> ({group.counts.true})</span>
                      )}
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
