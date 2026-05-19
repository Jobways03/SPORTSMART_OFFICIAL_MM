'use client';

import { useState, useRef, useEffect } from 'react';
import { ProductListItem } from '@/services/admin-products.service';

interface Props {
  product: ProductListItem;
  onEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRequestChanges?: () => void;
  onStatusChange: (status: string) => void;
  onDelete: () => void;
}

export default function ActionMenu({
  product,
  onEdit,
  onApprove,
  onReject,
  onStatusChange,
  onDelete,
}: Props) {
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

  return (
    <div className="action-menu-wrap" ref={ref}>
      <button
        className="action-menu-btn"
        onClick={() => setOpen(!open)}
        aria-label="Actions"
        aria-expanded={open}
      >
        &#8943;
      </button>

      {open && (
        <div className="action-menu-dropdown">
          <button className="action-menu-item" onClick={() => handleAction(onEdit)}>
            <span className="action-icon">&#9998;</span>
            Edit
          </button>
          <button className="action-menu-item" onClick={() => handleAction(() => onStatusChange('ARCHIVED'))}>
            <span className="action-icon">&#127991;</span>
            Mark As Sold
          </button>
          <button className="action-menu-item" onClick={() => handleAction(onApprove)}>
            <span className="action-icon">&#10003;</span>
            Enable
          </button>
          <button className="action-menu-item" onClick={() => handleAction(onReject)}>
            <span className="action-icon">&#8856;</span>
            Deny
          </button>
          <button className="action-menu-item danger" onClick={() => handleAction(onDelete)}>
            <span className="action-icon">&#8856;</span>
            Deny &amp; Delete
          </button>
        </div>
      )}
    </div>
  );
}
