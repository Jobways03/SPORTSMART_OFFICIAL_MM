'use client';

import { X } from 'lucide-react';

interface ActiveFilterChipsProps {
  activeFilters: Record<string, string[]>;
  minPrice?: string;
  maxPrice?: string;
  filterLabels?: Record<string, Record<string, string>>;
  onRemoveFilter: (key: string, value: string) => void;
  onRemovePrice: () => void;
  onClearAll: () => void;
}

const KEY_NAMES: Record<string, string> = {
  brand: 'Brand',
  availability: 'Availability',
  category: 'Category',
  size: 'Size',
  color: 'Color',
};

export default function ActiveFilterChips({
  activeFilters, minPrice, maxPrice, filterLabels,
  onRemoveFilter, onRemovePrice, onClearAll,
}: ActiveFilterChipsProps) {
  type Chip = { key: string; value: string; group: string; label: string };
  const chips: Chip[] = [];

  for (const [key, values] of Object.entries(activeFilters)) {
    for (const value of values) {
      const displayKey =
        KEY_NAMES[key] ||
        key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const resolved = filterLabels?.[key]?.[value];
      // Fallback: if unresolved AND looks like a UUID, just show "Selected" so
      // users never see raw IDs in the URL.
      const looksLikeUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
      const displayValue = resolved || (looksLikeUuid ? 'Selected' : value);
      chips.push({ key, value, group: displayKey, label: displayValue });
    }
  }

  if (minPrice || maxPrice) {
    const priceLabel =
      minPrice && maxPrice
        ? `₹${Number(minPrice).toLocaleString('en-IN')} – ₹${Number(maxPrice).toLocaleString('en-IN')}`
        : minPrice
          ? `from ₹${Number(minPrice).toLocaleString('en-IN')}`
          : `up to ₹${Number(maxPrice).toLocaleString('en-IN')}`;
    chips.push({ key: '_price', value: '', group: 'Price', label: priceLabel });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      {chips.map((chip, idx) => (
        <span
          key={`${chip.key}-${chip.value}-${idx}`}
          className="group inline-flex items-center h-8 pl-2.5 pr-1 bg-white border border-ink-300 hover:border-ink-900 transition-colors rounded-full"
        >
          <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-ink-500 mr-1.5">
            {chip.group}
          </span>
          <span className="text-body text-ink-900 max-w-[200px] truncate" title={chip.label}>
            {chip.label}
          </span>
          <button
            type="button"
            onClick={() =>
              chip.key === '_price' ? onRemovePrice() : onRemoveFilter(chip.key, chip.value)
            }
            aria-label={`Remove filter: ${chip.group}: ${chip.label}`}
            className="ml-1.5 size-6 grid place-items-center text-ink-500 hover:text-white hover:bg-ink-900 transition-colors rounded-full"
          >
            <X className="size-3" strokeWidth={2.5} />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-caption text-accent-dark font-semibold hover:text-ink-900 hover:underline underline-offset-2 ml-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
