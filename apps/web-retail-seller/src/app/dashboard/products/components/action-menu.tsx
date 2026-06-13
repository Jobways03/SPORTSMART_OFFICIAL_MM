'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ProductListItem } from '@/services/product.service';

interface ActionMenuProps {
  product: ProductListItem;
  onEdit: () => void;
  onDelete: () => void;
}

export default function ProductActionMenu({ product, onEdit, onDelete }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // The list cards use overflow:hidden (to clip their rounded corners), which would
  // also clip this menu on short/collapsed rows. Rendering it in a portal to <body>
  // with fixed positioning escapes that clip so the full menu always shows.
  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const place = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const h = dropdownRef.current?.offsetHeight ?? 0;
      const openUp = h > 0 && window.innerHeight - r.bottom < h + 12 && r.top > h + 12;
      setCoords({
        top: openUp ? r.top - h - 6 : r.bottom + 6,
        right: window.innerWidth - r.right,
      });
    };
    place();
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const handleAction = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const canDelete = product.status === 'DRAFT' || product.status === 'REJECTED';

  return (
    <div className="action-menu-wrap">
      <button
        ref={triggerRef}
        className="action-menu-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Actions"
        aria-expanded={open}
      >
        &#8942;
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            className="action-menu-dropdown"
            style={{
              position: 'fixed',
              top: coords?.top ?? -9999,
              right: coords?.right ?? 0,
              // Above the fixed navbar (z-index 100) and sidebar (90).
              zIndex: 1000,
              visibility: coords ? 'visible' : 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="action-menu-item" onClick={() => handleAction(onEdit)}>
              <span className="action-icon">&#9998;</span>
              Edit
            </button>
            {canDelete && (
              <>
                <div className="action-menu-divider" />
                <button className="action-menu-item danger" onClick={() => handleAction(onDelete)}>
                  <span className="action-icon">&#128465;</span>
                  Delete
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
