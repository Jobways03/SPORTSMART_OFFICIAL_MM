'use client';

import { useState, useRef, useEffect } from 'react';
import { ProductListItem } from '@/services/product.service';

interface ActionMenuProps {
  product: ProductListItem;
  onEdit: () => void;
  onDelete: () => void;
}

export default function ProductActionMenu({ product, onEdit, onDelete }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAction = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const canDelete = product.status === 'DRAFT' || product.status === 'REJECTED';

  return (
    <div className="action-menu-wrap" ref={ref}>
      <button
        className="action-menu-btn"
        onClick={() => setOpen(!open)}
        aria-label="Actions"
        aria-expanded={open}
      >
        &#8942;
      </button>

      {open && (
        <div className="action-menu-dropdown">
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
        </div>
      )}
    </div>
  );
}
