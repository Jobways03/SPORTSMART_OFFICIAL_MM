'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';
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
  type: string;
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
  onLabelsChange?: (labels: Record<string, Record<string, string>>) => void;
}

const SHORT_LIST_LIMIT = 6;
const SEARCHABLE_THRESHOLD = 8;

export default function FilterSidebar({
  categoryId, collectionId, search, activeFilters, minPrice, maxPrice,
  onFilterChange, onPriceChange, onClearAll, onLabelsChange,
}: FilterSidebarProps) {
  const [filterGroups, setFilterGroups] = useState<FilterGroup[]>([]);
  const [loading, setLoading] = useState(true);
  // Default open — feels less hidden on a clean cream layout.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [searchByGroup, setSearchByGroup] = useState<Record<string, string>>({});
  const [priceMin, setPriceMin] = useState(minPrice || '');
  const [priceMax, setPriceMax] = useState(maxPrice || '');

  const loadFilters = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (categoryId) params.set('categoryId', categoryId);
      if (collectionId) params.set('collectionId', collectionId);
      if (search) params.set('search', search);
      const res = await apiClient<{ filters: FilterGroup[] }>(`/storefront/filters?${params}`);
      setFilterGroups(res.data?.filters || []);
    } catch {
      setFilterGroups([]);
    }
    setLoading(false);
  }, [categoryId, collectionId, search]);

  useEffect(() => { loadFilters(); }, [loadFilters]);

  // Push value→label maps up so the chips can show real names instead of UUIDs.
  useEffect(() => {
    if (!onLabelsChange) return;
    const map: Record<string, Record<string, string>> = {};
    for (const g of filterGroups) {
      if (g.values && g.values.length) {
        map[g.key] = {};
        for (const v of g.values) map[g.key][v.value] = v.label;
      }
    }
    onLabelsChange(map);
  }, [filterGroups, onLabelsChange]);

  useEffect(() => {
    setPriceMin(minPrice || '');
    setPriceMax(maxPrice || '');
  }, [minPrice, maxPrice]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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

  const handlePriceApply = () => onPriceChange(priceMin, priceMax);

  const activeCount = useMemo(
    () =>
      Object.values(activeFilters).reduce((s, v) => s + v.length, 0) +
      (minPrice || maxPrice ? 1 : 0),
    [activeFilters, minPrice, maxPrice],
  );

  const priceDirty = priceMin !== (minPrice || '') || priceMax !== (maxPrice || '');

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-5 w-24 bg-ink-100 animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2.5">
            <div className="h-4 w-32 bg-ink-100 animate-pulse" />
            <div className="h-3 w-full bg-ink-100 animate-pulse" />
            <div className="h-3 w-5/6 bg-ink-100 animate-pulse" />
            <div className="h-3 w-4/6 bg-ink-100 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Sidebar header — single, with active count badge + clear-all */}
      <div className="flex items-center justify-between pb-3 mb-1 border-b border-ink-200">
        <div className="flex items-center gap-2">
          <h3 className="text-caption uppercase tracking-[0.18em] font-semibold text-ink-900">
            Filters
          </h3>
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 bg-ink-900 text-white text-[11px] font-semibold tabular rounded-full">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 ? (
          <button
            onClick={onClearAll}
            className="text-caption text-accent-dark hover:text-ink-900 font-semibold underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        ) : (
          <span className="text-caption text-ink-500">No filters applied</span>
        )}
      </div>

      <div className="divide-y divide-ink-200">
        {filterGroups.map((group) => {
          const isCollapsed = collapsedGroups.has(group.key);
          const groupActiveCount = (activeFilters[group.key] || []).length;
          const isExpanded = expandedGroups.has(group.key);
          const sectionSearch = searchByGroup[group.key] || '';
          const lcSearch = sectionSearch.trim().toLowerCase();

          // Pre-filter values by search and split into active-first ordering
          let visibleValues = group.values ?? [];
          if (lcSearch) {
            visibleValues = visibleValues.filter((v) =>
              v.label.toLowerCase().includes(lcSearch),
            );
          }
          // Promote checked values to the top so they don't disappear behind "show more"
          const activeSet = new Set(activeFilters[group.key] || []);
          if (activeSet.size) {
            visibleValues = [
              ...visibleValues.filter((v) => activeSet.has(v.value)),
              ...visibleValues.filter((v) => !activeSet.has(v.value)),
            ];
          }
          const showSearch =
            (group.values?.length ?? 0) >= SEARCHABLE_THRESHOLD &&
            (group.type === 'checkbox' || group.type === 'color_swatch');
          const overflow = visibleValues.length - SHORT_LIST_LIMIT;
          const renderValues =
            !lcSearch && !isExpanded && overflow > 0
              ? visibleValues.slice(0, SHORT_LIST_LIMIT)
              : visibleValues;

          return (
            <div key={group.key} className="py-4">
              <button
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center justify-between text-body font-semibold text-ink-900 group"
              >
                <span className="flex items-center gap-2">
                  {group.label}
                  {groupActiveCount > 0 && (
                    <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 bg-accent-soft text-accent-dark text-[10px] font-bold tabular rounded-full">
                      {groupActiveCount}
                    </span>
                  )}
                </span>
                <ChevronDown
                  className={`size-4 text-ink-500 group-hover:text-ink-900 transition-transform ${
                    isCollapsed ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!isCollapsed && (
                <div className="mt-3">
                  {(group.type === 'checkbox' || group.type === 'color_swatch') && group.values && (
                    <>
                      {showSearch && (
                        <div className="relative mb-2.5">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-ink-500 pointer-events-none" />
                          <input
                            type="text"
                            placeholder={`Search ${group.label.toLowerCase()}`}
                            value={sectionSearch}
                            onChange={(e) =>
                              setSearchByGroup((p) => ({ ...p, [group.key]: e.target.value }))
                            }
                            className="w-full h-8 pl-8 pr-7 border border-ink-200 hover:border-ink-400 focus:border-ink-900 focus:outline-none text-caption bg-white rounded-full"
                          />
                          {sectionSearch && (
                            <button
                              type="button"
                              onClick={() =>
                                setSearchByGroup((p) => ({ ...p, [group.key]: '' }))
                              }
                              aria-label="Clear search"
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 size-5 grid place-items-center text-ink-500 hover:text-ink-900"
                            >
                              <X className="size-3" />
                            </button>
                          )}
                        </div>
                      )}

                      {renderValues.length === 0 ? (
                        <div className="text-caption text-ink-500 py-2">
                          No matches.
                        </div>
                      ) : (
                        <ul
                          className={`space-y-1.5 pr-1 ${
                            isExpanded ? 'max-h-72 overflow-y-auto' : ''
                          }`}
                        >
                          {renderValues.map((val) => {
                            const checked = activeSet.has(val.value);
                            return (
                              <li key={val.value}>
                                <label
                                  className={`flex items-center gap-2.5 cursor-pointer text-body group/option py-1 px-1 -mx-1 transition-colors ${
                                    checked ? 'bg-accent-soft/40' : 'hover:bg-ink-100/60'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => handleCheckboxChange(group.key, val.value)}
                                    className="sr-only"
                                  />
                                  {group.type === 'color_swatch' && val.colorHex ? (
                                    <span
                                      className={`relative size-5 rounded-full transition-all ${
                                        checked
                                          ? 'ring-2 ring-ink-900 ring-offset-2 ring-offset-white'
                                          : 'ring-1 ring-ink-200 group-hover/option:ring-ink-500'
                                      }`}
                                      style={{ backgroundColor: val.colorHex }}
                                    >
                                      {checked && (
                                        <Check
                                          className="absolute inset-0 m-auto size-3 text-white drop-shadow-[0_0_2px_rgba(0,0,0,0.6)]"
                                          strokeWidth={3}
                                        />
                                      )}
                                    </span>
                                  ) : (
                                    <span
                                      className={`size-[18px] grid place-items-center border transition-colors ${
                                        checked
                                          ? 'bg-ink-900 border-ink-900'
                                          : 'bg-white border-ink-300 group-hover/option:border-ink-700'
                                      }`}
                                    >
                                      {checked && (
                                        <Check className="size-3 text-white" strokeWidth={3} />
                                      )}
                                    </span>
                                  )}
                                  <span
                                    className={`flex-1 truncate text-[13.5px] ${
                                      checked
                                        ? 'text-ink-900 font-medium'
                                        : 'text-ink-700 group-hover/option:text-ink-900'
                                    }`}
                                  >
                                    {val.label}
                                  </span>
                                  {group.showCounts && (
                                    <span
                                      className={`text-[11px] tabular ${
                                        checked ? 'text-ink-700' : 'text-ink-500'
                                      }`}
                                    >
                                      {val.count}
                                    </span>
                                  )}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {!lcSearch && overflow > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(group.key)}
                          className="mt-2 text-caption font-semibold text-accent-dark hover:text-ink-900 underline-offset-2 hover:underline"
                        >
                          {isExpanded ? 'Show less' : `+ ${overflow} more`}
                        </button>
                      )}
                    </>
                  )}

                  {group.type === 'price_range' && group.range && (
                    <div>
                      {(group.range.min != null && group.range.max != null) && (
                        <div className="flex items-center justify-between text-[11px] text-ink-500 mb-2 tabular">
                          <span>₹{group.range.min.toLocaleString('en-IN')}</span>
                          <span>₹{group.range.max.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 text-caption pointer-events-none">
                            ₹
                          </span>
                          <input
                            type="number"
                            placeholder={`${group.range.min}`}
                            value={priceMin}
                            onChange={(e) => setPriceMin(e.target.value)}
                            aria-label="Minimum price"
                            className="w-full h-9 pl-6 pr-2 border border-ink-300 hover:border-ink-500 focus:border-ink-900 focus:outline-none text-body bg-white tabular rounded-full"
                          />
                        </div>
                        <span className="text-ink-400">–</span>
                        <div className="relative flex-1">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 text-caption pointer-events-none">
                            ₹
                          </span>
                          <input
                            type="number"
                            placeholder={`${group.range.max}`}
                            value={priceMax}
                            onChange={(e) => setPriceMax(e.target.value)}
                            aria-label="Maximum price"
                            className="w-full h-9 pl-6 pr-2 border border-ink-300 hover:border-ink-500 focus:border-ink-900 focus:outline-none text-body bg-white tabular rounded-full"
                          />
                        </div>
                      </div>
                      <button
                        onClick={handlePriceApply}
                        disabled={!priceDirty}
                        className={`mt-3 w-full h-9 text-caption uppercase tracking-wider font-semibold transition-colors rounded-full ${
                          priceDirty
                            ? 'bg-ink-900 text-white border border-ink-900 hover:bg-ink-800'
                            : 'border border-ink-300 text-ink-500 cursor-not-allowed'
                        }`}
                      >
                        {priceDirty ? 'Apply' : 'Set range'}
                      </button>
                    </div>
                  )}

                  {group.type === 'boolean_toggle' && (
                    <label className="flex items-center gap-2.5 cursor-pointer text-body py-0.5">
                      <input
                        type="checkbox"
                        checked={(activeFilters[group.key] || []).includes('true')}
                        onChange={() => handleBooleanToggle(group.key)}
                        className="sr-only"
                      />
                      <span
                        className={`relative w-9 h-5 rounded-full transition-colors ${
                          (activeFilters[group.key] || []).includes('true') ? 'bg-ink-900' : 'bg-ink-300'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 size-4 bg-white rounded-full shadow-sm transition-transform ${
                            (activeFilters[group.key] || []).includes('true') ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </span>
                      <span className="flex-1 text-ink-700">
                        {group.label}
                        {group.showCounts && group.counts && (
                          <span className="ml-1 text-caption text-ink-500 tabular">
                            ({group.counts.true})
                          </span>
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

      {filterGroups.length === 0 && (
        <div className="py-10 text-center text-caption text-ink-500">
          No filters available for this view.
        </div>
      )}
    </div>
  );
}
