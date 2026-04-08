/**
 * Seed Script: Category Metafield Definitions from JSON files
 *
 * Reads all *-product-attributes.json files from the Category metafields folder,
 * deletes existing definitions, and creates fresh ones for every subcategory.
 *
 * Run with: npx ts-node prisma/seed/seed-metafields.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Path to the JSON files
// ─────────────────────────────────────────────────────────────────────────────
const JSON_DIR = path.join(
  process.env.HOME || '/Users/cg-sd-se-tl-001',
  'Desktop',
  'Category metafields',
);

// ─────────────────────────────────────────────────────────────────────────────
// Valid MetafieldType values (must match Prisma enum)
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RawChoice {
  value: string;
  label: string;
}

/**
 * Normalize choices — some JSON files use plain strings, others use {value, label} objects.
 */
function normalizeChoices(raw: any[] | undefined): RawChoice[] | undefined {
  if (!raw || raw.length === 0) return undefined;

  return raw.map((item, idx) => {
    if (typeof item === 'string') {
      // Plain string → generate value from label
      const value = item
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return { value, label: item, sortOrder: idx };
    }
    // Already {value, label} object
    return { value: item.value, label: item.label, sortOrder: idx };
  });
}

/**
 * Map JSON type strings to Prisma MetafieldType enum values.
 */
function mapType(rawType: string): string {
  const upper = rawType.toUpperCase().trim();
  if (VALID_TYPES[upper]) return VALID_TYPES[upper];

  // Common aliases
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

// ─────────────────────────────────────────────────────────────────────────────
// Main seed logic
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Category Metafield Definitions Seed ===\n');

  // 1. Verify JSON directory exists
  if (!fs.existsSync(JSON_DIR)) {
    console.error(`ERROR: JSON directory not found: ${JSON_DIR}`);
    console.error('Place the category metafield JSON files on the Desktop in "Category metafields" folder.');
    process.exit(1);
  }

  const jsonFiles = fs.readdirSync(JSON_DIR).filter((f) => f.endsWith('.json')).sort();
  console.log(`Found ${jsonFiles.length} JSON files in ${JSON_DIR}\n`);

  // 2. Load all categories from database (slug → id mapping)
  const allCategories = await prisma.category.findMany({
    select: { id: true, slug: true, name: true },
  });
  const slugToId = new Map<string, string>();
  for (const cat of allCategories) {
    slugToId.set(cat.slug, cat.id);
  }
  console.log(`Loaded ${allCategories.length} categories from database\n`);

  // 3. Delete ALL existing metafield definitions (clean slate)
  console.log('Deleting existing metafield definitions...');
  const deleteResult = await prisma.metafieldDefinition.deleteMany({});
  console.log(`  Deleted ${deleteResult.count} existing definitions\n`);

  // 4. Process each JSON file
  let totalCreated = 0;
  let totalSkipped = 0;

  for (const file of jsonFiles) {
    const parentSlug = file.replace('-product-attributes.json', '');
    const filePath = path.join(JSON_DIR, file);
    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const subcategorySlugs = Object.keys(fileData);
    console.log(`── ${file} (${subcategorySlugs.length} subcategories) ──`);

    for (const subSlug of subcategorySlugs) {
      const categoryId = slugToId.get(subSlug);

      if (!categoryId) {
        console.log(`  SKIP: No category found for slug "${subSlug}"`);
        totalSkipped++;
        continue;
      }

      const attributes: any[] = fileData[subSlug];
      let createdInCategory = 0;

      for (const attr of attributes) {
        const type = mapType(attr.type);
        const choices = normalizeChoices(attr.choices);

        try {
          await prisma.metafieldDefinition.create({
            data: {
              namespace: 'taxonomy',
              key: attr.key,
              name: attr.name,
              description: attr.description || null,
              type: type as any,
              choices: choices ? (choices as any) : undefined,
              ownerType: 'CATEGORY',
              categoryId,
              isRequired: attr.isRequired === true,
              sortOrder: attr.sortOrder ?? 0,
              isActive: true,
            },
          });
          createdInCategory++;
        } catch (err: any) {
          // Handle unique constraint violation (duplicate key for same category)
          if (err.code === 'P2002') {
            console.log(`  DUPLICATE: ${subSlug}.${attr.key} — already exists, skipping`);
          } else {
            console.error(`  ERROR creating ${subSlug}.${attr.key}:`, err.message);
          }
        }
      }

      totalCreated += createdInCategory;
      console.log(`  ${subSlug}: ${createdInCategory}/${attributes.length} definitions created`);
    }
  }

  // 5. Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  Total created: ${totalCreated}`);
  console.log(`  Total skipped (no matching category): ${totalSkipped}`);
  console.log(`${'═'.repeat(50)}\n`);

  // Verify
  const finalCount = await prisma.metafieldDefinition.count();
  console.log(`Verification: ${finalCount} metafield definitions in database`);
}

main()
  .catch((e) => {
    console.error('Metafield seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
