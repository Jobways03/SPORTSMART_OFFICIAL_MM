import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const BATCH_SIZE = 1000;
const CSV_PATH = path.join(__dirname, 'pincodes.csv');

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
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

  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  const header = lines[0];
  console.log(`Header: ${header}`);
  console.log(`Total rows: ${lines.length - 1}`);

  const dataLines = lines.slice(1);

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
      latitude: lat,
      longitude: lng,
    });

    if (batched.length >= BATCH_SIZE) {
      await prisma.postOffice.createMany({ data: batched });
      inserted += batched.length;
      batched = [];

      if (inserted % 10000 === 0) {
        console.log(`  Inserted: ${inserted}/${allRows.length}`);
      }
    }
  }

  if (batched.length > 0) {
    await prisma.postOffice.createMany({ data: batched });
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
