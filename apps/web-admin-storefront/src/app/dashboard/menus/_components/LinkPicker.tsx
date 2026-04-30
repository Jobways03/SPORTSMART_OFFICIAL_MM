'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

type LinkType = 'COLLECTION' | 'CATEGORY' | 'BRAND' | 'PRODUCT' | 'PAGE' | 'URL' | 'NONE';

interface PickerEntity {
  id: string;
  name: string;
  slug?: string;
}

const TYPEAHEAD_ENDPOINTS: Partial<Record<LinkType, { url: (q: string) => string; key: string }>> = {
  COLLECTION: { url: (q) => `/admin/collections?limit=10&search=${encodeURIComponent(q)}`, key: 'collections' },
  CATEGORY:   { url: (q) => `/admin/categories?limit=10&search=${encodeURIComponent(q)}`,  key: 'categories' },
  BRAND:      { url: (q) => `/admin/brands?limit=10&search=${encodeURIComponent(q)}`,      key: 'brands' },
  PRODUCT:    { url: (q) => `/admin/products?limit=10&search=${encodeURIComponent(q)}`,    key: 'products' },
};

/**
 * Picks a target for a menu item. For entity-typed links (collection / category /
 * brand / product) renders a debounced typeahead; for URL / PAGE / NONE renders
 * a plain text input. Returned `linkRef` is the entity id or the URL string.
 */
export function LinkPicker({
  linkType,
  value,
  onChange,
}: {
  linkType: LinkType;
  value: string;
  onChange: (v: string) => void;
}) {
  if (linkType === 'NONE') {
    return (
      <input
        value=""
        disabled
        placeholder="No link (heading only)"
        style={{ ...inputStyle, opacity: 0.5 }}
      />
    );
  }
  if (linkType === 'URL' || linkType === 'PAGE') {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={linkType === 'URL' ? '/products?sport=cricket' : 'about, faq, …'}
        style={{ ...inputStyle, fontFamily: 'monospace' }}
      />
    );
  }
  return <Typeahead linkType={linkType} value={value} onChange={onChange} />;
}

function Typeahead({ linkType, value, onChange }: { linkType: LinkType; value: string; onChange: (v: string) => void }) {
  const config = TYPEAHEAD_ENDPOINTS[linkType];
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickerEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!config || !query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      apiClient<any>(config.url(query.trim()))
        .then((res) => {
          const list = (res.data?.[config.key] ?? []) as PickerEntity[];
          setResults(list);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, linkType]);

  const onSelect = (e: PickerEntity) => {
    onChange(e.id);
    setSelectedLabel(e.name);
    setQuery('');
    setOpen(false);
    setResults([]);
  };

  const onClear = () => {
    onChange('');
    setSelectedLabel(null);
    setQuery('');
    setResults([]);
  };

  // Show selected entity as a chip when an id is set and we know its name.
  if (value && selectedLabel) {
    return (
      <div ref={containerRef} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #d1d5db', borderRadius: 4, padding: '4px 8px', background: '#fff', minHeight: 32 }}>
        <span style={{ fontSize: 13, color: '#111', fontWeight: 500 }}>{selectedLabel}</span>
        <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>· {value.slice(0, 8)}…</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClear} style={{ background: 'transparent', border: 'none', color: '#6b7280', fontSize: 14, cursor: 'pointer', padding: '0 4px' }}>×</button>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        value={value && !selectedLabel ? value : query}
        onChange={(e) => {
          if (value && !selectedLabel) {
            // user has a raw id stored; let them clear & re-search
            onChange('');
          }
          setQuery(e.target.value);
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={`Search ${linkType.toLowerCase()}…`}
        style={inputStyle}
      />
      {open && (results.length > 0 || loading) && (
        <div style={dropdownStyle}>
          {loading && <div style={{ padding: '6px 10px', fontSize: 12, color: '#6b7280' }}>Searching…</div>}
          {results.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onSelect(e)}
              style={resultRowStyle}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>{e.name}</span>
              {e.slug && <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}> · {e.slug}</span>}
            </button>
          ))}
          {!loading && results.length === 0 && query.trim() && (
            <div style={{ padding: '6px 10px', fontSize: 12, color: '#6b7280' }}>No matches.</div>
          )}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'inherit',
};

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: '100%',
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  marginTop: 2,
  maxHeight: 240,
  overflowY: 'auto',
  zIndex: 30,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.06)',
};

const resultRowStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};
