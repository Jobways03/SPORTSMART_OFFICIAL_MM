'use client';

interface ActiveFilterChipsProps {
  activeFilters: Record<string, string[]>;
  minPrice?: string;
  maxPrice?: string;
  filterLabels?: Record<string, Record<string, string>>; // key -> { value -> displayLabel }
  onRemoveFilter: (key: string, value: string) => void;
  onRemovePrice: () => void;
  onClearAll: () => void;
}

export default function ActiveFilterChips({
  activeFilters, minPrice, maxPrice, filterLabels, onRemoveFilter, onRemovePrice, onClearAll,
}: ActiveFilterChipsProps) {
  const chips: Array<{ key: string; value: string; label: string }> = [];

  // Friendly key names
  const keyNames: Record<string, string> = {
    brand: 'Brand',
    availability: 'Availability',
  };

  for (const [key, values] of Object.entries(activeFilters)) {
    for (const value of values) {
      const displayKey = keyNames[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const displayValue = filterLabels?.[key]?.[value] || value;
      chips.push({
        key,
        value,
        label: `${displayKey}: ${displayValue}`,
      });
    }
  }

  if (minPrice || maxPrice) {
    const priceLabel = minPrice && maxPrice
      ? `Price: \u20B9${minPrice} — \u20B9${maxPrice}`
      : minPrice ? `Price: from \u20B9${minPrice}` : `Price: up to \u20B9${maxPrice}`;
    chips.push({ key: '_price', value: '', label: priceLabel });
  }

  if (chips.length === 0) return null;

  return (
    <div className="active-filter-chips">
      {chips.map((chip, idx) => (
        <span key={`${chip.key}-${chip.value}-${idx}`} className="filter-chip">
          {chip.label}
          <button
            className="filter-chip-remove"
            onClick={() => chip.key === '_price' ? onRemovePrice() : onRemoveFilter(chip.key, chip.value)}
            aria-label={`Remove filter: ${chip.label}`}
          >
            &times;
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button className="filter-chips-clear" onClick={onClearAll}>Clear all</button>
      )}
    </div>
  );
}
