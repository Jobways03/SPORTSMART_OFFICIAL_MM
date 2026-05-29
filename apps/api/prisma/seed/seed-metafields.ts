/**
 * Seed Script: Category Metafield Definitions from JSON files
 *
 * Phase 39 (2026-05-21) — major rewrite:
 *
 *   1. **Source of truth moved into the repo** at
 *      `prisma/seed/data/category-metafields/*.json`. Pre-Phase-39
 *      the seed read from `~/Desktop/Category metafields/` —
 *      reproducible only on the original developer's machine; CI
 *      couldn't run it; production couldn't be rebuilt from source.
 *
 *   2. **Idempotent upsert** instead of `deleteMany({})`. Pre-Phase-39
 *      every re-run cascade-destroyed every product's attribute
 *      values (1,285 definitions × N products). The new path:
 *        - upsert by (namespace, key, categoryId)
 *        - mark definitions no longer in the JSON as isActive=false
 *          (NOT deleted; product values + the definition row both
 *          survive a re-run for forensic / restore purposes)
 *
 *   3. **Production safety guard** — refuses to run when
 *      NODE_ENV=production unless FORCE_METAFIELD_SEED=true is
 *      explicitly set. Pre-Phase-39 an accidental run against a
 *      production DB would wipe every product's attribute data.
 *
 * Run with: npx ts-node prisma/seed/seed-metafields.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

/**
 * Phase 39 — in-repo JSON source. Override with
 * SEED_METAFIELDS_JSON_DIR for a one-off load from a different path
 * (e.g. content team handoff before merging to repo).
 */
const JSON_DIR =
  process.env.SEED_METAFIELDS_JSON_DIR ||
  path.join(__dirname, 'data', 'category-metafields');

/**
 * Valid MetafieldType values — must match the Prisma enum.
 */
const VALID_TYPES: Record<string, string> = {
  SINGLE_LINE_TEXT: 'SINGLE_LINE_TEXT',
  MULTI_LINE_TEXT: 'MULTI_LINE_TEXT',
  NUMBER_INTEGER: 'NUMBER_INTEGER',
  NUMBER_DECIMAL: 'NUMBER_DECIMAL',
  BOOLEAN: 'BOOLEAN',
  DATE: 'DATE',
  COLOR: 'COLOR',
  URL: 'URL',
  DIMENSION: 'DIMENSION',
  WEIGHT: 'WEIGHT',
  VOLUME: 'VOLUME',
  RATING: 'RATING',
  JSON: 'JSON',
  SINGLE_SELECT: 'SINGLE_SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  FILE_REFERENCE: 'FILE_REFERENCE',
};

interface RawChoice {
  value: string;
  label: string;
  sortOrder?: number;
}

function normalizeChoices(raw: any[] | undefined): RawChoice[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((item, idx) => {
    if (typeof item === 'string') {
      const value = item
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return { value, label: item, sortOrder: idx };
    }
    return { value: item.value, label: item.label, sortOrder: idx };
  });
}

function mapType(rawType: string): string {
  const upper = rawType.toUpperCase().trim();
  if (VALID_TYPES[upper]) return VALID_TYPES[upper];
  const aliases: Record<string, string> = {
    TEXT: 'SINGLE_LINE_TEXT',
    STRING: 'SINGLE_LINE_TEXT',
    NUMBER: 'NUMBER_INTEGER',
    INTEGER: 'NUMBER_INTEGER',
    DECIMAL: 'NUMBER_DECIMAL',
    FLOAT: 'NUMBER_DECIMAL',
    BOOL: 'BOOLEAN',
    SELECT: 'SINGLE_SELECT',
    MULTISELECT: 'MULTI_SELECT',
  };
  if (aliases[upper]) return aliases[upper];
  console.warn(`  WARNING: Unknown type "${rawType}", defaulting to SINGLE_LINE_TEXT`);
  return 'SINGLE_LINE_TEXT';
}

/**
 * Phase 39 — production guard. The seed mutates a globally-shared
 * taxonomy; accidentally pointing it at prod would deactivate every
 * definition the JSON doesn't know about. Force-flag exists for
 * intentional bootstrap of a new prod environment.
 */
function assertSafeToRun(): void {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.FORCE_METAFIELD_SEED !== 'true'
  ) {
    throw new Error(
      'Refusing to run metafield seed: NODE_ENV=production and ' +
        'FORCE_METAFIELD_SEED!=true. Set FORCE_METAFIELD_SEED=true to bootstrap a ' +
        'fresh prod environment intentionally.',
    );
  }
}

interface SeedTarget {
  namespace: string;
  key: string;
  categoryId: string;
  name: string;
  description: string | null;
  type: string;
  choices: RawChoice[] | undefined;
  isRequired: boolean;
  sortOrder: number;
}

async function main(): Promise<void> {
  console.log('=== Category Metafield Definitions Seed (Phase 39) ===\n');
  assertSafeToRun();

  if (!fs.existsSync(JSON_DIR)) {
    console.error(`ERROR: JSON directory not found: ${JSON_DIR}`);
    console.error('Place the category metafield JSON files at apps/api/prisma/seed/data/category-metafields/');
    process.exit(1);
  }

  const jsonFiles = fs.readdirSync(JSON_DIR).filter((f) => f.endsWith('.json')).sort();
  console.log(`Found ${jsonFiles.length} JSON files in ${JSON_DIR}\n`);

  const allCategories = await prisma.category.findMany({
    select: { id: true, slug: true, name: true },
  });
  const slugToId = new Map(allCategories.map((c) => [c.slug, c.id] as const));
  console.log(`Loaded ${allCategories.length} categories from database\n`);

  // Phase 39 — flatten JSON into a target list first so we know the
  // full intended set before touching the DB.
  const targets: SeedTarget[] = [];
  const orphanSlugs = new Set<string>();

  for (const file of jsonFiles) {
    const filePath = path.join(JSON_DIR, file);
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const subSlug of Object.keys(fileData)) {
      const categoryId = slugToId.get(subSlug);
      if (!categoryId) {
        orphanSlugs.add(subSlug);
        continue;
      }
      const attributes: any[] = fileData[subSlug];
      for (const attr of attributes) {
        targets.push({
          namespace: 'taxonomy',
          key: attr.key,
          categoryId,
          name: attr.name,
          description: attr.description ?? null,
          type: mapType(attr.type),
          choices: normalizeChoices(attr.choices),
          isRequired: attr.isRequired === true,
          sortOrder: attr.sortOrder ?? 0,
        });
      }
    }
  }
  if (orphanSlugs.size > 0) {
    console.log(`  WARN: ${orphanSlugs.size} subcategory slugs in JSON have no matching DB category:`);
    for (const s of Array.from(orphanSlugs).slice(0, 10)) console.log(`    - ${s}`);
  }
  console.log(`Target definitions: ${targets.length}\n`);

  // Phase 39 — upsert each. Concurrent re-runs by mistake do not
  // generate duplicates because (namespace, key, categoryId) is the
  // schema unique key.
  let created = 0;
  let updated = 0;
  for (const t of targets) {
    const existing = await prisma.metafieldDefinition.findFirst({
      where: { namespace: t.namespace, key: t.key, categoryId: t.categoryId },
      select: { id: true },
    });
    if (existing) {
      await prisma.metafieldDefinition.update({
        where: { id: existing.id },
        data: {
          name: t.name,
          description: t.description,
          type: t.type as any,
          choices: t.choices ? (t.choices as any) : undefined,
          isRequired: t.isRequired,
          sortOrder: t.sortOrder,
          isActive: true,
        },
      });
      updated++;
    } else {
      await prisma.metafieldDefinition.create({
        data: {
          namespace: t.namespace,
          key: t.key,
          name: t.name,
          description: t.description,
          type: t.type as any,
          choices: t.choices ? (t.choices as any) : undefined,
          ownerType: 'CATEGORY',
          categoryId: t.categoryId,
          isRequired: t.isRequired,
          sortOrder: t.sortOrder,
          isActive: true,
        },
      });
      created++;
    }
  }

  // Phase 39 — deactivate stale definitions. Definitions in DB but
  // NOT in the current JSON set are flagged inactive (NOT deleted).
  // The Phase 39 schema change (ProductMetafield FK is now RESTRICT)
  // would block a hard-delete anyway, but soft-deactivate is the
  // right semantic — preserves audit + restore.
  const targetKeys = new Set(
    targets.map((t) => `${t.namespace}|${t.key}|${t.categoryId}`),
  );
  const allExisting = await prisma.metafieldDefinition.findMany({
    where: { isActive: true, ownerType: 'CATEGORY' },
    select: { id: true, namespace: true, key: true, categoryId: true },
  });
  const staleIds = allExisting
    .filter((d) => !targetKeys.has(`${d.namespace}|${d.key}|${d.categoryId}`))
    .map((d) => d.id);
  if (staleIds.length > 0) {
    const deactivated = await prisma.metafieldDefinition.updateMany({
      where: { id: { in: staleIds } },
      data: { isActive: false },
    });
    console.log(`  Deactivated ${deactivated.count} stale definitions (not in current JSON)`);
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Stale-deactivated: ${staleIds.length}`);
  console.log(`${'═'.repeat(50)}\n`);

  const finalCount = await prisma.metafieldDefinition.count({ where: { isActive: true } });
  console.log(`Active definitions: ${finalCount}`);
}

main()
  .catch((e) => {
    console.error('Metafield seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
