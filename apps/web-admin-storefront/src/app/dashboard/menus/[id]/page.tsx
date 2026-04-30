'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { apiClient } from '@/lib/api-client';
import { LinkPicker } from '../_components/LinkPicker';

type LinkType = 'COLLECTION' | 'CATEGORY' | 'BRAND' | 'PRODUCT' | 'PAGE' | 'URL' | 'NONE';

interface MenuNode {
  id: string;
  label: string;
  linkType: LinkType;
  linkRef: string | null;
  filterTags: string[];
  position: number;
  children: MenuNode[];
}

interface MenuTree {
  id: string;
  handle: string;
  name: string;
  items: MenuNode[];
}

const LINK_TYPES: { value: LinkType; label: string; hint: string }[] = [
  { value: 'NONE',       label: 'None (heading only)', hint: '' },
  { value: 'URL',        label: 'URL',                 hint: 'e.g. /products?sport=cricket' },
  { value: 'COLLECTION', label: 'Collection',          hint: 'collection id' },
  { value: 'CATEGORY',   label: 'Category',            hint: 'category id' },
  { value: 'BRAND',      label: 'Brand',               hint: 'brand id' },
  { value: 'PRODUCT',    label: 'Product',             hint: 'product slug' },
  { value: 'PAGE',       label: 'Page',                hint: 'page slug' },
];

export default function MenuEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const menuId = params.id;

  const [tree, setTree] = useState<MenuTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | 'root' | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiClient<MenuTree>(`/admin/storefront/menus/${menuId}`)
      .then((res) => setTree(res.data ?? null))
      .catch(() => setTree(null))
      .finally(() => setLoading(false));
  }, [menuId]);

  useEffect(load, [load]);

  const onAdd = async (parentId: string | null, payload: { label: string; linkType: LinkType; linkRef: string }) => {
    await apiClient(`/admin/storefront/menus/${menuId}/items`, {
      method: 'POST',
      body: JSON.stringify({
        label: payload.label,
        linkType: payload.linkType,
        linkRef: payload.linkRef || null,
        parentId,
      }),
    });
    setAdding(null);
    load();
  };

  const onUpdate = async (itemId: string, payload: { label: string; linkType: LinkType; linkRef: string }) => {
    await apiClient(`/admin/storefront/menus/${menuId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        label: payload.label,
        linkType: payload.linkType,
        linkRef: payload.linkRef || null,
      }),
    });
    setEditing(null);
    load();
  };

  const onDelete = async (itemId: string) => {
    if (!confirm('Delete this item and all its children?')) return;
    await apiClient(`/admin/storefront/menus/${menuId}/items/${itemId}`, { method: 'DELETE' });
    load();
  };

  /** Persist a full reordering of one parent's children to the API. */
  const persistReorder = async (parentId: string | null, ordered: MenuNode[]) => {
    await apiClient(`/admin/storefront/menus/${menuId}/items/reorder`, {
      method: 'POST',
      body: JSON.stringify({
        moves: ordered.map((node, position) => ({ id: node.id, parentId, position })),
      }),
    });
    load();
  };

  /** Up/down arrow handler — kept for keyboard a11y. Same-parent move only. */
  const onMove = async (itemId: string, siblings: MenuNode[], direction: -1 | 1) => {
    const idx = siblings.findIndex((s) => s.id === itemId);
    const target = idx + direction;
    if (target < 0 || target >= siblings.length) return;
    const reordered = arrayMove(siblings, idx, target);
    const parentId = idx === 0 ? null : findParentId(tree!.items, itemId);
    await persistReorder(parentId, reordered);
  };

  /** Drag-drop handler — same-parent reorder only (cross-parent ignored). */
  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || !tree) return;

    const activeParent = findParentId(tree.items, String(active.id));
    const overParent = findParentId(tree.items, String(over.id));
    if (activeParent !== overParent) return; // cross-parent moves not supported here

    const siblings = activeParent
      ? findNode(tree.items, activeParent)?.children ?? []
      : tree.items;

    const oldIdx = siblings.findIndex((s) => s.id === active.id);
    const newIdx = siblings.findIndex((s) => s.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const reordered = arrayMove(siblings, oldIdx, newIdx);
    await persistReorder(activeParent, reordered);
  };

  // Enable drag only after a 5px move so click events on row buttons still work.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (loading) return <div style={{ padding: 40, color: '#6b7280' }}>Loading menu…</div>;
  if (!tree) {
    return (
      <div style={{ padding: 40 }}>
        <p>Menu not found.</p>
        <button onClick={() => router.back()}>Back</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100 }}>
      <Link href="/dashboard/menus" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>
        ← Back to menus
      </Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: '#111', margin: 0 }}>{tree.name}</h1>
          <p style={{ color: '#6b7280', marginTop: 4, fontSize: 13, fontFamily: 'monospace' }}>handle: {tree.handle}</p>
        </div>
        {adding !== 'root' && (
          <button
            onClick={() => setAdding('root')}
            style={{ background: '#111', color: '#fff', border: 'none', padding: '10px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer', borderRadius: 6 }}
          >
            + Add top-level item
          </button>
        )}
      </div>

      {adding === 'root' && (
        <ItemForm
          onCancel={() => setAdding(null)}
          onSave={(data) => onAdd(null, data)}
        />
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        {tree.items.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
            No items yet. Click <strong>+ Add top-level item</strong> to start.
          </div>
        ) : (
          <SortableContext items={tree.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tree.items.map((item, idx) => (
              <ItemRow
                key={item.id}
                item={item}
                siblings={tree.items}
                index={idx}
                depth={0}
                editing={editing}
                adding={adding}
                onEdit={setEditing}
                onAdd={setAdding}
                onCancel={() => { setEditing(null); setAdding(null); }}
                onSave={(id, data) => onUpdate(id, data)}
                onSaveNew={(parentId, data) => onAdd(parentId, data)}
                onDelete={onDelete}
                onMove={onMove}
              />
            ))}
          </ul>
          </SortableContext>
        )}
      </div>
      </DndContext>

      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 16 }}>
        Tip: drag the <strong>☰</strong> handle to reorder items within the same parent. Use <strong>+ child</strong> to nest. Collection / category / brand pickers search live as you type.
      </p>
    </div>
  );
}

function findParentId(nodes: MenuNode[], id: string, parent: string | null = null): string | null {
  for (const n of nodes) {
    if (n.id === id) return parent;
    const found = findParentId(n.children, id, n.id);
    if (found !== null) return found;
  }
  return null;
}

function findNode(nodes: MenuNode[], id: string): MenuNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

interface ItemRowProps {
  item: MenuNode;
  siblings: MenuNode[];
  index: number;
  depth: number;
  editing: string | null;
  adding: string | 'root' | null;
  onEdit: (id: string | null) => void;
  onAdd: (id: string | 'root' | null) => void;
  onCancel: () => void;
  onSave: (id: string, data: { label: string; linkType: LinkType; linkRef: string }) => void;
  onSaveNew: (parentId: string, data: { label: string; linkType: LinkType; linkRef: string }) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, siblings: MenuNode[], dir: -1 | 1) => void;
}

function ItemRow(props: ItemRowProps) {
  const { item, siblings, index, depth, editing, adding, onEdit, onAdd, onCancel, onSave, onSaveNew, onDelete, onMove } = props;
  const isEditing = editing === item.id;
  const isAdding = adding === item.id;
  const indent = depth * 24;

  const sortable = useSortable({ id: item.id });
  const liStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    background: sortable.isDragging ? '#f9fafb' : 'transparent',
  };

  return (
    <li ref={sortable.setNodeRef} style={liStyle}>
      {isEditing ? (
        <div style={{ paddingLeft: indent }}>
          <ItemForm
            initial={{ label: item.label, linkType: item.linkType, linkRef: item.linkRef ?? '' }}
            onCancel={onCancel}
            onSave={(data) => onSave(item.id, data)}
          />
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            paddingLeft: 16 + indent,
            borderTop: depth === 0 && index === 0 ? 'none' : '1px solid #f3f4f6',
          }}
        >
          <span
            {...sortable.attributes}
            {...sortable.listeners}
            title="Drag to reorder"
            style={{ color: '#9ca3af', fontSize: 16, cursor: 'grab', padding: '0 4px', userSelect: 'none', touchAction: 'none' }}
          >
            ☰
          </span>
          <span style={{ fontSize: 14, fontWeight: depth === 0 ? 500 : 400, color: '#111' }}>{item.label}</span>
          {item.linkType !== 'NONE' && (
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              ({item.linkType.toLowerCase()}
              {item.linkRef ? ` → ${item.linkRef}` : ''})
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={() => onMove(item.id, siblings, -1)} disabled={index === 0} title="Move up" style={btnStyle}>↑</button>
          <button onClick={() => onMove(item.id, siblings, 1)} disabled={index === siblings.length - 1} title="Move down" style={btnStyle}>↓</button>
          <button onClick={() => onAdd(item.id)} title="Add child" style={btnStyle}>+ child</button>
          <button onClick={() => onEdit(item.id)} title="Edit" style={btnStyle}>edit</button>
          <button onClick={() => onDelete(item.id)} title="Delete" style={{ ...btnStyle, color: '#dc2626' }}>delete</button>
        </div>
      )}

      {isAdding && (
        <div style={{ paddingLeft: 16 + (depth + 1) * 24, paddingRight: 16 }}>
          <ItemForm
            onCancel={onCancel}
            onSave={(data) => onSaveNew(item.id, data)}
          />
        </div>
      )}

      {item.children.length > 0 && (
        <SortableContext items={item.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {item.children.map((child, idx) => (
            <ItemRow
              key={child.id}
              {...props}
              item={child}
              siblings={item.children}
              index={idx}
              depth={depth + 1}
            />
          ))}
        </ul>
        </SortableContext>
      )}
    </li>
  );
}

function ItemForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: { label: string; linkType: LinkType; linkRef: string };
  onCancel: () => void;
  onSave: (data: { label: string; linkType: LinkType; linkRef: string }) => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [linkType, setLinkType] = useState<LinkType>(initial?.linkType ?? 'URL');
  const [linkRef, setLinkRef] = useState(initial?.linkRef ?? '');
  const linkTypeMeta = LINK_TYPES.find((l) => l.value === linkType);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!label.trim()) return;
        onSave({ label: label.trim(), linkType, linkRef: linkRef.trim() });
      }}
      style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 14, margin: '8px 0' }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 12, marginBottom: 10 }}>
        <label>
          <span style={labelStyle}>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} required style={inputStyle} placeholder="Cricket Bats" autoFocus />
        </label>
        <label>
          <span style={labelStyle}>Link type</span>
          <select value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)} style={inputStyle}>
            {LINK_TYPES.map((lt) => (
              <option key={lt.value} value={lt.value}>{lt.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Link {linkTypeMeta?.hint && <em style={{ color: '#9ca3af', fontStyle: 'normal' }}>· {linkTypeMeta.hint}</em>}</span>
          <LinkPicker linkType={linkType} value={linkRef} onChange={setLinkRef} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" style={{ background: '#111', color: '#fff', border: 'none', padding: '6px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', borderRadius: 6 }}>
          Save
        </button>
        <button type="button" onClick={onCancel} style={{ background: '#fff', color: '#111', border: '1px solid #d1d5db', padding: '6px 14px', fontSize: 13, cursor: 'pointer', borderRadius: 6 }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #d1d5db',
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 4,
  color: '#374151',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: '#374151',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'inherit',
};
