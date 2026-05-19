-- Drop the duplicate-detection column. Admin moderators now check for
-- duplicates manually during approval, so the automated flag is no longer
-- needed.
ALTER TABLE "products" DROP COLUMN IF EXISTS "potential_duplicate_of";
