'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ProductListItem } from '@/services/admin-products.service';

interface Props {
  product: ProductListItem;
  adminRole?: string;
  onEdit: () => void;
  onApprove: () => void;
  onMakeLive: () => void;
  onReject: () => void;
  onRequestChanges?: () => void;
  onStatusChange: (status: string) => void;
  onDelete: () => void;
}

export default function ActionMenu({
  product,
  adminRole,
  onEdit,
  onApprove,
  onMakeLive,
  onReject,
  onStatusChange,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // The product cards use overflow:hidden (to clip their rounded corners), which
  // also clips this menu whenever the card is shorter than the dropdown — i.e. a
  // collapsed row. Rendering the menu in a portal to <body> with fixed positioning
  // escapes that clip so the full menu always shows. Position is derived from the
  // trigger's rect on open and kept in sync on scroll/resize.
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
      // Flip above the trigger if there isn't room below it (near viewport bottom).
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
    // capture: also catch scrolls inside nested scroll containers, not just window.
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

  // Catalog approval is available while the product is still in review; once
  // APPROVED it awaits the super-admin make-live (HSN/tax must be set first).
  const inReview = ['SUBMITTED', 'DRAFT', 'REJECTED', 'CHANGES_REQUESTED'].includes(
    product.status,
  );
  const canMakeLive = adminRole === 'SUPER_ADMIN' && product.status === 'APPROVED';

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
        &#8943;
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
              // Above the fixed navbar (z-index 100) and sidebar (90): in <body> the
              // portal no longer inherits the card's stacking context, so the class's
              // z-index:50 would let the chrome paint over it. Set inline (not the
              // shared class, which other non-portaled menus also use).
              zIndex: 1000,
              // Hidden until measured so it never paints at the wrong spot.
              visibility: coords ? 'visible' : 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="action-menu-item" onClick={() => handleAction(onEdit)}>
              Edit
            </button>
            <button className="action-menu-item" onClick={() => handleAction(() => onStatusChange('ARCHIVED'))}>
              Mark As Sold
            </button>
            {inReview && (
              <button className="action-menu-item" onClick={() => handleAction(onApprove)}>
                Approve
              </button>
            )}
            {canMakeLive && (
              <button className="action-menu-item" onClick={() => handleAction(onMakeLive)}>
                Make Live
              </button>
            )}
            <button className="action-menu-item" onClick={() => handleAction(onReject)}>
              Deny
            </button>
            <button className="action-menu-item danger" onClick={() => handleAction(onDelete)}>
              Deny &amp; Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
