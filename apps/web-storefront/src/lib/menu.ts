import type { MenuTree } from '@/data/menuTypes';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** Server-side fetch — used in Server Components / layouts. */
export async function fetchMenu(handle: string): Promise<MenuTree | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/storefront/menus/${handle}`, {
      // Re-fetch every minute. The menu is editable in the admin so we don't
      // want to bake it permanently into the cache, but we also don't need
      // request-level freshness.
      next: { revalidate: 60, tags: [`menu:${handle}`] },
    });
    if (!res.ok) return null;
    return (await res.json()) as MenuTree;
  } catch {
    return null;
  }
}

/** Client-side fetch — used by Client Components that hydrate after mount. */
export async function fetchMenuClient(handle: string): Promise<MenuTree | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/storefront/menus/${handle}`);
    if (!res.ok) return null;
    return (await res.json()) as MenuTree;
  } catch {
    return null;
  }
}
