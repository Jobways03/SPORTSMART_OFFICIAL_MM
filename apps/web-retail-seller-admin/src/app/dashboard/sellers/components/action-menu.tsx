'use client';

import { useState, useRef, useEffect } from 'react';
import { SellerListItem } from '@/services/admin-sellers.service';

interface ActionMenuProps {
  seller: SellerListItem;
  adminRole: string;
  onView: () => void;
  onEditStatus: () => void;

  onSendMessage: () => void;
  onChangePassword: () => void;
  onImpersonate: () => void;
  onDelete: () => void;
}

export default function ActionMenu({
  seller,
  adminRole,
  onView,
  onEditStatus,

  onSendMessage,
  onChangePassword,
  onImpersonate,
  onDelete,
}: ActionMenuProps) {
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

  const canImpersonate = ['SUPER_ADMIN', 'SELLER_ADMIN'].includes(adminRole);
  const canDelete = ['SUPER_ADMIN', 'SELLER_ADMIN'].includes(adminRole);

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
        &#8942;
      </button>

      {open && (
        <div className="action-menu-dropdown">
          <button className="action-menu-item" onClick={() => handleAction(onView)}>
            <span className="action-icon">&#128065;</span>
            View Details
          </button>
          <button className="action-menu-item" onClick={() => handleAction(onEditStatus)}>
            <span className="action-icon">&#9881;</span>
            Change Status
          </button>

          <button className="action-menu-item" onClick={() => handleAction(onSendMessage)}>
            <span className="action-icon">&#9993;</span>
            Send Message
          </button>
          <button className="action-menu-item" onClick={() => handleAction(onChangePassword)}>
            <span className="action-icon">&#128274;</span>
            Change Password
          </button>
          {canImpersonate && seller.status === 'ACTIVE' && (
            <button className="action-menu-item" onClick={() => handleAction(onImpersonate)}>
              <span className="action-icon">&#128100;</span>
              Impersonate
            </button>
          )}
          {canDelete && (
            <>
              <div className="action-menu-divider" />
              <button className="action-menu-item danger" onClick={() => handleAction(onDelete)}>
                <span className="action-icon">&#128465;</span>
                Delete Seller
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
