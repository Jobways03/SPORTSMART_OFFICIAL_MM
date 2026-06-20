'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ChevronDown, User, Package, RotateCcw, Heart } from 'lucide-react';
import { type MenuNode, nodeHref } from '@/data/menuTypes';

/**
 * Mobile / tablet primary navigation. The desktop top-nav + mega-menu are
 * `hidden lg:flex`, so below 1024px this slide-in drawer is the ONLY way to
 * reach categories. Modeled on CartDrawer (backdrop + slide-in panel, Escape
 * to close, body-scroll lock). Renders the same `menu.items` tree the desktop
 * nav uses — as a vertical accordion — rather than reusing MegaMenu (whose
 * fixed-pixel columns can't render at phone widths).
 */
export function MobileNavDrawer({
  open,
  onClose,
  items,
  isAuthed,
}: {
  open: boolean;
  onClose: () => void;
  items: MenuNode[];
  isAuthed: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Escape to close + body scroll lock while open (mirrors CartDrawer).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  return (
    <div className="fixed inset-0 z-[100] lg:hidden" aria-hidden={false}>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-[1px] animate-[fadeIn_120ms_ease-out]"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="absolute left-0 top-0 h-full w-[85%] max-w-[360px] bg-white shadow-2xl flex flex-col outline-none animate-[slideInLeft_180ms_ease-out]"
      >
        <header className="flex items-center justify-between px-5 h-14 border-b border-ink-200 shrink-0">
          <span className="text-body font-semibold text-ink-900">Menu</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="size-9 grid place-items-center text-ink-500 hover:text-ink-900 hover:bg-ink-100 rounded-full transition-colors"
          >
            <X className="size-5" />
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto overscroll-contain py-1">
          {items.map((item) => {
            const hasChildren = item.children.length > 0;
            const isOpen = expanded === item.id;
            if (!hasChildren) {
              return (
                <Link
                  key={item.id}
                  href={nodeHref(item)}
                  onClick={onClose}
                  className="block px-5 py-3 text-body font-medium uppercase tracking-wide text-ink-900 hover:bg-ink-50 border-b border-ink-100"
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <div key={item.id} className="border-b border-ink-100">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggle(item.id)}
                  className="w-full flex items-center justify-between gap-2 px-5 py-3 text-body font-medium uppercase tracking-wide text-ink-900 hover:bg-ink-50"
                >
                  <span className="truncate">{item.label}</span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-ink-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="pb-2">
                    {item.children.map((child) => {
                      const childHasKids = child.children.length > 0;
                      return (
                        <div key={child.id}>
                          <Link
                            href={nodeHref(child)}
                            onClick={onClose}
                            className="block pl-8 pr-5 py-2 text-body text-ink-800 hover:text-accent-dark hover:bg-ink-50"
                          >
                            {child.label}
                          </Link>
                          {childHasKids && (
                            <div className="pb-1">
                              {child.children.map((gc) => (
                                <Link
                                  key={gc.id}
                                  href={nodeHref(gc)}
                                  onClick={onClose}
                                  className="block pl-12 pr-5 py-1.5 text-caption text-ink-600 hover:text-accent-dark"
                                >
                                  {gc.label}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Quick account links — the right-cluster icons are de-crowded on
            the smallest screens, so surface the key account destinations here. */}
        <div className="shrink-0 border-t border-ink-200 py-2 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))]">
          {isAuthed ? (
            <>
              <Link href="/account" onClick={onClose} className="flex items-center gap-3 px-5 py-2.5 text-body text-ink-900 hover:bg-ink-50">
                <User className="size-4 text-ink-500" /> My account
              </Link>
              <Link href="/orders" onClick={onClose} className="flex items-center gap-3 px-5 py-2.5 text-body text-ink-900 hover:bg-ink-50">
                <Package className="size-4 text-ink-500" /> My orders
              </Link>
              <Link href="/returns" onClick={onClose} className="flex items-center gap-3 px-5 py-2.5 text-body text-ink-900 hover:bg-ink-50">
                <RotateCcw className="size-4 text-ink-500" /> My returns
              </Link>
              <Link href="/account/wishlist" onClick={onClose} className="flex items-center gap-3 px-5 py-2.5 text-body text-ink-900 hover:bg-ink-50">
                <Heart className="size-4 text-ink-500" /> Wishlist
              </Link>
            </>
          ) : (
            <Link href="/login" onClick={onClose} className="flex items-center gap-3 px-5 py-2.5 text-body font-semibold text-accent-dark hover:bg-ink-50">
              <User className="size-4" /> Sign in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
