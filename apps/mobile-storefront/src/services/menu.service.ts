import {API_BASE} from '../lib/api-client';

// Storefront menu API returns a raw object, NOT the {success, data, ...}
// envelope used by everything else. Mirrors web-storefront/src/lib/menu.ts —
// we bypass the apiClient wrapper and call fetch directly.

export type MenuLinkType =
  | 'COLLECTION'
  | 'CATEGORY'
  | 'BRAND'
  | 'PRODUCT'
  | 'PAGE'
  | 'URL'
  | 'NONE';

export interface MenuNode {
  id: string;
  label: string;
  linkType: MenuLinkType;
  linkRef: string | null;
  /** Pre-resolved by the API (collection/brand/category ids → slug-based URLs). */
  href: string | null;
  filterTags: string[];
  position: number;
  children: MenuNode[];
}

export interface MenuTree {
  id: string;
  handle: string;
  name: string;
  items: MenuNode[];
}

export async function fetchMenu(handle: string): Promise<MenuTree | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/storefront/menus/${handle}`);
    if (!res.ok) return null;
    return (await res.json()) as MenuTree;
  } catch {
    return null;
  }
}
