/**
 * Recompute seller profile-completion % using the live computeProfileCompletion
 * helper. Earlier KYC submits hardcoded 100; this corrects existing rows to the
 * honest value (identity/contact/address/descriptions/policy/image/logo).
 * Idempotent — only rows whose stored % differs are updated. Run:
 *   cd apps/api && npx ts-node prisma/scripts/recompute-completion.ts
 */
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.join(__dirname, '..', '..', '.env') });
import { PrismaClient } from '@prisma/client';
import { computeProfileCompletion } from '../../src/core/utils';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Recomputing seller profile completion…\n');

  const sellers = await prisma.seller.findMany({
    select: {
      id: true,
      sellerName: true,
      sellerShopName: true,
      sellerContactCountryCode: true,
      sellerContactNumber: true,
      storeAddress: true,
      city: true,
      state: true,
      country: true,
      sellerZipCode: true,
      shortStoreDescription: true,
      detailedStoreDescription: true,
      sellerPolicy: true,
      sellerProfileImageUrl: true,
      sellerShopLogoUrl: true,
      profileCompletionPercentage: true,
    },
  });

  let changed = 0;
  for (const s of sellers) {
    const { profileCompletionPercentage, isProfileCompleted } =
      computeProfileCompletion(s as any);
    if (profileCompletionPercentage !== s.profileCompletionPercentage) {
      await prisma.seller.update({
        where: { id: s.id },
        data: { profileCompletionPercentage, isProfileCompleted },
      });
      console.log(
        `  ${s.sellerName} (${s.sellerShopName}): ${s.profileCompletionPercentage}% → ${profileCompletionPercentage}%`,
      );
      changed++;
    }
  }

  console.log(`\n✅ Done. Updated ${changed} of ${sellers.length} seller(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
