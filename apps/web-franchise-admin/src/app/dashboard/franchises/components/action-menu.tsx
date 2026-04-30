'use client';

import { useState, useRef, useEffect } from 'react';

interface ActionMenuProps {
  onView: () => void;
  onEditStatus: () => void;
  onEditVerification: () => void;
  onEditCommission: () => void;
  onEditPricing?: () => void;
  onSendMessage?: () => void;
  onChangePassword?: () => void;
  onImpersonate?: () => void;
  onDelete?: () => void;
}

export default function ActionMenu({
  onView,
  onEditStatus,
  onEditVerification,
  onEditCommission,
  onEditPricing,
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

  const handleAction = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="action-menu-wrap" ref={ref}>
      <button
        className="action-menu-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-label="Actions"
        aria-expanded={open}
      >
        &#8942;
      </button>

      {open && (
        <div className="action-menu-dropdown" onClick={(e) => e.stopPropagation()}>
          <button className="action-menu-item" onClick={() => handleAction(onView)}>
            <span className="action-icon">&#128065;</span>
            View Details
          </button>
          <button className="action-menu-item" onClick={() => handleAction(onEditStatus)}>
            <span className="action-icon">&#9881;</span>
            Update Status
          </button>
          <button className="action-menu-item" onClick={() => handleAction(onEditVerification)}>
            <span className="action-icon">&#10003;</span>
            Update Verification
          </button>
          <button className="action-menu-item" onClick={() => handleAction(onEditCommission)}>
            <span className="action-icon">&#128176;</span>
            Update Commission
          </button>
          {onEditPricing && (
            <button className="action-menu-item" onClick={() => handleAction(onEditPricing)}>
              <span className="action-icon">&#128200;</span>
              Procurement Pricing
            </button>
          )}

          {onSendMessage && (
            <button className="action-menu-item" onClick={() => handleAction(onSendMessage)}>
              <span className="action-icon">&#9993;</span>
              Send Message
            </button>
          )}
          {onChangePassword && (
            <button className="action-menu-item" onClick={() => handleAction(onChangePassword)}>
              <span className="action-icon">&#128274;</span>
              Change Password
            </button>
          )}
          {onImpersonate && (
            <button className="action-menu-item" onClick={() => handleAction(onImpersonate)}>
              <span className="action-icon">&#128100;</span>
              Impersonate
            </button>
          )}

          {onDelete && (
            <>
              <div style={{ height: 1, background: '#e5e7eb', margin: '4px 0' }} />
              <button
                className="action-menu-item"
                style={{ color: '#dc2626' }}
                onClick={() => handleAction(onDelete)}
              >
                <span className="action-icon">&#128465;</span>
                Delete Franchise
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
