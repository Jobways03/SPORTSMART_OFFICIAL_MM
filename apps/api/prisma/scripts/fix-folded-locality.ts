/**
 * One-off data fix: the old onboarding "folded" the picked locality into the
 * store/business address text (e.g. "…Saheb Nagar Kalan, Vanasthalipuram S.O")
 * and left the `locality` column empty. New submissions now send locality as
 * its own field; this moves the folded value out of existing rows.
 *
 * Detection is conservative: only a trailing ", <name> S.O/B.O/H.O/G.P.O"
 * (India-Post office suffixes) is treated as a folded locality, so a normal
 * address line is never mistaken for one. Run:
 *   cd apps/api && npx ts-node prisma/scripts/fix-folded-locality.ts
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.join(__dirname, '..', '..', '.env') });
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Trailing ", <something> S.O | B.O | H.O | G.P.O" → a folded India-Post locality.
const FOLDED_RE = /,\s*([^,]+?\s(?:S\.O|B\.O|H\.O|G\.P\.O))\s*$/i;

function split(addr: string | null): { locality: string; address: string } | null {
  if (!addr) return null;
  const m = addr.match(FOLDED_RE);
  if (!m) return null;
  return {
    locality: (m[1] ?? '').trim(),
    address: addr.replace(FOLDED_RE, '').replace(/,\s*$/, '').trim(),
  };
}

async function main() {
  console.log('🔧 Un-folding store-address localities…\n');

  const sellers = await prisma.seller.findMany({
    where: { OR: [{ locality: null }, { locality: '' }] },
    select: { id: true, sellerName: true, storeAddress: true },
  });
  let sFixed = 0;
  for (const s of sellers) {
    const r = split(s.storeAddress);
    if (!r) continue;
    await prisma.seller.update({
      where: { id: s.id },
      data: { locality: r.locality, storeAddress: r.address },
    });
    console.log(`  seller "${s.sellerName}" → locality="${r.locality}"`);
    sFixed++;
  }
  console.log(`  Sellers fixed: ${sFixed}\n`);

  const franchises = await prisma.franchisePartner.findMany({
    where: { OR: [{ locality: null }, { locality: '' }] },
    select: { id: true, businessName: true, address: true },
  });
  let fFixed = 0;
  for (const f of franchises) {
    const r = split(f.address);
    if (!r) continue;
    await prisma.franchisePartner.update({
      where: { id: f.id },
      data: { locality: r.locality, address: r.address },
    });
    console.log(`  franchise "${f.businessName}" → locality="${r.locality}"`);
    fFixed++;
  }
  console.log(`  Franchises fixed: ${fFixed}\n`);
  console.log('✅ Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
