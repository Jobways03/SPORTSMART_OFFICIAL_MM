'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ArrowUpRight, ArrowRight } from 'lucide-react';
import { type MenuNode, nodeHref } from '@/data/menuTypes';

/**
 * Renders a top-level menu item's mega-menu. Picks layout based on shape:
 * - Tabbed (left rail + right products) when there are 6+ groups, like
 *   "Shop by Sport".
 * - Columns (one per group) when there are 5 or fewer, like "Men" / "Brand".
 */
export function MegaMenu({
  node,
  onClose,
}: {
  node: MenuNode;
  onClose: () => void;
}) {
  if (node.children.length === 0) return null;
  const tabbed = node.children.length >= 6;
  return tabbed ? (
    <TabbedMega node={node} onClose={onClose} />
  ) : (
    <ColumnsMega node={node} onClose={onClose} />
  );
}

function TabbedMega({ node, onClose }: { node: MenuNode; onClose: () => void }) {
  const [activeId, setActiveId] = useState<string>(node.children[0]?.id ?? '');
  const active = node.children.find((c) => c.id === activeId) ?? node.children[0];

  return (
    <div className="grid grid-cols-[260px_1fr] min-h-[440px]">
      {/* Left rail — sports */}
      <ul className="bg-ink-50 py-3 border-r border-ink-200">
        {node.children.map((sport) => {
          const isActive = sport.id === active.id;
          return (
            <li key={sport.id}>
              <Link
                href={nodeHref(sport)}
                onMouseEnter={() => setActiveId(sport.id)}
                onFocus={() => setActiveId(sport.id)}
                onClick={onClose}
                className={[
                  'group relative flex items-center justify-between pl-7 pr-5 py-2.5 text-body transition-colors',
                  isActive
                    ? 'bg-white text-ink-900 font-semibold'
                    : 'text-ink-700 hover:text-ink-900 hover:bg-white/60',
                ].join(' ')}
              >
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-2 bottom-2 w-[3px] bg-accent-dark rounded-full"
                  />
                )}
                <span>{sport.label}</span>
                {sport.children.length > 0 && (
                  <ChevronRight
                    className={`size-3.5 transition-transform ${
                      isActive ? 'text-accent-dark translate-x-0.5' : 'text-ink-400 group-hover:translate-x-0.5 group-hover:text-ink-600'
                    }`}
                  />
                )}
              </Link>
            </li>
          );
        })}
        <li className="mt-3 pt-3 border-t border-ink-200">
          <Link
            href={nodeHref(node)}
            onClick={onClose}
            className="flex items-center justify-between pl-7 pr-5 py-2.5 text-caption uppercase tracking-[0.18em] font-semibold text-accent-dark hover:bg-white"
          >
            View all
            <ArrowUpRight className="size-3.5" />
          </Link>
        </li>
      </ul>

      {/* Right pane — heading + products + featured */}
      <div className="grid grid-cols-[1fr_280px]">
        <div className="px-10 py-8">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display text-5xl tracking-wide text-ink-900 leading-none">
              {active.label.toUpperCase()}
            </h3>
            <Link
              href={nodeHref(active)}
              onClick={onClose}
              className="inline-flex items-center gap-1.5 text-caption uppercase tracking-[0.18em] font-semibold text-accent-dark hover:gap-2 transition-all"
            >
              Shop all {active.label.toLowerCase()}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>

          {active.children.length > 0 ? (
            <ul className="grid grid-cols-3 gap-x-8 gap-y-1">
              {active.children.map((p) => (
                <li key={p.id}>
                  <Link
                    href={nodeHref(p)}
                    onClick={onClose}
                    className="group flex items-center gap-2 py-2 text-body text-ink-700 hover:text-ink-900 transition-colors"
                  >
                    <span className="border-b border-transparent group-hover:border-accent-dark transition-colors">
                      {p.label}
                    </span>
                    <ArrowUpRight className="size-3 text-ink-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-ink-500">No subcategories yet.</p>
          )}
        </div>

        {/* Featured promo card */}
        <FeaturedCard sport={active} onClose={onClose} />
      </div>
    </div>
  );
}

function FeaturedCard({ sport, onClose }: { sport: MenuNode; onClose: () => void }) {
  return (
    <Link
      href={nodeHref(sport)}
      onClick={onClose}
      className="relative m-6 ml-0 overflow-hidden bg-ink-100 group rounded-2xl"
      style={{
        backgroundImage:
          'linear-gradient(135deg, rgba(63, 161, 174, 0.40), transparent 70%), linear-gradient(315deg, rgba(220, 38, 38, 0.18), transparent 60%), linear-gradient(45deg, rgba(250, 204, 21, 0.14), transparent 65%)',
      }}
    >
      <div className="relative h-full flex flex-col justify-between p-6 min-h-[300px]">
        <div className="text-caption uppercase tracking-[0.2em] font-semibold text-accent-dark">
          Featured
        </div>
        <div>
          <h4 className="font-display text-3xl leading-none text-ink-900 mb-1">
            {sport.label}
            <br />
            essentials
          </h4>
          <p className="mt-3 text-body text-ink-700 max-w-[200px]">
            Hand-picked gear from top brands. Trusted by pros.
          </p>
          <div className="mt-5 inline-flex items-center gap-1.5 text-caption uppercase tracking-[0.18em] font-semibold text-accent-dark group-hover:gap-2.5 transition-all">
            Shop now
            <ArrowRight className="size-3.5" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function ColumnsMega({ node, onClose }: { node: MenuNode; onClose: () => void }) {
  return (
    <div
      className="grid gap-10 px-10 py-10"
      style={{ gridTemplateColumns: `repeat(${Math.min(node.children.length, 4)}, minmax(0, 1fr)) 280px` }}
    >
      {node.children.map((group) => (
        <div key={group.id}>
          <h4 className="text-caption uppercase tracking-[0.18em] font-semibold text-ink-500 mb-4 pb-2 border-b border-ink-200">
            {group.label}
          </h4>
          {group.children.length > 0 ? (
            <ul className="space-y-1.5">
              {group.children.map((item) => (
                <li key={item.id}>
                  <Link
                    href={nodeHref(item)}
                    onClick={onClose}
                    className="group flex items-center gap-2 py-1 text-body text-ink-700 hover:text-ink-900 transition-colors"
                  >
                    <span className="border-b border-transparent group-hover:border-accent-dark transition-colors">
                      {item.label}
                    </span>
                    <ArrowUpRight className="size-3 text-ink-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Link
              href={nodeHref(group)}
              onClick={onClose}
              className="block py-1 text-body font-medium text-accent-dark hover:underline"
            >
              View all
            </Link>
          )}
        </div>
      ))}

      {/* Right rail: featured for the whole top-level (e.g. "Men" → Men's essentials) */}
      <FeaturedCard sport={node} onClose={onClose} />
    </div>
  );
}
