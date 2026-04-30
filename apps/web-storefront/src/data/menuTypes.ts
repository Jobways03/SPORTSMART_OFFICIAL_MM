// Shape of the menu tree returned by GET /storefront/menus/:handle.
// Mirrors the API response, kept in sync with apps/api/src/modules/storefront-menu.

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

/**
 * Use the API-resolved href when available; fall back to '#' for nodes that
 * have no link (NONE) or unresolved entity refs.
 */
export function nodeHref(node: MenuNode): string {
  return node.href ?? '#';
}
