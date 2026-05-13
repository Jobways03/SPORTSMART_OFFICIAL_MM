/**
 * Server-side fetcher for the storefront content map. Called from
 * the homepage's Server Component (page.tsx). Cached with Next.js'
 * built-in fetch revalidate so the homepage isn't hammering the API
 * on every render — admin uploads land within REVALIDATE_SECONDS.
 *
 * Failure mode: if the API is unreachable or returns malformed data,
 * we log and return an empty map. The storefront's MediaTile fallback
 * still renders the curated Unsplash image per slot, so visitors
 * never see a broken page.
 */

export interface StorefrontContentBlock {
  slot: string;
  imageUrl: string | null;
  eyebrow: string | null;
  headline: string | null;
  subhead: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  price: string | null;
  priceCaption: string | null;
  active: boolean;
  updatedAt: string;
}

export type StorefrontContentMap = Record<string, StorefrontContentBlock>;

export interface StorefrontSlotDefinition {
  id: string;
  sectionKey: string;
  slotKey: string;
  label: string;
  position: number;
  defaultHref: string | null;
  isSystem: boolean;
}

/**
 * Slot definitions grouped by sectionKey, sorted by position.
 *
 * Home components consume this to render their grids dynamically — the
 * admin can add/remove slots without a deploy.
 */
export type StorefrontSlotMap = Record<string, StorefrontSlotDefinition[]>;

// Match shared-utils/api-client.ts: NEXT_PUBLIC_API_URL holds the host,
// the `/api/v1` prefix is appended here. Keeps a single source of truth
// for the env var across all 8 frontends.
const API_HOST = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const CONTENT_ENDPOINT = `${API_HOST}/api/v1/storefront/content`;
const SLOTS_ENDPOINT = `${API_HOST}/api/v1/storefront/slots`;

export async function getStorefrontContent(): Promise<StorefrontContentMap> {
  try {
    const res = await fetch(CONTENT_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(
        `[storefront-content] API returned ${res.status}, falling back to empty map`,
      );
      return {};
    }
    const json = (await res.json()) as {
      success: boolean;
      data?: { blocks?: StorefrontContentMap };
    };
    return json?.data?.blocks ?? {};
  } catch (err) {
    console.warn(
      `[storefront-content] fetch failed: ${(err as Error).message}. Falling back to empty map.`,
    );
    return {};
  }
}

/**
 * Fetch the admin-editable slot registry and group it by section.
 * Returns an empty map on failure so the page still renders (each home
 * component falls back to "no slots" + curated placeholder).
 */
export async function getStorefrontSlots(): Promise<StorefrontSlotMap> {
  try {
    const res = await fetch(SLOTS_ENDPOINT, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(
        `[storefront-slots] API returned ${res.status}, falling back to empty map`,
      );
      return {};
    }
    const json = (await res.json()) as {
      success: boolean;
      data?: { items?: StorefrontSlotDefinition[] };
    };
    const items = json?.data?.items ?? [];
    const grouped: StorefrontSlotMap = {};
    for (const s of items) {
      if (!grouped[s.sectionKey]) grouped[s.sectionKey] = [];
      grouped[s.sectionKey].push(s);
    }
    for (const k of Object.keys(grouped)) {
      grouped[k].sort((a, b) => a.position - b.position);
    }
    return grouped;
  } catch (err) {
    console.warn(
      `[storefront-slots] fetch failed: ${(err as Error).message}. Falling back to empty map.`,
    );
    return {};
  }
}
