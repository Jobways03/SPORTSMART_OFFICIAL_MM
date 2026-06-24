import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const BATCH_SIZE = 1000;
// Resolve the India-Post directory CSV. Candidates, in priority order:
//   1. PINCODE_CSV_PATH override (ops / CI),
//   2. prisma/seed/pincodes.csv — a broken symlink to one developer's machine in
//      a clean checkout AND inside the API image, so usually UNreadable,
//   3. prisma/seed/pincodes 2.csv — the real 165K-row file committed to the repo
//      and shipped in the API image (the build's `COPY apps/api` carries
//      prisma/seed/*.csv; .dockerignore does not exclude it).
// Pick the first READABLE candidate; if none is readable the check in main()
// emits an actionable error against the first path.
function resolveCsvPath(): string {
  const candidates = [
    process.env.PINCODE_CSV_PATH,
    path.join(__dirname, 'pincodes.csv'),
    path.join(__dirname, 'pincodes 2.csv'),
  ].filter((p): p is string => !!p && p.length > 0);
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      /* not readable — try the next candidate */
    }
  }
  return candidates[0] ?? path.join(__dirname, 'pincodes.csv');
}
const CSV_PATH = resolveCsvPath();

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // Inside a quoted field, a doubled quote ("") is an escaped literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // consume the second quote of the pair
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

async function main() {
  console.log('=== Pincode Import Script ===');
  console.log(`Reading CSV from: ${CSV_PATH}`);

  // Idempotency: if post_offices already has coord-bearing rows, the pincode data
  // is loaded — skip so this can sit safely in the prod seed runner (RUN_SEED) and
  // re-run cheaply. PINCODE_SEED_FORCE=true forces a full reload, e.g. to refresh
  // against a newer India-Post release OR to repair a table that was seeded
  // WITHOUT coordinates (which makes every checkout unserviceable: the allocator
  // can't resolve the customer pincode's coordinates → PINCODE_UNKNOWN).
  const FORCE_RELOAD = process.env.PINCODE_SEED_FORCE === 'true';
  const existingWithCoords = await prisma.postOffice.count({
    where: { latitude: { not: null } },
  });
  if (existingWithCoords > 0 && !FORCE_RELOAD) {
    console.log(
      `\n[skip] post_offices already has ${existingWithCoords} rows WITH coordinates — ` +
        `pincode data looks loaded. Set PINCODE_SEED_FORCE=true to force a full reload.\n`,
    );
    await prisma.$disconnect();
    return;
  }

  // Fail fast with an actionable message instead of a raw ENOENT. The in-tree
  // prisma/seed/pincodes.csv is a broken symlink, so a clean checkout has no file.
  let readable = fs.existsSync(CSV_PATH);
  if (readable) {
    try {
      fs.accessSync(CSV_PATH, fs.constants.R_OK);
    } catch {
      readable = false;
    }
  }
  if (!readable) {
    console.error(
      `\n[ERROR] pincodes CSV not found or unreadable at: ${CSV_PATH}\n` +
        `The committed prisma/seed/pincodes.csv is a broken symlink to a developer's ` +
        `local machine. Set PINCODE_CSV_PATH=/abs/path/to/pincodes.csv ` +
        `(the 165,627-row India Post directory) and re-run, e.g.:\n` +
        `  PINCODE_CSV_PATH=/abs/path/to/pincodes.csv npx ts-node prisma/seed/seed-pincodes.ts\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // Strip a leading UTF-8 BOM and split on either LF or CRLF line endings so the
  // header/first-record parse is not corrupted by a BOM or Windows-authored CSV.
  let content = fs.readFileSync(CSV_PATH, 'utf-8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split(/\r?\n/).filter(l => l.trim());

  const header = lines[0];
  console.log(`Header: ${header}`);
  console.log(`Total rows: ${lines.length - 1}`);

  const dataLines = lines.slice(1);

  // Load the canonical state-name -> 2-digit GST/CBIC code map so each PostOffice
  // row can carry a resolved stateCode (place-of-supply) without a second lookup.
  console.log('\n[Phase 0] Loading IndiaState GST code map...');
  const indiaStates = await prisma.indiaState.findMany({
    select: { stateName: true, gstStateCode: true },
  });
  const stateCodeMap = new Map<string, string>();
  for (const s of indiaStates) {
    stateCodeMap.set(s.stateName.trim().toUpperCase(), s.gstStateCode);
  }
  console.log(`  Loaded ${stateCodeMap.size} state -> GST-code entries`);

  // Phase 1: Parse all rows and build pincode → coordinates map
  console.log('\n[Phase 1] Parsing CSV and building coordinate map...');
  const pincodeCoords: Map<string, { lat: number; lng: number }> = new Map();
  const allRows: any[] = [];
  let skipped = 0;

  for (const line of dataLines) {
    const fields = parseCSVLine(line);
    if (fields.length < 11) { skipped++; continue; }

    const [circleName, regionName, divisionName, officeName, pincode, officeType, delivery, district, state, latStr, lngStr] = fields;
    if (!pincode || !officeName) { skipped++; continue; }

    const pin = String(pincode).trim();
    const lat = latStr && latStr !== 'NA' && latStr !== '' ? parseFloat(latStr) : null;
    const lng = lngStr && lngStr !== 'NA' && lngStr !== '' ? parseFloat(lngStr) : null;

    // Store first valid coordinates per pincode
    if (lat && lng && !isNaN(lat) && !isNaN(lng) && !pincodeCoords.has(pin)) {
      pincodeCoords.set(pin, { lat, lng });
    }

    allRows.push({
      circleName: circleName || '',
      regionName: regionName || '',
      divisionName: divisionName || '',
      officeName: officeName || '',
      pincode: pin,
      officeType: officeType || '',
      delivery: delivery || '',
      district: district || '',
      state: state || '',
      rawLat: lat,
      rawLng: lng,
    });
  }

  console.log(`  Parsed ${allRows.length} rows, skipped ${skipped}`);
  console.log(`  Pincodes with coordinates: ${pincodeCoords.size}`);

  // Phase 2: Fill NA coordinates from same pincode and insert in batches
  console.log('\n[Phase 2] Inserting into database...');

  // The @@unique([pincode, officeName]) index means createMany(skipDuplicates)
  // SKIPS rows that already exist — so re-running against a table that was seeded
  // WITHOUT coordinates (the exact staging data gap this repairs) would leave the
  // coordless rows untouched and coords would never populate. Clear first for a
  // clean reload. Safe: post_offices is standalone reference data with no inbound
  // foreign keys (pincodes are referenced as plain strings elsewhere).
  const preexisting = await prisma.postOffice.count();
  if (preexisting > 0) {
    console.log(`  Clearing ${preexisting} existing rows for a clean reload…`);
    await prisma.postOffice.deleteMany({});
  }

  let inserted = 0;
  let naFixed = 0;
  let batched: any[] = [];

  for (const row of allRows) {
    let lat = row.rawLat;
    let lng = row.rawLng;

    // Validate coordinates are in valid range (India: lat 6-37, lng 68-98)
    if (lat !== null && (isNaN(lat) || lat < -90 || lat > 90)) lat = null;
    if (lng !== null && (isNaN(lng) || lng < -180 || lng > 180)) lng = null;

    // If this row has NA coordinates, use coordinates from another row with same pincode
    if ((lat === null || lng === null) && pincodeCoords.has(row.pincode)) {
      const fallback = pincodeCoords.get(row.pincode)!;
      lat = fallback.lat;
      lng = fallback.lng;
      naFixed++;
    }

    batched.push({
      circleName: row.circleName,
      regionName: row.regionName,
      divisionName: row.divisionName,
      officeName: row.officeName,
      pincode: row.pincode,
      officeType: row.officeType,
      delivery: row.delivery,
      district: row.district,
      state: row.state,
      stateCode: stateCodeMap.get(row.state.trim().toUpperCase()) ?? null,
      latitude: lat,
      longitude: lng,
    });

    if (batched.length >= BATCH_SIZE) {
      await prisma.postOffice.createMany({ data: batched, skipDuplicates: true });
      inserted += batched.length;
      batched = [];

      if (inserted % 10000 === 0) {
        console.log(`  Inserted: ${inserted}/${allRows.length}`);
      }
    }
  }

  if (batched.length > 0) {
    await prisma.postOffice.createMany({ data: batched, skipDuplicates: true });
    inserted += batched.length;
  }

  console.log(`\n=== Done! ===`);
  console.log(`  Total inserted: ${inserted}`);
  console.log(`  NA coordinates fixed from same pincode: ${naFixed}`);
  console.log(`  Skipped (bad rows): ${skipped}`);

  const total = await prisma.postOffice.count();
  const uniquePincodes = await prisma.$queryRaw`SELECT COUNT(DISTINCT pincode) as count FROM post_offices` as any[];
  const withCoords = await prisma.postOffice.count({ where: { latitude: { not: null } } });
  const withoutCoords = await prisma.postOffice.count({ where: { latitude: null } });

  console.log(`\n  DB total rows: ${total}`);
  console.log(`  Unique pincodes: ${uniquePincodes[0]?.count}`);
  console.log(`  With coordinates: ${withCoords}`);
  console.log(`  Without coordinates: ${withoutCoords}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Import failed:', e);
  prisma.$disconnect();
  process.exit(1);
});
